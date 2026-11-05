import { reactive, computed, shallowRef, triggerRef, watch } from 'vue'
import {
  elevationGain, lineDistance, routeCoords, routeFromTrack, splitLeg, straightLeg, downloadGpx,
  type Coord, type Leg, type LegMode, type LngLat, type RouteDoc,
} from '~/utils/route'
import { withDemElevation } from '~/utils/dem'

export interface SavedRoute { id: string, name: string, distanceM: number, elevationGainM: number, updatedAt: string }

/** Modo con el que se calculan los tramos nuevos o modificados */
export type DrawMode = Exclude<LegMode, 'fixed'>
/** Motor de cálculo de rutas (ver /api/routing/engines) */
export type Engine = 'tracks' | 'brouter' | 'ors' | 'graphhopper' | 'mapbox'
export interface EngineInfo { id: Engine, name: string, description: string, available: boolean, profiles: { id: string, name: string }[] }
/** De dónde sale la altitud: el motor de rutas o el modelo digital del terreno */
export type ElevationSource = 'engine' | 'dem'

const MAX_HISTORY = 40
const PREFS_KEY = 'track-atlas:route-editor'

interface Prefs { engine: Engine, straight: boolean, profile: string, elevation: ElevationSource }
function loadPrefs(): Prefs {
  const defaults: Prefs = { engine: 'tracks', straight: false, profile: 'trekking', elevation: 'dem' }
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}')
    // versión anterior: { mode: 'tracks' | 'brouter' | 'straight' }
    if (saved.mode && !saved.engine) saved.engine = saved.mode === 'straight' ? 'tracks' : saved.mode
    if (saved.mode === 'straight') saved.straight = true
    return { ...defaults, ...saved }
  } catch {
    return defaults
  }
}
const prefs = loadPrefs()

const editor = reactive({
  active: false,
  /** motor para tramos nuevos */
  engine: prefs.engine,
  /** línea recta: los tramos nuevos no se calculan (para trazar a mano) */
  straight: prefs.straight,
  /** perfil del motor (BRouter) */
  profile: prefs.profile,
  elevation: prefs.elevation,
  engines: [] as EngineInfo[],
  /** calculando la altitud del terreno */
  elevating: false,
  /** tramos calculándose */
  pending: 0,
  dirty: false,
  saving: false,
  message: '' as string,
  saved: [] as SavedRoute[],
})

// la ruta en sí va en un shallowRef: los tramos pueden tener miles de puntos y no hace falta reactividad profunda
watch(() => [editor.engine, editor.straight, editor.profile, editor.elevation], () => localStorage.setItem(PREFS_KEY,
  JSON.stringify({ engine: editor.engine, straight: editor.straight, profile: editor.profile, elevation: editor.elevation } satisfies Prefs)))

/** modo efectivo para los tramos nuevos */
const drawMode = computed<DrawMode>(() => editor.straight ? 'straight' : (editor.engine as DrawMode))

async function loadEngines() {
  if (!editor.engines.length) editor.engines = await $fetch<EngineInfo[]>('/api/routing/engines')
}

const doc = shallowRef<RouteDoc | null>(null)
// accesible desde la consola y las pruebas automáticas
if (import.meta.client) (window as unknown as { __routeDoc: typeof doc }).__routeDoc = doc
const undoStack: string[] = []
const redoStack: string[] = []
const history = reactive({ canUndo: false, canRedo: false })

/** número de cálculo por tramo: si llega la respuesta de uno antiguo, se descarta */
let legToken = 0
const legTokens = new WeakMap<Leg, number>()

const touch = () => {
  triggerRef(doc)
  editor.dirty = true
}

function snapshot() {
  if (!doc.value) return
  undoStack.push(JSON.stringify(doc.value))
  if (undoStack.length > MAX_HISTORY) undoStack.shift()
  redoStack.length = 0
  history.canUndo = true
  history.canRedo = false
}

function restore(from: string[], to: string[]) {
  const s = from.pop()
  if (!s || !doc.value) return
  to.push(JSON.stringify(doc.value))
  doc.value = JSON.parse(s)
  history.canUndo = undoStack.length > 0
  history.canRedo = redoStack.length > 0
  editor.dirty = true
}

const undo = () => restore(undoStack, redoStack)
const redo = () => restore(redoStack, undoStack)

/**
 * Coordenadas de la ruta con la altitud elegida. Con el modelo del terreno se calculan en segundo
 * plano (densificadas cada 25 m) y se descarta el resultado si la ruta ha cambiado entretanto.
 */
const elevated = shallowRef<Coord[]>([])
let elevToken = 0
let elevTimer: ReturnType<typeof setTimeout> | undefined
// el shallowRef directamente (no un getter): así triggerRef también avisa cuando cambia por dentro
watch([doc, () => editor.elevation, () => editor.active], () => {
  clearTimeout(elevTimer)
  const d = doc.value
  const coords = d && editor.active ? routeCoords(d) : []
  const token = ++elevToken
  if (editor.elevation === 'engine' || coords.length < 2) {
    elevated.value = coords
    editor.elevating = false
    return
  }
  editor.elevating = true
  elevTimer = setTimeout(async () => {
    const r = await withDemElevation(coords)
    if (token !== elevToken) return
    elevated.value = r
    editor.elevating = false
  }, 250)
})

const stats = computed(() => {
  const d = doc.value
  if (!d) return { distanceM: 0, elevationGainM: 0, points: 0 }
  return { distanceM: lineDistance(routeCoords(d)), elevationGainM: elevationGain(elevated.value), points: d.waypoints.length }
})

/** Coordenadas para exportar una ruta (guardada o en edición) con la altitud elegida */
async function exportCoords(d: RouteDoc) {
  const coords = routeCoords(d)
  return editor.elevation === 'dem' ? withDemElevation(coords) : coords
}

async function exportGpx(d: RouteDoc | null = doc.value) {
  if (!d) return
  const coords = d === doc.value && elevated.value.length && !editor.elevating ? elevated.value : await exportCoords(d)
  downloadGpx(d.name, coords)
}

async function snap(p: LngLat): Promise<LngLat> {
  if (drawMode.value !== 'tracks') return p
  editor.pending++
  try {
    const r = await $fetch<{ point: LngLat | null }>('/api/routing/snap', { method: 'POST', body: { point: p } })
    return r.point ?? p
  } catch {
    return p
  } finally {
    editor.pending--
  }
}

/**
 * Las operaciones se ejecutan de una en una: con dos clics seguidos, el segundo punto podría
 * engancharse antes que el primero y quedar desordenado.
 */
let queue: Promise<unknown> = Promise.resolve()
function enqueue<A extends unknown[], R>(fn: (...args: A) => Promise<R> | R) {
  return (...args: A): Promise<R> => {
    const run = queue.then(() => fn(...args))
    queue = run.catch(() => {})
    return run
  }
}

/** Calcula el tramo i con el modo actual; mientras tanto se ve en línea recta. */
async function computeLeg(i: number, mode: DrawMode = drawMode.value, profile = editor.profile) {
  const d = doc.value
  if (!d) return
  const a = d.waypoints[i]!, b = d.waypoints[i + 1]!
  const preview = straightLeg(a, b)
  d.legs[i] = preview
  triggerRef(doc)
  if (mode === 'straight') return
  const token = ++legToken
  legTokens.set(preview, token)
  editor.pending++
  try {
    if (mode !== 'brouter' && mode !== 'tracks') throw new Error(`Motor no disponible: ${mode}`)
    const r = mode === 'brouter'
      ? await $fetch<{ coordinates: Coord[] }>('/api/routing/brouter', { method: 'POST', body: { from: a, to: b, profile } })
      : await $fetch<{ coordinates: Coord[] }>('/api/routing/tracks', { method: 'POST', body: { from: a, to: b } })
    if (doc.value !== d || legTokens.get(d.legs[i]!) !== token) return // la ruta o el tramo han cambiado
    // los extremos exactos del tramo son los puntos de paso
    const coords: Coord[] = [[a[0], a[1], r.coordinates[0]?.[2] ?? null], ...r.coordinates, [b[0], b[1], r.coordinates.at(-1)?.[2] ?? null]]
    d.legs[i] = mode === 'brouter' ? { mode, profile, coords } : { mode, coords }
  } catch (e: any) {
    if (doc.value !== d || legTokens.get(d.legs[i]!) !== token) return
    d.legs[i] = straightLeg(a, b, e?.data?.statusMessage ?? e?.message ?? 'No se pudo calcular el tramo')
  } finally {
    editor.pending--
  }
  triggerRef(doc)
}

const addPoint = enqueue(async (p: LngLat) => {
  const d = doc.value
  if (!d) return
  const pt = await snap(p)
  snapshot()
  d.waypoints.push(pt)
  if (d.waypoints.length > 1) d.legs.push(straightLeg(d.waypoints.at(-2)!, pt))
  touch()
  if (d.waypoints.length > 1) await computeLeg(d.waypoints.length - 2)
})

const movePoint = enqueue(async (i: number, p: LngLat) => {
  const d = doc.value
  if (!d) return
  const pt = await snap(p)
  snapshot()
  d.waypoints[i] = pt
  touch()
  await Promise.all([i > 0 ? computeLeg(i - 1) : null, i < d.legs.length ? computeLeg(i) : null])
})

/** Inserta un punto de paso sobre el tramo, sin cambiar la geometría (para luego arrastrarlo). */
const insertPoint = enqueue((legIndex: number, p: LngLat) => {
  const d = doc.value
  if (!d || !d.legs[legIndex]) return
  snapshot()
  const { before, after, at } = splitLeg(d.legs[legIndex]!, p)
  d.legs.splice(legIndex, 1, before, after)
  d.waypoints.splice(legIndex + 1, 0, at)
  touch()
  return legIndex + 1
})

const removePoint = enqueue(async (i: number) => {
  const d = doc.value
  if (!d) return
  snapshot()
  if (d.waypoints.length <= 2 && d.legs.length) {
    // queda un solo punto
    d.waypoints.splice(i, 1)
    d.legs = []
    touch()
    return
  }
  if (i === 0) { d.waypoints.shift(); d.legs.shift(); touch(); return }
  if (i === d.waypoints.length - 1) { d.waypoints.pop(); d.legs.pop(); touch(); return }
  const prev = d.legs[i - 1]!, next = d.legs[i]!
  d.waypoints.splice(i, 1)
  if (prev.mode === 'fixed' && next.mode === 'fixed') {
    // dos trozos del mismo track importado: se vuelven a unir tal cual
    d.legs.splice(i - 1, 2, { mode: 'fixed', coords: [...prev.coords, ...next.coords.slice(1)] })
    touch()
    return
  }
  d.legs.splice(i - 1, 2, straightLeg(d.waypoints[i - 1]!, d.waypoints[i]!))
  touch()
  await computeLeg(i - 1)
})

function reverse() {
  const d = doc.value
  if (!d) return
  snapshot()
  d.waypoints.reverse()
  d.legs = d.legs.reverse().map(l => ({ ...l, coords: [...l.coords].reverse() }))
  touch()
}

function clearRoute() {
  const d = doc.value
  if (!d) return
  snapshot()
  d.waypoints = []
  d.legs = []
  touch()
}

function open(next: RouteDoc) {
  doc.value = next
  undoStack.length = redoStack.length = 0
  history.canUndo = history.canRedo = false
  editor.active = true
  editor.dirty = false
  editor.message = ''
  // la red de tracks se construye la primera vez (unos segundos): se pide ya, en segundo plano
  $fetch('/api/routing/snap', { method: 'POST', body: { point: [0, 0] } }).catch(() => {})
  loadEngines().catch(() => {})
}

const startNew = () => open({ id: crypto.randomUUID(), name: 'Nueva ruta', waypoints: [], legs: [] })

function startFromTrack(name: string, coords: Coord[]) {
  open(routeFromTrack(`Ruta: ${name}`, coords))
  editor.dirty = true
}

async function loadSaved() {
  editor.saved = await $fetch<SavedRoute[]>('/api/routes')
}

async function openSaved(id: string) {
  open(await $fetch<RouteDoc>(`/api/routes/${id}`))
}

async function save() {
  const d = doc.value
  if (!d) return
  editor.saving = true
  try {
    await $fetch(`/api/routes/${d.id}`, {
      method: 'PUT',
      body: { name: d.name, waypoints: d.waypoints, legs: d.legs, distanceM: Math.round(stats.value.distanceM), elevationGainM: stats.value.elevationGainM },
    })
    editor.dirty = false
    editor.message = 'Ruta guardada'
    await loadSaved()
  } finally {
    editor.saving = false
  }
}

async function deleteSaved(id: string) {
  await $fetch(`/api/routes/${id}`, { method: 'DELETE' })
  await loadSaved()
}

/** Cierra el editor; si hay cambios sin guardar, pregunta. */
function close() {
  if (editor.dirty && doc.value?.waypoints.length && !confirm('Hay cambios sin guardar en la ruta. ¿Cerrar igualmente?')) return false
  editor.active = false
  doc.value = null
  return true
}

function rename(name: string) {
  if (!doc.value) return
  doc.value.name = name
  touch()
}

export function useRouteEditor() {
  return {
    editor, doc, stats, history, elevated, drawMode, loadEngines, exportGpx,
    startNew, startFromTrack, openSaved, loadSaved, save, deleteSaved, close, rename,
    addPoint, movePoint, insertPoint, removePoint, reverse, clearRoute, undo, redo,
  }
}
