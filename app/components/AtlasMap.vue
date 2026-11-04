<script setup lang="ts">
import { Map as MlMap, NavigationControl, ScaleControl, GeolocateControl, LngLatBounds, setWorkerUrl, type GeoJSONSource, type StyleSpecification, type ExpressionSpecification } from 'maplibre-gl'
// maplibre v6 resuelve su worker relativo a import.meta.url, que Vite rompe al empaquetar:
// se le pasa explícitamente (el worker es autocontenido)
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import type { FeatureCollection } from 'geojson'
import { basemaps } from '~/utils/basemaps'
import type { DetailPoint } from '~/composables/useAtlas'

setWorkerUrl(workerUrl)

const { state, details, filteredBase, tracks, style, profileTracks, searchNear } = useAtlas()
const el = ref<HTMLDivElement>()
let map: MlMap | undefined

const empty: FeatureCollection = { type: 'FeatureCollection', features: [] }
const basemapFor = (id: string) => basemaps.find(b => b.id === id) ?? basemaps[0]!

/** Carga el mapa base; si tiene capas extra (heatmap de Strava) se añaden al estilo al cargarlo. */
function setBasemap(id: string) {
  const b = basemapFor(id)
  // diff: false fuerza recarga completa y que salte 'style.load' para re-añadir las capas propias
  map!.setStyle(b.style as string | StyleSpecification, {
    diff: false,
    transformStyle: (_prev, next) => b.overlay
      ? { ...next, sources: { ...next.sources, ...b.overlay.sources }, layers: [...next.layers, ...b.overlay.layers] }
      : next,
  })
}

onMounted(() => {
  map = new MlMap({
    container: el.value!,
    // estilo vacío: el real se pone con setBasemap (que admite capas extra)
    style: { version: 8, sources: {}, layers: [] },
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
  map.on('click', e => searchNear(e.lngLat.lng, e.lngLat.lat))
  // zona encuadrada para el filtro de la lista: solo cuando la mueve el usuario. Si reaccionara a los
  // encuadres de la app (al pulsar una actividad), la lista cambiaría bajo el ratón. Se mira al empezar
  // el movimiento: al soltar un arrastre, la inercia termina sin originalEvent.
  let userMove = false
  map.on('movestart', (e) => { userMove = !!e.originalEvent })
  map.on('moveend', (e) => {
    if (userMove || e.originalEvent || !state.viewBounds) state.viewBounds = currentBounds()
    userMove = false
  })
  setBasemap(state.basemap)
})

onBeforeUnmount(() => map?.remove())

function currentBounds(): [number, number, number, number] {
  const b = map!.getBounds()
  return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]
}
// al activar el filtro, cuenta lo que se ve en ese momento
watch(() => state.filters.inView, (on) => { if (on && map) state.viewBounds = currentBounds() })

/** grosor que escala con el zoom, multiplicado por el factor configurado */
const width = (k: number, stops: [number, number][]) =>
  ['interpolate', ['linear'], ['zoom'], ...stops.flatMap(([z, w]) => [z, w * k])] as ExpressionSpecification

function addOverlays() {
  // el estilo vacío inicial también lanza 'style.load'
  if (!map || !map.getStyle().layers.length) return
  const line = { 'line-cap': 'round', 'line-join': 'round' } as const

  // velo entre el mapa base y los tracks para atenuar el mapa
  map.addLayer({ id: 'veil', type: 'background', paint: {} })

  map.addSource('all-tracks', { type: 'geojson', data: tracks.value ?? empty })
  map.addLayer({ id: 'heat-glow', type: 'line', source: 'all-tracks', layout: line, paint: { 'line-blur': 3 } })
  map.addLayer({ id: 'heat', type: 'line', source: 'all-tracks', layout: line, paint: {} })

  map.addSource('near-area', { type: 'geojson', data: empty })
  map.addLayer({ id: 'near-fill', type: 'fill', source: 'near-area', paint: { 'fill-color': '#1f78ff', 'fill-opacity': 0.12 } })
  map.addLayer({ id: 'near-line', type: 'line', source: 'near-area', paint: { 'line-color': '#1f78ff', 'line-width': 1.5, 'line-dasharray': [2, 2] } })

  map.addSource('selected', { type: 'geojson', data: empty })
  map.addLayer({ id: 'sel-casing', type: 'line', source: 'selected', layout: line, paint: { 'line-color': '#fff', 'line-opacity': 0.9 } })
  map.addLayer({ id: 'sel-line', type: 'line', source: 'selected', layout: line, paint: { 'line-color': ['get', 'color'] } })

  // track de referencia: verde lo ya recorrido, otro color lo nuevo (gris mientras se analiza)
  map.addSource('reference', { type: 'geojson', data: empty })
  map.addLayer({ id: 'ref-casing', type: 'line', source: 'reference', layout: line, paint: { 'line-color': '#fff' } })
  map.addLayer({ id: 'ref-line', type: 'line', source: 'reference', layout: line, paint: {} })

  map.addSource('hover', { type: 'geojson', data: empty })
  map.addLayer({
    id: 'hover', type: 'circle', source: 'hover',
    paint: { 'circle-radius': 6, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 },
  })

  applyStyle()
  updateHeat()
  updateSelected()
  updateReference()
  updateNear()
  updateHover()
}

const ready = () => map?.getSource('selected') != null

// --- estilo configurable ---
function applyStyle() {
  if (!ready()) return
  const s = style.value
  type P = Parameters<MlMap['setPaintProperty']>
  const set = (layer: string, prop: P[1], value: P[2]) => map!.setPaintProperty(layer, prop, value)
  set('veil', 'background-color', s.veil)
  set('veil', 'background-opacity', 1 - s.mapOpacity)
  set('heat', 'line-color', s.heatColor)
  set('heat', 'line-opacity', s.heatOpacity)
  set('heat', 'line-width', width(s.heatWidth, [[8, 1], [14, 2], [18, 4]]))
  set('heat-glow', 'line-color', s.heatColor)
  set('heat-glow', 'line-opacity', s.heatOpacity * 0.2)
  set('heat-glow', 'line-width', width(s.heatWidth, [[8, 3], [14, 8], [18, 16]]))
  set('sel-line', 'line-width', width(s.selWidth, [[8, 2.5], [16, 5]]))
  set('sel-casing', 'line-width', width(s.selWidth, [[8, 4.5], [16, 9]]))
  map!.setLayoutProperty('sel-casing', 'visibility', s.selCasing ? 'visible' : 'none')
  set('ref-line', 'line-color', ['match', ['get', 'known'], 'yes', s.refKnown, 'no', s.refNew, '#6b7280'])
  set('ref-line', 'line-width', width(s.refWidth, [[8, 3], [16, 6]]))
  set('ref-casing', 'line-width', width(s.refWidth, [[8, 5.5], [16, 10]]))
}
watch(style, applyStyle, { deep: true })

// --- heatmap: todas las trazas, filtradas igual que la lista ---
function updateHeat() {
  if (!ready()) return
  const visibility = state.showHeat ? 'visible' : 'none'
  // el filtro por zona no se aplica aquí: el mapa ya enseña solo lo encuadrado
  const all = filteredBase.value.length === state.activities.length
  const filter = all ? null : ['in', ['get', 'id'], ['literal', filteredBase.value.map(a => a.id)]] as ExpressionSpecification
  for (const id of ['heat', 'heat-glow']) {
    map!.setLayoutProperty(id, 'visibility', visibility)
    map!.setFilter(id, filter)
  }
}
watch([() => state.showHeat, filteredBase], updateHeat)

watch(tracks, (fc) => {
  (map?.getSource('all-tracks') as GeoJSONSource | undefined)?.setData(fc ?? empty)
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
watch([() => [...state.selected], () => Object.keys(details).length, () => ({ ...state.colors })], updateSelected)

// --- track de referencia ---
function updateReference() {
  if (!ready()) return
  const ref = state.reference
  const cmp = state.comparison
  let data: FeatureCollection = empty
  if (ref && cmp) {
    data = {
      type: 'FeatureCollection',
      features: cmp.segments.features.map(f => ({ ...f, properties: { known: f.properties.known ? 'yes' : 'no' } })),
    }
  } else if (ref) {
    data = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { known: 'pending' }, geometry: { type: 'LineString', coordinates: ref.detail.map(p => [p[0], p[1]]) } }] }
  }
  ;(map!.getSource('reference') as GeoJSONSource).setData(data)
}
watch([() => state.reference, () => state.comparison], updateReference)

// --- encuadre ---
// encuadra al añadir una actividad a la selección
watch(() => [...state.selected], (now, before) => {
  if (now.some(id => !before.includes(id))) useAtlas().focus(now)
})

function fitTo(bboxes: [number, number, number, number][]) {
  const b = new LngLatBounds()
  for (const bb of bboxes) b.extend([bb[0], bb[1]]).extend([bb[2], bb[3]])
  // si hay perfil de elevación, ocupa la parte de abajo
  const bottom = profileTracks.value.length || state.reference ? 220 : 60
  if (!b.isEmpty()) map?.fitBounds(b, { padding: { top: 60, left: 60, right: 60, bottom }, maxZoom: 15, duration: 600 })
}
watch(() => state.fitRequest, (r) => { if (r) fitTo(r.bboxes) })

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
    : profileTracks.value.filter(t => t.detail.at(-1)![3] >= d).map((t) => {
        const p = pointAt(t.detail, d)
        return { type: 'Feature' as const, properties: { color: t.color }, geometry: { type: 'Point' as const, coordinates: [p[0], p[1]] } }
      })
  ;(map!.getSource('hover') as GeoJSONSource).setData({ type: 'FeatureCollection', features })
}
watch(() => state.hoverDistance, updateHover)

watch(() => state.basemap, id => map && setBasemap(id))
</script>

<template>
  <div ref="el" class="atlas-map" />
</template>

<style scoped>
.atlas-map { position: absolute; inset: 0; }
</style>
