<script setup lang="ts">
import { Map as MlMap, NavigationControl, ScaleControl, GeolocateControl, LngLatBounds, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl'
// maplibre v6 resuelve su worker relativo a import.meta.url, que Vite rompe al empaquetar:
// se le pasa explícitamente (el worker es autocontenido)
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import type { FeatureCollection } from 'geojson'
import { basemaps } from '~/utils/basemaps'
import type { DetailPoint } from '~/composables/useAtlas'

const { state, details, filtered } = useAtlas()
const el = ref<HTMLDivElement>()
let map: MlMap | undefined

setWorkerUrl(workerUrl)

const empty: FeatureCollection = { type: 'FeatureCollection', features: [] }
const styleFor = (id: string) => (basemaps.find(b => b.id === id) ?? basemaps[0]!).style as string | StyleSpecification

onMounted(() => {
  map = new MlMap({
    container: el.value!,
    style: styleFor(state.basemap),
    center: [-3.7, 40.42],
    zoom: 6,
    attributionControl: { compact: true },
  })
  map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right')
  map.addControl(new GeolocateControl({}), 'top-right')
  map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left')
  map.getCanvas().style.cursor = 'crosshair'

  // al cambiar de mapa base se pierden las capas propias: se vuelven a añadir
  map.on('style.load', addOverlays)
  map.on('click', e => useAtlas().searchNear(e.lngLat.lng, e.lngLat.lat))
})

onBeforeUnmount(() => map?.remove())

function addOverlays() {
  if (!map) return
  const heatColor = state.basemap === 'dark' ? '#ffb347' : '#fc4c02'
  map.addSource('all-tracks', { type: 'geojson', data: `/api/tracks?v=${state.dataVersion}` })
  map.addLayer({
    id: 'heat-glow', type: 'line', source: 'all-tracks',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': heatColor,
      'line-opacity': 0.08,
      'line-blur': 3,
      'line-width': ['interpolate', ['linear'], ['zoom'], 8, 3, 14, 8, 18, 16],
    },
  })
  map.addLayer({
    id: 'heat', type: 'line', source: 'all-tracks',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': heatColor,
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 14, 0.35],
      'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1, 14, 2, 18, 4],
    },
  })

  map.addSource('near-area', { type: 'geojson', data: empty })
  map.addLayer({ id: 'near-fill', type: 'fill', source: 'near-area', paint: { 'fill-color': '#1f78ff', 'fill-opacity': 0.12 } })
  map.addLayer({ id: 'near-line', type: 'line', source: 'near-area', paint: { 'line-color': '#1f78ff', 'line-width': 1.5, 'line-dasharray': [2, 2] } })

  map.addSource('selected', { type: 'geojson', data: empty })
  map.addLayer({
    id: 'sel-casing', type: 'line', source: 'selected',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#fff', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 4, 16, 9], 'line-opacity': 0.9 },
  })
  map.addLayer({
    id: 'sel-line', type: 'line', source: 'selected',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2.5, 16, 5] },
  })

  map.addSource('hover', { type: 'geojson', data: empty })
  map.addLayer({
    id: 'hover', type: 'circle', source: 'hover',
    paint: { 'circle-radius': 6, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 },
  })

  updateHeat()
  updateSelected()
  updateNear()
  updateHover()
}

const ready = () => map?.getSource('selected') != null

// --- heatmap: todas las trazas, filtradas igual que la lista ---
function updateHeat() {
  if (!ready()) return
  const visibility = state.showHeat ? 'visible' : 'none'
  const all = filtered.value.length === state.activities.length
  const filter = all ? null : ['in', ['get', 'id'], ['literal', filtered.value.map(a => a.id)]] as any
  for (const id of ['heat', 'heat-glow']) {
    map!.setLayoutProperty(id, 'visibility', visibility)
    map!.setFilter(id, filter)
  }
}
watch([() => state.showHeat, filtered], updateHeat)

watch(() => state.dataVersion, () => {
  (map?.getSource('all-tracks') as GeoJSONSource | undefined)?.setData(`/api/tracks?v=${state.dataVersion}`)
})

// --- trazas seleccionadas ---
function updateSelected() {
  if (!ready()) return
  const features = state.selected.filter(id => details[id]).map(id => ({
    type: 'Feature' as const,
    properties: { id, color: state.colors[id] },
    geometry: { type: 'LineString' as const, coordinates: details[id]!.detail.map(p => [p[0], p[1]]) },
  }))
  ;(map!.getSource('selected') as GeoJSONSource).setData({ type: 'FeatureCollection', features })
}
watch([() => [...state.selected], () => Object.keys(details).length], updateSelected)

// encuadra al añadir una actividad a la selección
watch(() => [...state.selected], (now, before) => {
  const added = now.find(id => !before.includes(id))
  if (added) fitTo(now)
})

function fitTo(ids: string[]) {
  const { byId } = useAtlas()
  const b = new LngLatBounds()
  for (const id of ids) {
    const bb = byId.value.get(id)?.bbox
    if (bb) b.extend([bb[0], bb[1]]).extend([bb[2], bb[3]])
  }
  // si hay selección, abajo queda el panel del perfil de elevación
  const bottom = state.selected.length ? 220 : 60
  if (!b.isEmpty()) map?.fitBounds(b, { padding: { top: 60, left: 60, right: 60, bottom }, maxZoom: 15, duration: 600 })
}
watch(() => state.fitRequest, (r) => { if (r) fitTo(r.ids) })

// --- "¿he pasado por aquí?" ---
function circle(lng: number, lat: number, r: number) {
  const coords: [number, number][] = []
  const dLat = r / 111320, dLng = r / (111320 * Math.cos(lat * Math.PI / 180))
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * 2 * Math.PI
    coords.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)])
  }
  return coords
}

function updateNear() {
  if (!ready()) return
  const n = state.near
  ;(map!.getSource('near-area') as GeoJSONSource).setData(n
    ? { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [circle(n.lng, n.lat, n.r)] } }
    : empty)
}
watch(() => state.near, updateNear)

// --- punto bajo el cursor del perfil de elevación ---
function pointAt(track: DetailPoint[], dist: number) {
  let lo = 0, hi = track.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (track[mid]![3] < dist) lo = mid + 1
    else hi = mid
  }
  return track[lo]!
}

function updateHover() {
  if (!ready()) return
  const d = state.hoverDistance
  const features = d == null
    ? []
    : state.selected.filter(id => details[id] && details[id]!.distanceM! >= d).map((id) => {
        const p = pointAt(details[id]!.detail, d)
        return { type: 'Feature' as const, properties: { color: state.colors[id] }, geometry: { type: 'Point' as const, coordinates: [p[0], p[1]] } }
      })
  ;(map!.getSource('hover') as GeoJSONSource).setData({ type: 'FeatureCollection', features })
}
watch(() => state.hoverDistance, updateHover)

// diff: false fuerza recarga completa y que salte 'style.load' para re-añadir las capas
watch(() => state.basemap, id => map?.setStyle(styleFor(id), { diff: false }))
</script>

<template>
  <div ref="el" class="atlas-map" />
</template>

<style scoped>
.atlas-map { position: absolute; inset: 0; }
</style>
