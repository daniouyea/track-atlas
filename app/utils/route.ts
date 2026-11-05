/**
 * Ruta planificada: puntos de paso y, entre cada dos, un tramo calculado con un modo.
 * El tramo i une waypoints[i] y waypoints[i + 1]; sus coords incluyen los dos extremos.
 */
export type LegMode = 'tracks' | 'brouter' | 'straight' | 'fixed'
export type Coord = [number, number, number | null]
export type LngLat = [number, number]

export interface Leg {
  /** tracks: siguiendo mis tracks · brouter: por caminos · straight: línea recta · fixed: track importado */
  mode: LegMode
  /** perfil de BRouter con el que se calculó (modo brouter) */
  profile?: string
  coords: Coord[]
  /** si no se pudo calcular como se pidió (p. ej. sin tracks cerca) y quedó en línea recta */
  error?: string
}

export interface RouteDoc {
  id: string
  name: string
  waypoints: LngLat[]
  legs: Leg[]
}

const R = 6371008.8
const rad = Math.PI / 180

export function haversine(a: LngLat | Coord, b: LngLat | Coord) {
  const dLat = (b[1] - a[1]) * rad, dLng = (b[0] - a[0]) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export const straightLeg = (a: LngLat, b: LngLat, error?: string): Leg =>
  ({ mode: 'straight', coords: [[a[0], a[1], null], [b[0], b[1], null]], ...(error ? { error } : {}) })

export function lineDistance(coords: Coord[]) {
  let d = 0
  for (let i = 1; i < coords.length; i++) d += haversine(coords[i - 1]!, coords[i]!)
  return d
}

/** Todas las coordenadas de la ruta, sin repetir el punto común entre tramos. */
export function routeCoords(doc: RouteDoc): Coord[] {
  const out: Coord[] = []
  doc.legs.forEach((l, i) => out.push(...(i ? l.coords.slice(1) : l.coords)))
  return out
}

/**
 * Altitud suavizada (media móvil de ±50 m). En los tramos por tracks cada punto es la media de
 * varias actividades y la de los vecinos sale de otras: sin suavizar, ese ruido infla el desnivel.
 */
export function smoothElevation(coords: Coord[], halfWindowM = 50): (number | null)[] {
  const dist: number[] = [0]
  for (let i = 1; i < coords.length; i++) dist.push(dist[i - 1]! + haversine(coords[i - 1]!, coords[i]!))
  let lo = 0, hi = 0, sum = 0, n = 0
  return coords.map((c, i) => {
    // ventana deslizante [lo, hi) de puntos a menos de halfWindowM
    while (hi < coords.length && dist[hi]! - dist[i]! <= halfWindowM) {
      const e = coords[hi]![2]
      if (e != null) { sum += e; n++ }
      hi++
    }
    while (dist[i]! - dist[lo]! > halfWindowM) {
      const e = coords[lo]![2]
      if (e != null) { sum -= e; n-- }
      lo++
    }
    return c[2] == null || !n ? c[2] : sum / n
  })
}

/** Desnivel positivo con histéresis sobre la altitud suavizada. */
export function elevationGain(coords: Coord[], threshold = 3) {
  let gain = 0
  let ref: number | null = null
  for (const e of smoothElevation(coords)) {
    if (e == null) continue
    if (ref == null) { ref = e; continue }
    if (e - ref >= threshold) { gain += e - ref; ref = e }
    else if (ref - e >= threshold) ref = e
  }
  return Math.round(gain)
}

/** Puntos para el perfil de elevación: [lng, lat, ele, distancia acumulada, t] */
export function routeProfile(doc: RouteDoc): [number, number, number | null, number, null][] {
  let d = 0
  const coords = routeCoords(doc)
  const ele = smoothElevation(coords)
  return coords.map((c, i) => {
    if (i) d += haversine(coords[i - 1]!, c)
    return [c[0], c[1], ele[i]!, d, null]
  })
}

/**
 * Parte un tramo en el punto de su línea más cercano a `p`, sin cambiar la geometría.
 * Devuelve los dos tramos y el punto de corte (el nuevo punto de paso).
 */
export function splitLeg(leg: Leg, p: LngLat): { before: Leg, after: Leg, at: LngLat } {
  const kx = Math.cos(p[1] * rad)
  let best = { d: Infinity, i: 0, t: 0 }
  for (let i = 0; i + 1 < leg.coords.length; i++) {
    const a = leg.coords[i]!, b = leg.coords[i + 1]!
    const ax = (a[0] - p[0]) * kx, ay = a[1] - p[1], bx = (b[0] - p[0]) * kx, by = b[1] - p[1]
    const dx = bx - ax, dy = by - ay
    const l2 = dx * dx + dy * dy
    const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0
    const ex = ax + t * dx, ey = ay + t * dy
    const d = ex * ex + ey * ey
    if (d < best.d) best = { d, i, t }
  }
  const a = leg.coords[best.i]!, b = leg.coords[best.i + 1] ?? a
  const ele = a[2] != null && b[2] != null ? a[2] + (b[2] - a[2]) * best.t : (a[2] ?? b[2])
  const cut: Coord = [a[0] + (b[0] - a[0]) * best.t, a[1] + (b[1] - a[1]) * best.t, ele]
  return {
    before: { mode: leg.mode, coords: [...leg.coords.slice(0, best.i + 1), cut] },
    after: { mode: leg.mode, coords: [cut, ...leg.coords.slice(best.i + 1)] },
    at: [cut[0], cut[1]],
  }
}

/** Ruta a partir de un track existente: un único tramo fijo con su geometría. */
export function routeFromTrack(name: string, coords: Coord[]): RouteDoc {
  return {
    id: crypto.randomUUID(),
    name,
    waypoints: [[coords[0]![0], coords[0]![1]], [coords.at(-1)![0], coords.at(-1)![1]]],
    legs: [{ mode: 'fixed', coords }],
  }
}

/** Perfiles de bici de BRouter que se ofrecen (el servidor solo acepta estos) */
export const BROUTER_PROFILES = [
  { id: 'trekking', name: 'Cicloturismo' },
  { id: 'gravel', name: 'Gravel' },
  { id: 'mtb', name: 'MTB' },
  { id: 'fastbike', name: 'Carretera' },
  { id: 'fastbike-verylowtraffic', name: 'Carretera, poco tráfico' },
  { id: 'safety', name: 'Lo más seguro' },
] as const

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function toGpx(doc: RouteDoc) {
  const pts = routeCoords(doc).map(c =>
    `      <trkpt lat="${c[1].toFixed(6)}" lon="${c[0].toFixed(6)}">${c[2] != null ? `<ele>${c[2].toFixed(1)}</ele>` : ''}</trkpt>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Track Atlas" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${xml(doc.name)}</name></metadata>
  <trk>
    <name>${xml(doc.name)}</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`
}

export function downloadGpx(doc: RouteDoc) {
  const blob = new Blob([toGpx(doc)], { type: 'application/gpx+xml' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${doc.name.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'ruta'}.gpx`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
