import { useDb } from './db'
import { rateAvailable, stravaApi } from './strava'
import { emptyResult, saveActivity, type CsvActivity, type ImportResult } from './importer'
import type { RawPoint } from './geo'

interface Summary {
  id: number
  name: string
  type?: string
  sport_type?: string
  start_date: string
  moving_time?: number
  elapsed_time?: number
  total_elevation_gain?: number
  manual?: boolean
  trainer?: boolean
  map?: { summary_polyline?: string | null }
}

interface Streams { latlng?: { data: [number, number][] }, altitude?: { data: number[] }, time?: { data: number[] } }

/** Actividades que se traen la primera vez (el resto: ZIP o descarga del historial). */
export const FIRST_SYNC = 50
const PAGE = 100
// el cupo es de la aplicación entera: la descarga del historial deja libre un 30 % para lo interactivo
const BACKFILL_RESERVE = 0.3
const SYNC_RESERVE = 0.05

const epoch = (iso: string) => Math.floor(Date.parse(iso) / 1000)

/** Ids que ya tenemos (importadas o descartadas por no tener GPS): no se vuelven a pedir. */
function knownIds(userId: number) {
  const db = useDb()
  const rows = db.prepare('SELECT id FROM activities WHERE user_id = ? UNION SELECT id FROM strava_skips WHERE user_id = ?').all(userId, userId) as { id: string }[]
  return new Set(rows.map(r => r.id))
}

const markSkip = (userId: number, id: string, reason: string) =>
  useDb().prepare('INSERT OR IGNORE INTO strava_skips (user_id, id, reason) VALUES (?, ?, ?)').run(userId, id, reason)

function ensureRow(userId: number) {
  useDb().prepare('INSERT OR IGNORE INTO strava_sync (user_id) VALUES (?)').run(userId)
}

/** Descarga el track de una actividad (1 petición) y la guarda. */
async function importSummary(userId: number, s: Summary, result: ImportResult) {
  const id = String(s.id)
  if (s.manual || s.trainer || !s.map?.summary_polyline) {
    markSkip(userId, id, 'sin GPS')
    result.skipped.push({ id, reason: 'sin GPS' })
    return
  }
  const st = await stravaApi<Streams>(userId, `/activities/${id}/streams`, { query: { keys: 'latlng,altitude,time', key_by_type: 'true' } })
  const t0 = Date.parse(s.start_date)
  const points: RawPoint[] = (st.latlng?.data ?? []).map(([lat, lng], i) => ({
    lat, lng, ele: st.altitude?.data[i], t: st.time ? t0 + st.time.data[i]! * 1000 : undefined,
  }))
  const a: CsvActivity = {
    id, name: s.name, type: s.sport_type ?? s.type, date: s.start_date,
    movingTimeS: s.moving_time, elapsedTimeS: s.elapsed_time, elevationGainM: s.total_elevation_gain,
  }
  const before = result.imported
  saveActivity(userId, a, points, `strava:${id}`, result)
  if (result.imported === before) markSkip(userId, id, 'sin puntos GPS')
}

const syncing = new Set<number>()

/**
 * Trae las actividades nuevas. Si el usuario no tiene ninguna, las FIRST_SYNC más recientes.
 * `pending` = las que no han cabido en el cupo de la API (se recogerán en la próxima sincronización).
 */
export async function syncRecent(userId: number) {
  const result = { ...emptyResult(), pending: 0, firstSync: false }
  if (syncing.has(userId)) return result
  syncing.add(userId)
  try {
    const db = useDb()
    const latest = (db.prepare('SELECT MAX(start_time) AS t FROM activities WHERE user_id = ?').get(userId) as { t: string | null }).t
    let summaries: Summary[] = []
    if (!latest) {
      result.firstSync = true
      summaries = await stravaApi<Summary[]>(userId, '/athlete/activities', { query: { per_page: FIRST_SYNC } })
    } else {
      // con `after` Strava devuelve de la más antigua a la más reciente
      for (let page = 1; page <= 3; page++) {
        const batch = await stravaApi<Summary[]>(userId, '/athlete/activities', { query: { after: epoch(latest), per_page: PAGE, page } })
        summaries.push(...batch)
        if (batch.length < PAGE) break
      }
    }
    const known = knownIds(userId)
    const todo = summaries.filter(s => !known.has(String(s.id)))
    for (let i = 0; i < todo.length; i++) {
      if (rateAvailable(SYNC_RESERVE) < 1) { result.pending = todo.length - i; break }
      await importSummary(userId, todo[i]!, result).catch((e) => {
        result.errors.push({ file: `strava:${todo[i]!.id}`, error: e instanceof Error ? e.message : String(e) })
      })
    }
    ensureRow(userId)
    db.prepare('UPDATE strava_sync SET last_sync_at = ? WHERE user_id = ?').run(new Date().toISOString(), userId)
    return result
  } finally {
    syncing.delete(userId)
  }
}

export function setBackfill(userId: number, enable: boolean) {
  ensureRow(userId)
  useDb().prepare(`UPDATE strava_sync SET backfill = ? WHERE user_id = ? AND (backfill != 'done' OR ? = 'off')`)
    .run(enable ? 'running' : 'off', userId, enable ? 'running' : 'off')
}

export function syncStatus(userId: number) {
  const row = useDb().prepare('SELECT last_sync_at, backfill, backfill_before, backfill_imported FROM strava_sync WHERE user_id = ?').get(userId) as
    { last_sync_at: string | null, backfill: string, backfill_before: number | null, backfill_imported: number } | undefined
  return {
    lastSyncAt: row?.last_sync_at ?? null,
    backfill: row?.backfill ?? 'off',
    backfillImported: row?.backfill_imported ?? 0,
    /** revisado desde hoy hasta esta fecha */
    backfillReachedAt: row?.backfill_before ? new Date(row.backfill_before * 1000).toISOString() : null,
    rateAvailable: rateAvailable(BACKFILL_RESERVE),
  }
}

let ticking = false

/**
 * Un paso de la descarga del historial (lo lanza un temporizador): recorre las actividades de cada
 * usuario que la tenga activada, de la más reciente a la más antigua, mientras quede cupo.
 */
export async function backfillTick() {
  if (ticking) return
  ticking = true
  try {
    const db = useDb()
    const users = db.prepare(`SELECT user_id, backfill_before FROM strava_sync WHERE backfill = 'running'`).all() as { user_id: number, backfill_before: number | null }[]
    for (const u of users) {
      try {
        let before = u.backfill_before ?? Math.floor(Date.now() / 1000)
        const save = (imported: number) => db.prepare('UPDATE strava_sync SET backfill_before = ?, backfill_imported = backfill_imported + ? WHERE user_id = ?').run(before, imported, u.user_id)
        while (rateAvailable(BACKFILL_RESERVE) > 1) {
          // sin `after`, de la más reciente a la más antigua
          const page = await stravaApi<Summary[]>(u.user_id, '/athlete/activities', { query: { before, per_page: PAGE } })
          if (!page.length) {
            db.prepare(`UPDATE strava_sync SET backfill = 'done' WHERE user_id = ?`).run(u.user_id)
            break
          }
          const known = knownIds(u.user_id)
          let outOfQuota = false
          for (const s of page) {
            if (!known.has(String(s.id))) {
              if (rateAvailable(BACKFILL_RESERVE) < 1) { outOfQuota = true; break }
              const result = emptyResult()
              await importSummary(u.user_id, s, result).catch(e => console.error(`[backfill] ${u.user_id} ${s.id}:`, e?.message ?? e))
              before = epoch(s.start_date)
              save(result.imported)
            } else {
              before = epoch(s.start_date)
            }
          }
          save(0)
          if (outOfQuota) break
        }
      } catch (e: any) {
        console.error(`[backfill] usuario ${u.user_id}:`, e?.message ?? e)
        // token revocado o sin permisos: se para para no reintentar sin fin
        if ([401, 403].includes(e?.statusCode)) db.prepare(`UPDATE strava_sync SET backfill = 'off' WHERE user_id = ?`).run(u.user_id)
      }
    }
  } finally {
    ticking = false
  }
}
