import { useDb, dataVersion } from './db'
import { cellKey, CELL_DEG, haversine, type DetailPoint } from './geo'

// detalle parseado de mis actividades, cacheado mientras no cambien los datos
let cache: { version: string, tracks: Map<string, DetailPoint[]> } | undefined

function myTrack(id: string): DetailPoint[] {
  const version = dataVersion()
  if (cache?.version !== version) cache = { version, tracks: new Map() }
  let t = cache.tracks.get(id)
  if (!t) {
    const row = useDb().prepare('SELECT detail FROM tracks WHERE activity_id = ?').get(id) as { detail: string }
    t = JSON.parse(row.detail) as DetailPoint[]
    cache.tracks.set(id, t)
  }
  return t
}

const neighbours = (key: string) => {
  const [y, x] = key.split(':').map(Number) as [number, number]
  const out: string[] = []
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) out.push(`${y + dy}:${x + dx}`)
  return out
}

interface Seg { id: string, ax: number, ay: number, bx: number, by: number }

/**
 * Compara un track de referencia con todas mis actividades: qué tramos ya he recorrido
 * (a menos de `toleranceM`) y qué actividades comparten más recorrido con él.
 */
export function compareTrack(ref: DetailPoint[], toleranceM = 30, excludeId?: string) {
  // proyección equirectangular local en metros
  const lat0 = ref[0]![1] * Math.PI / 180
  const kx = 111320 * Math.cos(lat0), ky = 110540
  const px = (p: DetailPoint) => [p[0] * kx, p[1] * ky] as const

  const area = new Set<string>()
  for (const p of ref) for (const c of neighbours(cellKey(p[0], p[1]))) area.add(c)

  const ids = (useDb().prepare(`SELECT DISTINCT activity_id AS id FROM cells WHERE cell IN (SELECT value FROM json_each(?))`)
    .all(JSON.stringify([...area])) as { id: string }[]).map(r => r.id).filter(id => id !== excludeId)

  // segmentos de mis tracks dentro de la zona, repartidos por celda
  const buckets = new Map<string, Seg[]>()
  const add = (key: string, s: Seg) => {
    if (!area.has(key)) return
    let b = buckets.get(key)
    if (!b) buckets.set(key, b = [])
    b.push(s)
  }
  for (const id of ids) {
    const t = myTrack(id)
    for (let i = 0; i + 1 < t.length; i++) {
      const a = t[i]!, b = t[i + 1]!
      const [ax, ay] = px(a), [bx, by] = px(b)
      const seg = { id, ax, ay, bx, by }
      const len = b[3] - a[3]
      // segmentos largos (huecos de GPS) pueden cruzar varias celdas
      const steps = Math.max(1, Math.ceil(len / (CELL_DEG * 50000)))
      const keys = new Set<string>()
      for (let k = 0; k <= steps; k++) keys.add(cellKey(a[0] + (b[0] - a[0]) * k / steps, a[1] + (b[1] - a[1]) * k / steps))
      for (const key of keys) add(key, seg)
    }
  }

  // para cada punto de la referencia: qué actividades pasan cerca
  const tol2 = toleranceM * toleranceM
  const near: Set<string>[] = ref.map((p) => {
    const [x, y] = px(p)
    const found = new Set<string>()
    for (const c of neighbours(cellKey(p[0], p[1]))) {
      for (const s of buckets.get(c) ?? []) {
        if (found.has(s.id)) continue
        const dx = s.bx - s.ax, dy = s.by - s.ay
        const l2 = dx * dx + dy * dy
        const t = l2 ? Math.max(0, Math.min(1, ((x - s.ax) * dx + (y - s.ay) * dy) / l2)) : 0
        const ex = s.ax + t * dx - x, ey = s.ay + t * dy - y
        if (ex * ex + ey * ey <= tol2) found.add(s.id)
      }
    }
    return found
  })

  // tramos conocidos / nuevos y solape por actividad
  let coveredM = 0
  const overlap = new Map<string, number>()
  const runs: { known: boolean, coords: [number, number][], lengthM: number }[] = []
  for (let i = 0; i + 1 < ref.length; i++) {
    const a = ref[i]!, b = ref[i + 1]!
    const len = b[3] - a[3] || haversine(a[1], a[0], b[1], b[0])
    const both = [...near[i]!].filter(id => near[i + 1]!.has(id))
    const known = both.length > 0
    if (known) coveredM += len
    for (const id of both) overlap.set(id, (overlap.get(id) ?? 0) + len)
    const last = runs.at(-1)
    if (last?.known === known) {
      last.coords.push([b[0], b[1]])
      last.lengthM += len
    } else {
      runs.push({ known, coords: [[a[0], a[1]], [b[0], b[1]]], lengthM: len })
    }
  }

  const totalM = ref.at(-1)![3] || 1
  const minOverlap = Math.min(200, totalM * 0.02)
  return {
    toleranceM,
    totalM,
    coveredM: Math.round(coveredM),
    segments: {
      type: 'FeatureCollection' as const,
      features: runs.map(r => ({
        type: 'Feature' as const,
        properties: { known: r.known, lengthM: Math.round(r.lengthM) },
        geometry: { type: 'LineString' as const, coordinates: r.coords },
      })),
    },
    matches: [...overlap]
      .filter(([, m]) => m >= minOverlap)
      .sort((a, b) => b[1] - a[1])
      .map(([id, m]) => ({ id, overlapM: Math.round(m), pct: Math.round((m / totalM) * 100) })),
  }
}
