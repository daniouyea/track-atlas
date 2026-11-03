import { reactive, computed, shallowReactive } from 'vue'
import { PALETTE } from '~/utils/format'

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

const state = reactive({
  activities: [] as Activity[],
  loaded: false,
  /** ids seleccionados, en orden de selección */
  selected: [] as string[],
  colors: {} as Record<string, string>,
  filters: { q: '', year: '', type: '' },
  showHeat: true,
  basemap: 'liberty',
  nearRadius: 100,
  near: null as null | { lng: number, lat: number, r: number, results: NearResult[], loading: boolean },
  /** punto resaltado desde el perfil de elevación: distancia recorrida (m) */
  hoverDistance: null as number | null,
  /** sube cada vez que se importan datos, para recargar trazas */
  dataVersion: 0,
  /** petición de encuadre para el mapa */
  fitRequest: null as null | { ids: string[] },
})

const details = shallowReactive<Record<string, ActivityDetail>>({})

const byId = computed(() => new Map(state.activities.map(a => [a.id, a])))

const filtered = computed(() => {
  const q = state.filters.q.trim().toLowerCase()
  return state.activities.filter(a =>
    (!q || a.name.toLowerCase().includes(q))
    && (!state.filters.year || a.startTime?.startsWith(state.filters.year))
    && (!state.filters.type || a.type === state.filters.type),
  )
})

const years = computed(() => [...new Set(state.activities.map(a => a.startTime?.slice(0, 4)).filter(Boolean))].sort().reverse() as string[])
const types = computed(() => [...new Set(state.activities.map(a => a.type).filter(Boolean))].sort() as string[])

async function loadActivities() {
  state.activities = await $fetch<Activity[]>('/api/activities')
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
  state.fitRequest = { ids }
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
  state.dataVersion++
}

export function useAtlas() {
  return { state, details, byId, filtered, years, types, loadActivities, loadDetail, toggle, focus, clearSelection, searchNear, afterImport }
}
