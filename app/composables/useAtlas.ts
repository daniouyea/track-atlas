import { reactive, computed, shallowReactive, shallowRef, watch } from 'vue'
import type { FeatureCollection, LineString } from 'geojson'
import { lineCrosses, type Bounds } from '~/utils/viewport'
import { routeProfile } from '~/utils/route'
import { useRouteEditor } from './useRouteEditor'
import { PALETTE } from '~/utils/format'
import { defaultStyle, type TrackStyle } from '~/utils/styles'

export interface Activity {
  id: string
  name: string
  type: string | null
  startTime: string | null
  distanceM: number | null
  movingTimeS: number | null
  elapsedTimeS: number | null
  elevationGainM: number | null
  gear: string | null
  bbox: [number, number, number, number]
}

/** [lng, lat, ele, dist_m, t_s] */
export type DetailPoint = [number, number, number | null, number, number | null]

export interface ActivityDetail extends Activity {
  description: string | null
  detail: DetailPoint[]
}

export interface NearResult { id: string, distanceM: number, atDistanceM: number }

type BBox = [number, number, number, number]

/** Track externo con el que comparar (fichero o URL de Strava) */
export interface RefTrack {
  name: string
  source: 'file' | 'mine' | 'strava-activity' | 'strava-route' | 'strava-segment'
  url?: string
  activityId?: string
  detail: DetailPoint[]
  distanceM: number
  elevationGainM: number
  bbox: BBox
}

export interface Comparison {
  toleranceM: number
  totalM: number
  coveredM: number
  segments: GeoJSON.FeatureCollection<GeoJSON.LineString, { known: boolean, lengthM: number }>
  matches: { id: string, overlapM: number, pct: number }[]
}

export interface CompareError {
  message: string
  exportUrl?: string
}

export interface User { id: number, firstname: string | null, lastname: string | null, avatar: string | null }

export interface SyncResult {
  imported: number
  pending: number
  firstSync: boolean
  firstSyncLimit: number
  errors: { file: string, error: string }[]
}

/** pista que el perfil de elevación y el marcador del mapa tratan igual */
export interface ProfileTrack { id: string, name: string, color: string, detail: DetailPoint[], dashed?: boolean }

export const REF_ID = '__ref'
export const ROUTE_ID = '__route'
/** color de la ruta en edición (violeta: no se confunde con los de selección ni con la comparación) */
export const ROUTE_COLOR = '#7c3aed'
const STYLE_KEY = 'track-atlas:styles'
const PREFS_KEY = 'track-atlas:prefs'

function loadJson<T>(key: string, fallback: T): T {
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(key) ?? '{}') }
  } catch {
    return fallback
  }
}

// preferencias que se recuerdan entre visitas
const prefs = loadJson(PREFS_KEY, { basemap: 'liberty', showHeat: true, nearRadius: 100, compareTolerance: 30, inView: false, sidebarCollapsed: false })

const state = reactive({
  /** qué muestra la barra lateral */
  sidebarView: 'activities' as 'activities' | 'routes',
  /** barra lateral plegada a una franja de iconos */
  sidebarCollapsed: prefs.sidebarCollapsed,
  /** null: sin sesión; undefined: aún comprobando */
  user: undefined as User | null | undefined,
  /** resultado de la última sincronización con Strava, para avisar al usuario */
  syncNotice: null as SyncResult | null,
  syncing: false,
  /** indicación de arrastrar el GPX recién descargado de Strava al mapa */
  downloadHint: false,
  stravaConfigured: true,
  activities: [] as Activity[],
  loaded: false,
  /** ids seleccionados, en orden de selección */
  selected: [] as string[],
  colors: {} as Record<string, string>,
  /** inView: solo las actividades que pasan por lo encuadrado en el mapa */
  filters: { q: '', year: '', type: '', inView: prefs.inView },
  /** zona encuadrada en el mapa (se actualiza cuando el usuario lo mueve) */
  viewBounds: null as Bounds | null,
  showHeat: prefs.showHeat,
  basemap: prefs.basemap,
  nearRadius: prefs.nearRadius,
  near: null as null | { lng: number, lat: number, r: number, results: NearResult[], loading: boolean },
  /** punto resaltado desde el perfil de elevación: distancia recorrida (m) */
  hoverDistance: null as number | null,
  /** petición de encuadre para el mapa */
  fitRequest: null as null | { bboxes: BBox[] },
  reference: null as RefTrack | null,
  comparison: null as Comparison | null,
  compareTolerance: prefs.compareTolerance,
  compareBusy: false,
  compareError: null as CompareError | null,
  /** ajustes de estilo por mapa base (solo lo que difiere de los valores por defecto) */
  styleOverrides: loadJson<Record<string, Partial<TrackStyle>>>(STYLE_KEY, {}),
})

watch(() => state.styleOverrides, v => localStorage.setItem(STYLE_KEY, JSON.stringify(v)), { deep: true })
watch(
  () => ({ basemap: state.basemap, showHeat: state.showHeat, nearRadius: state.nearRadius, compareTolerance: state.compareTolerance, inView: state.filters.inView, sidebarCollapsed: state.sidebarCollapsed }),
  v => localStorage.setItem(PREFS_KEY, JSON.stringify(v)),
)

/** estilo efectivo para el mapa base actual */
const style = computed<TrackStyle>(() => ({ ...defaultStyle(state.basemap), ...state.styleOverrides[state.basemap] }))

function setStyle(patch: Partial<TrackStyle>) {
  state.styleOverrides[state.basemap] = { ...state.styleOverrides[state.basemap], ...patch }
}

function resetStyle() {
  delete state.styleOverrides[state.basemap]
}

const details = shallowReactive<Record<string, ActivityDetail>>({})

const byId = computed(() => new Map(state.activities.map(a => [a.id, a])))

/** Trazas simplificadas de todas las actividades: el heatmap y el filtro por zona */
const tracks = shallowRef<FeatureCollection<LineString, { id: string, type: string | null, year: string | null }> | null>(null)
const trackById = computed(() => new Map((tracks.value?.features ?? []).map(f => [f.properties.id, f.geometry.coordinates])))

/** Filtros de nombre, año y tipo (los que también se aplican al heatmap) */
const filteredBase = computed(() => {
  const q = state.filters.q.trim().toLowerCase()
  return state.activities.filter(a =>
    (!q || a.name.toLowerCase().includes(q))
    && (!state.filters.year || a.startTime?.startsWith(state.filters.year))
    && (!state.filters.type || a.type === state.filters.type),
  )
})

const zoneActive = computed(() => state.filters.inView && !!state.viewBounds && !!tracks.value)

/** Lo que muestra la lista: además, solo lo que pasa por la zona encuadrada si está activado */
const filtered = computed(() => {
  if (!zoneActive.value) return filteredBase.value
  const r = state.viewBounds!
  // las seleccionadas se quedan siempre, para poder quitarlas
  return filteredBase.value.filter(a => state.selected.includes(a.id) || lineCrosses(trackById.value.get(a.id) ?? [], a.bbox, r))
})

const years = computed(() => [...new Set(state.activities.map(a => a.startTime?.slice(0, 4)).filter(Boolean))].sort().reverse() as string[])
const types = computed(() => [...new Set(state.activities.map(a => a.type).filter(Boolean))].sort() as string[])

async function loadMe() {
  const me = await $fetch<{ user: User | null, stravaConfigured: boolean }>('/api/auth/me')
  state.user = me.user
  state.stravaConfigured = me.stravaConfigured
  return me.user
}

/** Trae de Strava las actividades nuevas; avisa solo si ha habido novedades. */
async function syncStrava() {
  if (state.syncing) return
  state.syncing = true
  try {
    const r = await $fetch<SyncResult>('/api/strava/sync', { method: 'POST' })
    if (r.imported) await afterImport()
    if (r.imported || r.pending || r.errors.length) state.syncNotice = r
    return r
  } catch (e) {
    console.warn('No se pudo sincronizar con Strava', e)
  } finally {
    state.syncing = false
  }
}

async function logout() {
  await $fetch('/api/auth/logout', { method: 'POST' })
  location.href = '/'
}

async function loadActivities() {
  const [activities, fc] = await Promise.all([
    $fetch<Activity[]>('/api/activities'),
    $fetch<typeof tracks.value>('/api/tracks'),
  ])
  tracks.value = fc
  state.activities = activities
  state.loaded = true
  // descarta selecciones de actividades que ya no existen
  state.selected = state.selected.filter(id => byId.value.has(id))
}

async function loadDetail(id: string) {
  details[id] ??= await $fetch<ActivityDetail>(`/api/activities/${id}`)
  return details[id]
}

async function toggle(id: string) {
  if (state.selected.includes(id)) {
    state.selected = state.selected.filter(s => s !== id)
    delete state.colors[id]
    return
  }
  const used = new Set(Object.values(state.colors))
  state.colors[id] = PALETTE.find(c => !used.has(c)) ?? PALETTE[state.selected.length % PALETTE.length]!
  state.selected.push(id)
  await loadDetail(id)
}

function focus(ids: string[]) {
  state.fitRequest = { bboxes: ids.map(id => byId.value.get(id)?.bbox).filter(Boolean) as BBox[] }
}

function setColor(id: string, color: string) {
  state.colors[id] = color
}

const profileTracks = computed<ProfileTrack[]>(() => {
  const tracks: ProfileTrack[] = state.selected
    .filter(id => details[id])
    .map(id => ({ id, name: details[id]!.name, color: state.colors[id]!, detail: details[id]!.detail }))
  if (state.reference) tracks.unshift({ id: REF_ID, name: state.reference.name, color: '#111', detail: state.reference.detail, dashed: true })
  const { editor, doc, elevated } = useRouteEditor()
  if (editor.active && doc.value && elevated.value.length > 1) tracks.unshift({ id: ROUTE_ID, name: doc.value.name, color: ROUTE_COLOR, detail: routeProfile(elevated.value) })
  return tracks
})

// --- comparar un track externo con mis actividades ---

function toCompareError(e: any): CompareError {
  const d = e?.data
  return { message: d?.statusMessage ?? d?.message ?? e?.message ?? String(e), ...d?.data }
}

async function setReference(load: () => Promise<RefTrack>) {
  state.downloadHint = false
  state.compareBusy = true
  state.compareError = null
  try {
    state.reference = await load()
    state.comparison = null
    state.fitRequest = { bboxes: [state.reference.bbox] }
    await runComparison()
  } catch (e) {
    state.compareError = toCompareError(e)
  } finally {
    state.compareBusy = false
  }
}

const loadReferenceUrl = (url: string) =>
  setReference(() => $fetch<RefTrack>('/api/reference/strava', { method: 'POST', body: { url } }))

const loadReferenceFile = (file: File) =>
  setReference(() => $fetch<RefTrack>('/api/reference/file', {
    method: 'POST', body: file, headers: { 'X-Filename': encodeURIComponent(file.name) },
  }))

async function runComparison() {
  const ref = state.reference
  if (!ref) return
  const result = await $fetch<Comparison>('/api/compare', {
    method: 'POST',
    body: { detail: ref.detail, toleranceM: state.compareTolerance, excludeId: ref.activityId },
  })
  if (state.reference === ref) state.comparison = result
}
watch(() => state.compareTolerance, () => runComparison().catch(e => (state.compareError = toCompareError(e))))

function clearReference() {
  state.reference = null
  state.comparison = null
  state.compareError = null
}

function clearSelection() {
  state.selected = []
  state.colors = {}
}

async function searchNear(lng: number, lat: number) {
  const r = state.nearRadius
  state.near = { lng, lat, r, results: [], loading: true }
  const results = await $fetch<NearResult[]>('/api/near', { query: { lng, lat, r } })
  if (state.near?.lng !== lng || state.near.lat !== lat) return // llegó otra búsqueda después
  // más reciente primero, como la lista
  results.sort((a, b) => (byId.value.get(b.id)?.startTime ?? '').localeCompare(byId.value.get(a.id)?.startTime ?? ''))
  state.near = { lng, lat, r, results, loading: false }
}

async function afterImport() {
  for (const k of Object.keys(details)) delete details[k]
  await loadActivities()
  // hay actividades nuevas con las que comparar
  runComparison().catch(() => {})
}

export function useAtlas() {
  return {
    state, details, byId, filtered, filteredBase, zoneActive, tracks, years, types, style, profileTracks,
    loadMe, logout, syncStrava, loadActivities, loadDetail, toggle, focus, setColor, clearSelection, searchNear, afterImport,
    setStyle, resetStyle, loadReferenceUrl, loadReferenceFile, runComparison, clearReference,
  }
}
