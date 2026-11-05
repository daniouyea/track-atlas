import { dataVersion, useDb } from './db'
import { haversine, type DetailPoint } from './geo'

/**
 * Enrutado «siguiendo mis tracks»: red de caminos hecha con las actividades del usuario.
 *
 * - Nodos: celdas de CELL m. Las pasadas repetidas por el mismo camino caen en las mismas celdas
 *   y se funden solas; la posición del nodo es la media de los puntos que caen en él.
 * - Aristas: puntos consecutivos de cada track.
 * - Uniones: nodos de tracks distintos a menos de JOIN m (cruces, la otra acera), más caras
 *   (JOIN_PENALTY) para que el camino prefiera seguir los tracks.
 *
 * La red se construye una vez por usuario (la primera petición tarda unos segundos) y se guarda
 * mientras no cambien sus actividades; cada tramo es solo una búsqueda A*.
 */
const CELL = 15
const JOIN = 25
const JOIN_PENALTY = 3
/** distancia máxima para enganchar un punto a la red */
export const SNAP_MAX = 250

type LngLat = [number, number]

/** Red compacta (CSR): las aristas del nodo i son to[off[i] .. off[i+1]) con peso w. */
interface Graph {
  lng: Float64Array
  lat: Float64Array
  ele: Float32Array // NaN si no hay
  off: Int32Array
  to: Int32Array
  w: Float32Array
  /** celda → nodo para buscar el nodo más cercano: claves ordenadas + nodo de cada una */
  cellKeys: Float64Array
  cellNodes: Int32Array
}

// Celda de CELL m. El ancho en grados depende de la latitud de cada punto: entre puntos cercanos
// es prácticamente el mismo, así que las celdas vecinas siguen siendo coherentes.
const KY = 110540 / CELL
const kx = (lat: number) => 111320 * Math.cos(lat * Math.PI / 180) / CELL
const cellXY = (lng: number, lat: number) => [Math.round(lng * kx(lat)), Math.round(lat * KY)] as const
// clave numérica (mucho más rápida que una cadena en un Map)
const keyOf = (x: number, y: number) => (x + 2 ** 22) * 2 ** 23 + (y + 2 ** 22)

function buildGraph(userId: number): Graph {
  const index = new Map<number, number>()
  const sx: number[] = [], sy: number[] = [], se: number[] = [], ne: number[] = [], n: number[] = []
  const links: number[][] = []
  const node = (lng: number, lat: number, ele: number | null) => {
    const [x, y] = cellXY(lng, lat)
    const k = keyOf(x, y)
    let i = index.get(k)
    if (i === undefined) {
      i = n.length
      index.set(k, i)
      sx.push(0); sy.push(0); se.push(0); ne.push(0); n.push(0); links.push([])
    }
    sx[i]! += lng; sy[i]! += lat; n[i]!++
    if (ele != null) { se[i]! += ele; ne[i]!++ }
    return i
  }
  const link = (a: number, b: number) => {
    if (a === b || links[a]!.includes(b)) return
    links[a]!.push(b); links[b]!.push(a)
  }

  // se lee cada track y se suelta (sin pasar por la caché de la comparación: ocuparía cientos de MB)
  for (const row of useDb().prepare('SELECT detail FROM tracks WHERE user_id = ?').iterate(userId) as Iterable<{ detail: string }>) {
    let prev = -1
    for (const p of JSON.parse(row.detail) as DetailPoint[]) {
      const i = node(p[0], p[1], p[2])
      if (prev >= 0) link(prev, i)
      prev = i
    }
  }

  const count = n.length
  const lng = new Float64Array(count), lat = new Float64Array(count), ele = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    lng[i] = sx[i]! / n[i]!
    lat[i] = sy[i]! / n[i]!
    ele[i] = ne[i] ? se[i]! / ne[i]! : NaN
  }
  const dist = (a: number, b: number) => haversine(lat[a]!, lng[a]!, lat[b]!, lng[b]!)

  // uniones entre nodos cercanos no conectados (otro track que pasa al lado); negativas = penalizadas
  const reach = Math.ceil(JOIN / CELL)
  for (let a = 0; a < count; a++) {
    const [cx, cy] = cellXY(lng[a]!, lat[a]!)
    for (let dx = -reach; dx <= reach; dx++) {
      for (let dy = -reach; dy <= reach; dy++) {
        const b = index.get(keyOf(cx + dx, cy + dy))
        if (b === undefined || b <= a || links[a]!.includes(b) || links[a]!.includes(-b - 1)) continue
        if (dist(a, b) > JOIN) continue
        links[a]!.push(-b - 1); links[b]!.push(-a - 1)
      }
    }
  }

  // a formato compacto
  const off = new Int32Array(count + 1)
  for (let i = 0; i < count; i++) off[i + 1] = off[i]! + links[i]!.length
  const to = new Int32Array(off[count]!), w = new Float32Array(off[count]!)
  for (let a = 0; a < count; a++) {
    let k = off[a]!
    for (const l of links[a]!) {
      const b = l >= 0 ? l : -l - 1
      to[k] = b
      w[k] = l >= 0 ? dist(a, b) : dist(a, b) * JOIN_PENALTY
      k++
    }
  }
  const keys = Float64Array.from(index.keys()).sort()
  const cellNodes = Int32Array.from(keys, k => index.get(k)!)
  return { lng, lat, ele, off, to, w, cellKeys: keys, cellNodes }
}

function nodeAt(g: Graph, key: number) {
  let lo = 0, hi = g.cellKeys.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const k = g.cellKeys[mid]!
    if (k === key) return g.cellNodes[mid]!
    if (k < key) lo = mid + 1
    else hi = mid - 1
  }
  return undefined
}

// Red completa por usuario, construida una vez y guardada hasta que cambien sus actividades.
// Solo las de los últimos usuarios activos, para acotar la memoria.
const graphs = new Map<number, { version: string, graph: Graph }>()
const MAX_GRAPHS = 3

function userGraph(userId: number) {
  const version = dataVersion(userId)
  const cached = graphs.get(userId)
  if (cached?.version === version) {
    graphs.delete(userId); graphs.set(userId, cached) // el más reciente, al final
    return cached.graph
  }
  const t = Date.now()
  const graph = buildGraph(userId)
  const mb = (b: number) => Math.round(b / 2 ** 20)
  console.log(`[routing] red del usuario ${userId}: ${graph.lng.length} nodos, ${graph.to.length / 2} aristas, ${Date.now() - t} ms, heap ${mb(process.memoryUsage().heapUsed)} MB`)
  graphs.set(userId, { version, graph })
  while (graphs.size > MAX_GRAPHS) graphs.delete(graphs.keys().next().value!)
  return graph
}

/** Nodo más cercano a un punto (a menos de SNAP_MAX m), buscando en las celdas de alrededor. */
function nearest(g: Graph, p: LngLat) {
  const [cx, cy] = cellXY(p[0], p[1])
  const reach = Math.ceil(SNAP_MAX / CELL)
  let best = -1, bestD = Infinity
  for (let dx = -reach; dx <= reach; dx++) {
    for (let dy = -reach; dy <= reach; dy++) {
      const i = nodeAt(g, keyOf(cx + dx, cy + dy))
      if (i === undefined) continue
      const d = haversine(p[1], p[0], g.lat[i]!, g.lng[i]!)
      if (d < bestD) { bestD = d; best = i }
    }
  }
  return bestD <= SNAP_MAX ? best : -1
}

/** Cola de prioridad mínima (montículo binario) para A*. */
class Heap {
  private items: number[] = []
  private keys: number[] = []
  get size() { return this.items.length }
  push(item: number, key: number) {
    this.items.push(item); this.keys.push(key)
    let i = this.items.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (this.keys[p]! <= this.keys[i]!) break
      this.swap(i, p); i = p
    }
  }
  pop() {
    const top = this.items[0]!
    const lastItem = this.items.pop()!, lastKey = this.keys.pop()!
    if (this.items.length) {
      this.items[0] = lastItem; this.keys[0] = lastKey
      let i = 0
      for (;;) {
        const l = 2 * i + 1, r = l + 1
        let m = i
        if (l < this.items.length && this.keys[l]! < this.keys[m]!) m = l
        if (r < this.items.length && this.keys[r]! < this.keys[m]!) m = r
        if (m === i) break
        this.swap(i, m); i = m
      }
    }
    return top
  }
  private swap(a: number, b: number) {
    [this.items[a], this.items[b]] = [this.items[b]!, this.items[a]!];
    [this.keys[a], this.keys[b]] = [this.keys[b]!, this.keys[a]!]
  }
}

function astar(g: Graph, from: number, to: number) {
  const h = (i: number) => haversine(g.lat[i]!, g.lng[i]!, g.lat[to]!, g.lng[to]!)
  const cost = new Float64Array(g.lng.length).fill(Infinity)
  const prev = new Int32Array(g.lng.length).fill(-1)
  const heap = new Heap()
  cost[from] = 0
  heap.push(from, h(from))
  while (heap.size) {
    const i = heap.pop()
    if (i === to) break
    for (let k = g.off[i]!; k < g.off[i + 1]!; k++) {
      const j = g.to[k]!
      const c = cost[i]! + g.w[k]!
      if (c < cost[j]!) { cost[j] = c; prev[j] = i; heap.push(j, c + h(j)) }
    }
  }
  if (cost[to] === Infinity) return null
  const path: number[] = []
  for (let i = to; i !== -1; i = prev[i]!) path.push(i)
  return path.reverse()
}

export type RoutePoint = [number, number, number | null]

/** Punto de la red más cercano (para enganchar un punto de paso), o null si no hay tracks cerca. */
export function snapToTracks(userId: number, p: LngLat): LngLat | null {
  const g = userGraph(userId)
  const i = nearest(g, p)
  return i < 0 ? null : [g.lng[i]!, g.lat[i]!]
}

/** Camino entre dos puntos siguiendo los tracks del usuario. */
export function routeOnTracks(userId: number, from: LngLat, to: LngLat) {
  const g = userGraph(userId)
  const a = nearest(g, from), b = nearest(g, to)
  if (a < 0 || b < 0) return { error: `No hay tracks tuyos a menos de ${SNAP_MAX} m del ${a < 0 ? 'inicio' : 'final'} del tramo` as const }
  const path = astar(g, a, b)
  if (!path) return { error: 'Tus tracks no conectan estos dos puntos' as const }
  const coordinates: RoutePoint[] = path.map(i => [
    Math.round(g.lng[i]! * 1e6) / 1e6, Math.round(g.lat[i]! * 1e6) / 1e6,
    Number.isNaN(g.ele[i]!) ? null : Math.round(g.ele[i]! * 10) / 10,
  ])
  let distanceM = 0
  for (let k = 1; k < coordinates.length; k++) distanceM += haversine(coordinates[k - 1]![1], coordinates[k - 1]![0], coordinates[k]![1], coordinates[k]![0])
  return { coordinates, distanceM: Math.round(distanceM) }
}
