import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, basename } from 'node:path'
import yauzl from 'yauzl'
import { parse as parseCsv } from 'csv-parse/sync'
import { useDb, transaction } from './db'
import { processTrack, trackCells, type RawPoint } from './geo'
import { parseTrackFile } from './parsers'

/** Origen de ficheros: el ZIP de exportación de Strava o esa misma carpeta descomprimida. */
interface Source {
  files: string[]
  read(path: string): Promise<Buffer>
  close(): void
}

async function openSource(path: string): Promise<Source> {
  const s = await stat(path)
  return s.isDirectory() ? dirSource(path) : zipSource(path)
}

async function dirSource(root: string): Promise<Source> {
  const files: string[] = []
  for (const e of await readdir(root, { recursive: true, withFileTypes: true }))
    if (e.isFile()) files.push(relative(root, join(e.parentPath, e.name)).replaceAll('\\', '/'))
  return { files, read: p => readFile(join(root, p)), close() {} }
}

function zipSource(path: string): Promise<Source> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, autoClose: false }, (err, zip) => {
      if (err || !zip) return reject(err)
      const entries = new Map<string, yauzl.Entry>()
      zip.on('entry', (e: yauzl.Entry) => {
        if (!e.fileName.endsWith('/')) entries.set(e.fileName, e)
        zip.readEntry()
      })
      zip.on('error', reject)
      zip.on('end', () => resolve({
        files: [...entries.keys()],
        read: p => new Promise((res, rej) => {
          const entry = entries.get(p)
          if (!entry) return rej(new Error(`No está en el ZIP: ${p}`))
          zip.openReadStream(entry, (e, stream) => {
            if (e || !stream) return rej(e)
            const chunks: Buffer[] = []
            stream.on('data', c => chunks.push(c))
            stream.on('end', () => res(Buffer.concat(chunks)))
            stream.on('error', rej)
          })
        }),
        close: () => zip.close(),
      }))
      zip.readEntry()
    })
  })
}

export interface CsvActivity {
  id: string
  name?: string
  type?: string
  date?: string
  description?: string
  gear?: string
  filename?: string
  movingTimeS?: number
  elapsedTimeS?: number
  elevationGainM?: number
}

// El CSV de Strava viene en inglés o en el idioma de la cuenta, y repite columnas
// (p. ej. "Distance" en km y luego en m): nos quedamos con la primera coincidencia.
const COLUMNS: Record<keyof CsvActivity, RegExp> = {
  id: /^(activity id|id de (la )?actividad)$/i,
  name: /^(activity name|nombre de (la )?actividad)$/i,
  type: /^(activity type|tipo de (la )?actividad)$/i,
  date: /^(activity date|fecha de (la )?actividad)$/i,
  description: /^(activity description|descripci[oó]n de (la )?actividad)$/i,
  gear: /^(activity gear|equipo de (la )?actividad|equipamiento)$/i,
  filename: /^(filename|nombre (del )?archivo)$/i,
  movingTimeS: /^(moving time|tiempo en movimiento)$/i,
  elapsedTimeS: /^(elapsed time|tiempo transcurrido)$/i,
  elevationGainM: /^(elevation gain|desnivel positivo|ganancia de elevaci[oó]n)$/i,
}

function parseActivitiesCsv(text: string): CsvActivity[] {
  const rows: string[][] = parseCsv(text, { bom: true, relax_column_count: true, skip_empty_lines: true })
  const header = rows.shift()?.map(h => h.trim()) ?? []
  const idx = Object.fromEntries(
    Object.entries(COLUMNS).map(([k, re]) => [k, header.findIndex(h => re.test(h))]),
  ) as Record<keyof CsvActivity, number>
  if (idx.id < 0) return []
  const num = (v?: string) => {
    const n = v ? Number(v.replace(',', '.')) : NaN
    return Number.isFinite(n) ? n : undefined
  }
  const str = (row: string[], k: keyof CsvActivity) => (idx[k] >= 0 ? row[idx[k]]?.trim() : undefined) || undefined
  return rows.map(r => ({
    id: str(r, 'id')!,
    name: str(r, 'name'),
    type: str(r, 'type'),
    date: str(r, 'date'),
    description: str(r, 'description'),
    gear: str(r, 'gear'),
    filename: str(r, 'filename'),
    movingTimeS: num(str(r, 'movingTimeS')),
    elapsedTimeS: num(str(r, 'elapsedTimeS')),
    elevationGainM: num(str(r, 'elevationGainM')),
  })).filter(a => a.id)
}

export const TRACK_RE = /\.(gpx|tcx|fit)(\.gz)?$/i

export interface ImportResult {
  imported: number
  /** ya estaban importadas y no se han vuelto a procesar */
  unchanged: number
  skipped: { id: string, reason: string }[]
  errors: { file: string, error: string }[]
}

export const emptyResult = (): ImportResult => ({ imported: 0, unchanged: 0, skipped: [], errors: [] })

/**
 * Decide qué hay que importar a partir de activities.csv (si lo hay) y la lista de ficheros del
 * export. Devuelve, por fichero, la actividad que contiene: solo esos ficheros hace falta leer/subir.
 */
export function planImport(userId: number, csvText: string | null, files: string[], opts: { force?: boolean } = {}) {
  const result = emptyResult()
  // el ZIP puede venir con una carpeta raíz: localizamos activities.csv donde esté
  const csvPath = files.find(f => basename(f).toLowerCase() === 'activities.csv')
  const prefix = csvPath ? csvPath.slice(0, -'activities.csv'.length) : ''
  let items: CsvActivity[] = csvText ? parseActivitiesCsv(csvText) : []
  if (!items.length) {
    // sin CSV: todos los ficheros de track que haya
    items = files.filter(f => TRACK_RE.test(f)).map(f => ({ id: basename(f).replace(TRACK_RE, ''), filename: f }))
  }

  const fileSet = new Set(files)
  const existing = new Set((useDb().prepare('SELECT id FROM activities WHERE user_id = ?').all(userId) as { id: string }[]).map(r => r.id))
  const todo = new Map<string, CsvActivity>()
  for (const a of items) {
    // reimportar solo lo nuevo: procesar (y subir) los ficheros es lo que más tarda
    if (existing.has(a.id) && !opts.force) { result.unchanged++; continue }
    if (!a.filename) { result.skipped.push({ id: a.id, reason: 'sin fichero GPS' }); continue }
    const file = fileSet.has(prefix + a.filename) ? prefix + a.filename : a.filename
    if (!fileSet.has(file)) { result.skipped.push({ id: a.id, reason: `no encontrado: ${a.filename}` }); continue }
    todo.set(file, a)
  }
  return { todo, result }
}

/** Procesa el fichero de una actividad y la guarda (crea o actualiza). Anota el resultado. */
export async function importActivity(userId: number, a: CsvActivity, file: string, buf: Buffer, result: ImportResult, parseAs = file) {
  try {
    const parsed = await parseTrackFile(parseAs, buf)
    saveActivity(userId, { ...a, name: a.name ?? parsed.name }, parsed.points, file, result)
  } catch (e) {
    result.errors.push({ file, error: e instanceof Error ? e.message : String(e) })
  }
}

/** Procesa los puntos de una actividad y la guarda (crea o actualiza). Anota el resultado. */
export function saveActivity(userId: number, a: CsvActivity, points: RawPoint[], source: string, result: ImportResult) {
  const track = processTrack(points)
  if (!track) { result.skipped.push({ id: a.id, reason: 'track sin puntos GPS' }); return }
  const startTime = track.startTime ?? (a.date && !Number.isNaN(Date.parse(a.date)) ? new Date(a.date).toISOString() : null)
  const db = useDb()
  transaction(() => {
    // UPSERT (no INSERT OR REPLACE: el REPLACE borraría en cascada el track y las celdas)
    db.prepare(`
      INSERT INTO activities
        (user_id, id, name, type, start_time, distance_m, moving_time_s, elapsed_time_s, elevation_gain_m,
         description, gear, min_lng, min_lat, max_lng, max_lat, source_file, imported_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, id) DO UPDATE SET
        name = excluded.name, type = excluded.type, start_time = excluded.start_time, distance_m = excluded.distance_m,
        moving_time_s = excluded.moving_time_s, elapsed_time_s = excluded.elapsed_time_s,
        elevation_gain_m = excluded.elevation_gain_m, description = excluded.description, gear = excluded.gear,
        min_lng = excluded.min_lng, min_lat = excluded.min_lat, max_lng = excluded.max_lng, max_lat = excluded.max_lat,
        source_file = excluded.source_file, imported_at = excluded.imported_at`).run(
      userId, a.id, a.name ?? `Actividad ${a.id}`, a.type ?? null, startTime,
      Math.round(track.distanceM),
      a.movingTimeS ?? track.movingTimeS, a.elapsedTimeS ?? track.elapsedTimeS,
      a.elevationGainM ?? track.elevationGainM,
      a.description ?? null, a.gear ?? null,
      ...track.bbox, source, new Date().toISOString(),
    )
    db.prepare('INSERT OR REPLACE INTO tracks (user_id, activity_id, detail, overview) VALUES (?, ?, ?, ?)')
      .run(userId, a.id, JSON.stringify(track.detail), JSON.stringify(track.overview))
    db.prepare('DELETE FROM cells WHERE user_id = ? AND activity_id = ?').run(userId, a.id)
    const insertCell = db.prepare('INSERT OR IGNORE INTO cells (user_id, cell, activity_id) VALUES (?, ?, ?)')
    for (const c of trackCells(track.detail)) insertCell.run(userId, c, a.id)
  })
  result.imported++
}

interface Progress { running: boolean, done: number, total: number }
const progress = new Map<number, Progress>()

/** Progreso de la importación desde carpeta en curso del usuario, para mostrarlo en la interfaz. */
export const importProgress = (userId: number): Progress => progress.get(userId) ?? { running: false, done: 0, total: 0 }

/** Importa un export de Strava que está en el servidor (ZIP o carpeta descomprimida). */
export async function importStravaExport(userId: number, path: string, opts: { force?: boolean } = {}): Promise<ImportResult> {
  const p: Progress = { running: true, done: 0, total: 0 }
  progress.set(userId, p)
  try {
    const src = await openSource(path)
    try {
      const csvPath = src.files.find(f => basename(f).toLowerCase() === 'activities.csv')
      const csv = csvPath ? (await src.read(csvPath)).toString('utf8') : null
      const { todo, result } = planImport(userId, csv, src.files, opts)
      p.total = todo.size
      for (const [file, a] of todo) {
        await importActivity(userId, a, file, await src.read(file), result)
        p.done++
      }
      return result
    } finally {
      src.close()
    }
  } finally {
    p.running = false
  }
}
