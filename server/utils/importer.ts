import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, basename } from 'node:path'
import yauzl from 'yauzl'
import { parse as parseCsv } from 'csv-parse/sync'
import { useDb, transaction } from './db'
import { processTrack, trackCells } from './geo'
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

interface CsvActivity {
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

const TRACK_RE = /\.(gpx|tcx|fit)(\.gz)?$/i

export interface ImportResult {
  imported: number
  skipped: { id: string, reason: string }[]
  errors: { file: string, error: string }[]
}

export async function importStravaExport(path: string, onProgress?: (done: number, total: number) => void): Promise<ImportResult> {
  const src = await openSource(path)
  const result: ImportResult = { imported: 0, skipped: [], errors: [] }
  try {
    // el ZIP puede venir con una carpeta raíz: localizamos activities.csv donde esté
    const csvPath = src.files.find(f => basename(f).toLowerCase() === 'activities.csv')
    const prefix = csvPath ? csvPath.slice(0, -'activities.csv'.length) : ''
    let items: CsvActivity[] = csvPath ? parseActivitiesCsv((await src.read(csvPath)).toString('utf8')) : []

    if (!items.length) {
      // sin CSV: importamos todos los ficheros de track que haya
      items = src.files.filter(f => TRACK_RE.test(f)).map(f => ({
        id: basename(f).replace(TRACK_RE, ''),
        filename: f,
      }))
    }

    const fileSet = new Set(src.files)
    const db = useDb()
    const upsertActivity = db.prepare(`
      INSERT OR REPLACE INTO activities
        (id, name, type, start_time, distance_m, moving_time_s, elapsed_time_s, elevation_gain_m,
         description, gear, min_lng, min_lat, max_lng, max_lat, source_file, imported_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    const upsertTrack = db.prepare('INSERT OR REPLACE INTO tracks (activity_id, detail, overview) VALUES (?, ?, ?)')
    const deleteCells = db.prepare('DELETE FROM cells WHERE activity_id = ?')
    const insertCell = db.prepare('INSERT OR IGNORE INTO cells (cell, activity_id) VALUES (?, ?)')
    const now = new Date().toISOString()

    let done = 0
    for (const a of items) {
      onProgress?.(done++, items.length)
      if (!a.filename) { result.skipped.push({ id: a.id, reason: 'sin fichero GPS' }); continue }
      const file = fileSet.has(prefix + a.filename) ? prefix + a.filename : a.filename
      if (!fileSet.has(file)) { result.skipped.push({ id: a.id, reason: `no encontrado: ${a.filename}` }); continue }
      try {
        const parsed = await parseTrackFile(file, await src.read(file))
        const track = processTrack(parsed.points)
        if (!track) { result.skipped.push({ id: a.id, reason: 'track sin puntos GPS' }); continue }
        const startTime = track.startTime ?? (a.date && !Number.isNaN(Date.parse(a.date)) ? new Date(a.date).toISOString() : null)
        transaction(() => {
          upsertActivity.run(
            a.id, a.name ?? parsed.name ?? `Actividad ${a.id}`, a.type ?? null, startTime,
            Math.round(track.distanceM),
            a.movingTimeS ?? track.movingTimeS, a.elapsedTimeS ?? track.elapsedTimeS,
            a.elevationGainM ?? track.elevationGainM,
            a.description ?? null, a.gear ?? null,
            ...track.bbox, file, now,
          )
          upsertTrack.run(a.id, JSON.stringify(track.detail), JSON.stringify(track.overview))
          deleteCells.run(a.id)
          for (const c of trackCells(track.detail)) insertCell.run(c, a.id)
        })
        result.imported++
      } catch (e) {
        result.errors.push({ file, error: e instanceof Error ? e.message : String(e) })
      }
    }
    onProgress?.(items.length, items.length)
  } finally {
    src.close()
  }
  return result
}
