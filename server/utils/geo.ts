export interface RawPoint {
  lng: number
  lat: number
  ele?: number
  /** epoch ms */
  t?: number
}

/** [lng, lat, ele, dist_m, t_s] */
export type DetailPoint = [number, number, number | null, number, number | null]

const R = 6371008.8
const rad = Math.PI / 180

export function haversine(lat1: number, lng1: number, lat2: number, lng2: number) {
  const dLat = (lat2 - lat1) * rad
  const dLng = (lng2 - lng1) * rad
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d

export function processTrack(raw: RawPoint[]) {
  const pts = raw.filter(p =>
    Number.isFinite(p.lat) && Number.isFinite(p.lng) && !(p.lat === 0 && p.lng === 0)
    && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180,
  )
  if (pts.length < 2) return null

  const t0 = pts.find(p => p.t != null)?.t
  let dist = 0
  let movingS = 0
  const detail: DetailPoint[] = []
  let lastKeptDist = -Infinity

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!
    if (i > 0) {
      const q = pts[i - 1]!
      const d = haversine(q.lat, q.lng, p.lat, p.lng)
      dist += d
      if (p.t != null && q.t != null) {
        const dt = (p.t - q.t) / 1000
        // cuenta como "en movimiento" si va a más de ~2 km/h y no es un salto raro
        if (dt > 0 && dt < 60 && d / dt > 0.55) movingS += dt
      }
    }
    if (dist - lastKeptDist >= 8 || i === pts.length - 1) {
      detail.push([
        round(p.lng, 6), round(p.lat, 6),
        p.ele != null && Number.isFinite(p.ele) ? round(p.ele, 1) : null,
        Math.round(dist),
        p.t != null && t0 != null ? Math.round((p.t - t0) / 1000) : null,
      ])
      lastKeptDist = dist
    }
  }

  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity
  for (const p of detail) {
    minLng = Math.min(minLng, p[0]); maxLng = Math.max(maxLng, p[0])
    minLat = Math.min(minLat, p[1]); maxLat = Math.max(maxLat, p[1])
  }

  const last = pts.at(-1)!
  return {
    detail,
    overview: simplify(detail, 10).map(p => [round(p[0], 5), round(p[1], 5)] as [number, number]),
    distanceM: dist,
    elevationGainM: elevationGain(detail),
    movingTimeS: Math.round(movingS) || null,
    elapsedTimeS: t0 != null && last.t != null ? Math.round((last.t - t0) / 1000) : null,
    startTime: t0 != null ? new Date(t0).toISOString() : null,
    bbox: [minLng, minLat, maxLng, maxLat] as [number, number, number, number],
  }
}

/** Desnivel positivo con histéresis para filtrar ruido del GPS/barómetro. */
function elevationGain(detail: DetailPoint[], threshold = 3) {
  let gain = 0
  let ref: number | null = null
  for (const p of detail) {
    const e = p[2]
    if (e == null) continue
    if (ref == null) { ref = e; continue }
    if (e - ref >= threshold) { gain += e - ref; ref = e }
    else if (ref - e >= threshold) ref = e
  }
  return Math.round(gain)
}

/** Douglas-Peucker iterativo, tolerancia en metros (proyección equirectangular local). */
export function simplify<T extends [number, number, ...unknown[]]>(pts: T[], toleranceM: number): T[] {
  if (pts.length <= 2) return pts.slice()
  const lat0 = pts[0]![1] * rad
  const kx = R * rad * Math.cos(lat0)
  const ky = R * rad
  const xy = pts.map(p => [p[0] * kx, p[1] * ky] as const)
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack: [number, number][] = [[0, pts.length - 1]]
  const tol2 = toleranceM * toleranceM
  while (stack.length) {
    const [a, b] = stack.pop()!
    let maxD = 0, idx = -1
    for (let i = a + 1; i < b; i++) {
      const d = segDist2(xy[i]!, xy[a]!, xy[b]!)
      if (d > maxD) { maxD = d; idx = i }
    }
    if (idx !== -1 && maxD > tol2) {
      keep[idx] = 1
      stack.push([a, idx], [idx, b])
    }
  }
  return pts.filter((_, i) => keep[i])
}

function segDist2(p: readonly [number, number], a: readonly [number, number], b: readonly [number, number]) {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  let t = len2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  const ex = a[0] + t * dx - p[0], ey = a[1] + t * dy - p[1]
  return ex * ex + ey * ey
}

/** Distancia mínima (m) de un punto a una polilinea, y el índice del vértice más cercano. */
export function nearestOnTrack(lng: number, lat: number, track: DetailPoint[]) {
  const kx = R * rad * Math.cos(lat * rad)
  const ky = R * rad
  const p = [0, 0] as const
  let best = Infinity, bestIdx = 0
  for (let i = 0; i < track.length; i++) {
    const a = [(track[i]![0] - lng) * kx, (track[i]![1] - lat) * ky] as const
    const b = i + 1 < track.length ? [(track[i + 1]![0] - lng) * kx, (track[i + 1]![1] - lat) * ky] as const : a
    const d = segDist2(p, a, b)
    if (d < best) {
      best = d
      bestIdx = a[0] ** 2 + a[1] ** 2 <= b[0] ** 2 + b[1] ** 2 ? i : i + 1
    }
  }
  return { distanceM: Math.sqrt(best), index: bestIdx }
}

// Rejilla del índice espacial: ~220 m en latitud
export const CELL_DEG = 0.002

export const cellKey = (lng: number, lat: number) =>
  `${Math.floor(lat / CELL_DEG)}:${Math.floor(lng / CELL_DEG)}`

export function trackCells(detail: DetailPoint[]) {
  const cells = new Set<string>()
  for (const p of detail) cells.add(cellKey(p[0], p[1]))
  return cells
}

export function cellsAround(lng: number, lat: number, radiusM: number) {
  const dLat = radiusM / (R * rad)
  const dLng = radiusM / (R * rad * Math.cos(lat * rad))
  const cells: string[] = []
  for (let y = Math.floor((lat - dLat) / CELL_DEG); y <= Math.floor((lat + dLat) / CELL_DEG); y++)
    for (let x = Math.floor((lng - dLng) / CELL_DEG); x <= Math.floor((lng + dLng) / CELL_DEG); x++)
      cells.push(`${y}:${x}`)
  return cells
}
