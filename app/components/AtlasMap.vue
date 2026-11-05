<script setup lang="ts">
import { Map as MlMap, Popup, NavigationControl, ScaleControl, GeolocateControl, LngLatBounds, setWorkerUrl, type GeoJSONSource, type StyleSpecification, type ExpressionSpecification, type MapMouseEvent, type MapTouchEvent } from 'maplibre-gl'
// maplibre v6 resuelve su worker relativo a import.meta.url, que Vite rompe al empaquetar:
// se le pasa explícitamente (el worker es autocontenido)
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import type { FeatureCollection } from 'geojson'
import { basemaps } from '~/utils/basemaps'
import type { DetailPoint } from '~/composables/useAtlas'
import { ROUTE_COLOR } from '~/composables/useAtlas'
import { routeCoords, type LngLat } from '~/utils/route'

setWorkerUrl(workerUrl)

const { state, details, filteredBase, tracks, style, profileTracks, searchNear } = useAtlas()
const routeEditor = useRouteEditor()
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
  // accesible desde la consola y las pruebas automáticas
  ;(window as unknown as { __trackAtlasMap: MlMap }).__trackAtlasMap = map
  map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right')
  map.addControl(new GeolocateControl({}), 'top-right')
  map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left')
  map.getCanvas().style.cursor = 'crosshair'

  // al cambiar de mapa base se pierden las capas propias: se vuelven a añadir
  map.on('style.load', addOverlays)
  map.on('click', (e) => {
    if (routeEditor.editor.active) onEditorClick(e)
    else searchNear(e.lngLat.lng, e.lngLat.lat)
  })
  setupRouteEditing(map)
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

// el mapa solo se reajusta solo con la ventana: al plegar la barra lateral cambia su contenedor
let resizeObserver: ResizeObserver | undefined
onMounted(() => {
  resizeObserver = new ResizeObserver(() => map?.resize())
  resizeObserver.observe(el.value!)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  map?.remove()
})

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

  // ruta en edición: tramos (discontinuos los de línea recta) y puntos de paso
  map.addSource('route', { type: 'geojson', data: empty })
  map.addSource('route-drag', { type: 'geojson', data: empty })
  map.addSource('route-points', { type: 'geojson', data: empty })
  map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: line, paint: { 'line-color': '#fff', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 6, 16, 11] } })
  map.addLayer({ id: 'route-line', type: 'line', source: 'route', layout: line, filter: ['!=', ['get', 'mode'], 'straight'], paint: { 'line-color': ROUTE_COLOR, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 3.5, 16, 7] } })
  map.addLayer({ id: 'route-straight', type: 'line', source: 'route', filter: ['==', ['get', 'mode'], 'straight'], paint: { 'line-color': ROUTE_COLOR, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 3, 16, 5], 'line-dasharray': [1.5, 1.5] } })
  map.addLayer({ id: 'route-drag', type: 'line', source: 'route-drag', paint: { 'line-color': ROUTE_COLOR, 'line-width': 2, 'line-dasharray': [2, 2], 'line-opacity': 0.8 } })
  map.addLayer({
    id: 'route-points', type: 'circle', source: 'route-points',
    paint: {
      'circle-radius': ['match', ['get', 'role'], 'mid', 5.5, 7.5],
      'circle-color': ['match', ['get', 'role'], 'first', '#16a34a', 'last', '#dc2626', '#fff'],
      'circle-stroke-color': ROUTE_COLOR, 'circle-stroke-width': 2.5,
    },
  })

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
  updateRoute()
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

// --- editor de rutas ---
let dragIndex = -1
let dragPos: LngLat | null = null

const pointFeatures = (points: LngLat[]) => ({
  type: 'FeatureCollection' as const,
  features: points.map((p, i) => ({
    type: 'Feature' as const,
    properties: { i, role: i === 0 ? 'first' : i === points.length - 1 && points.length > 1 ? 'last' : 'mid' },
    geometry: { type: 'Point' as const, coordinates: p },
  })),
})

function updateRoute() {
  if (!map?.getSource('route')) return
  const d = routeEditor.editor.active ? routeEditor.doc.value : null
  const points = d ? d.waypoints.map((p, i) => (i === dragIndex && dragPos ? dragPos : p)) : []
  ;(map.getSource('route') as GeoJSONSource).setData({
    type: 'FeatureCollection',
    features: (d?.legs ?? []).map((l, i) => ({
      type: 'Feature', properties: { i, mode: l.mode },
      geometry: { type: 'LineString', coordinates: l.coords.map(c => [c[0], c[1]]) },
    })),
  })
  ;(map.getSource('route-points') as GeoJSONSource).setData(pointFeatures(points))
  // mientras se arrastra: líneas rectas provisionales a los puntos vecinos
  const drag = d && dragPos
    ? [d.waypoints[dragIndex - 1], d.waypoints[dragIndex + 1]].filter(Boolean).map(n => ({
        type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: [n!, dragPos!] },
      }))
    : []
  ;(map.getSource('route-drag') as GeoJSONSource).setData({ type: 'FeatureCollection', features: drag })
}
// el shallowRef directamente (no un getter): así triggerRef también avisa cuando cambia por dentro
watch([routeEditor.doc, () => routeEditor.editor.active], updateRoute)
watch([routeEditor.doc, () => routeEditor.editor.active], () => pointPopup?.remove())

// con el dedo hace falta más margen para acertar en un punto o en la línea
const coarse = import.meta.client && matchMedia('(pointer: coarse)').matches

/** Elementos de una capa de la ruta bajo el ratón o el dedo (con un margen para acertar fácil). */
function hitRoute(e: { point: { x: number, y: number } }, layers: string[]) {
  const p = e.point, pad = coarse ? 16 : 6
  return map!.queryRenderedFeatures([[p.x - pad, p.y - pad], [p.x + pad, p.y + pad]], { layers })
}

function onEditorClick(e: MapMouseEvent) {
  if (hitRoute(e, ['route-points']).length) return // los puntos se arrastran o se borran con clic derecho (o tocándolos)
  if (pointPopup?.isOpen()) { pointPopup.remove(); return } // tocar fuera del globo solo lo cierra
  const leg = hitRoute(e, ['route-line', 'route-straight'])[0]
  if (leg) routeEditor.insertPoint(leg.properties.i as number, [e.lngLat.lng, e.lngLat.lat])
  else routeEditor.addPoint([e.lngLat.lng, e.lngLat.lat])
}

/** En pantallas táctiles no hay clic derecho: tocar un punto abre un globo para borrarlo. */
let pointPopup: Popup | undefined
function askRemovePoint(i: number) {
  const pos = routeEditor.doc.value?.waypoints[i]
  if (!pos) return
  pointPopup?.remove()
  const btn = document.createElement('button')
  btn.className = 'popup-remove'
  btn.textContent = 'Borrar este punto'
  btn.onclick = () => { pointPopup?.remove(); routeEditor.removePoint(i) }
  // closeOnClick no sirve: el clic que sigue al propio toque lo cerraría al momento (se cierra en onEditorClick)
  pointPopup = new Popup({ closeButton: false, closeOnClick: false, offset: 14 }).setLngLat([pos[0], pos[1]]).setDOMContent(btn).addTo(map!)
}

function setupRouteEditing(m: MlMap) {
  const canvas = m.getCanvas()
  // movimiento y suelta se escuchan en la ventana: si se suelta encima de otro elemento (el perfil
  // de elevación, la barra lateral) el mapa no recibe el mouseup y el arrastre se quedaría enganchado
  const moveTo = (clientX: number, clientY: number) => {
    const r = canvas.getBoundingClientRect()
    const ll = m.unproject([clientX - r.left, clientY - r.top])
    dragPos = [ll.lng, ll.lat]
    updateRoute()
  }
  const onMouseMove = (ev: MouseEvent) => moveTo(ev.clientX, ev.clientY)
  const onTouchMove = (ev: TouchEvent) => {
    if (ev.touches.length !== 1) return
    ev.preventDefault()
    moveTo(ev.touches[0]!.clientX, ev.touches[0]!.clientY)
  }
  const onUp = () => {
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('touchmove', onTouchMove)
    m.dragPan.enable()
    canvas.style.cursor = 'crosshair'
    const i = dragIndex, p = dragPos
    dragIndex = -1
    dragPos = null
    if (p) routeEditor.movePoint(i, p)
    else updateRoute()
    return { i, moved: !!p }
  }
  const startDrag = (i: number) => {
    pointPopup?.remove()
    dragIndex = i
    m.dragPan.disable()
  }
  // tras un toque el navegador emula mousedown/mouseup: no deben empezar otro arrastre
  let lastTouch = 0
  m.on('mousedown', 'route-points', (e) => {
    if (!routeEditor.editor.active || e.originalEvent.button !== 0 || Date.now() - lastTouch < 1000) return
    e.preventDefault() // sin esto el mapa se desplazaría en vez de mover el punto
    startDrag(e.features![0]!.properties.i as number)
    canvas.style.cursor = 'grabbing'
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onUp, { once: true })
  })
  // con el dedo: arrastrar mueve el punto; tocarlo sin moverlo ofrece borrarlo
  m.on('touchstart', (e: MapTouchEvent) => {
    lastTouch = Date.now()
    if (!routeEditor.editor.active || e.originalEvent.touches.length !== 1) return
    const hit = hitRoute(e, ['route-points'])[0]
    if (!hit) return
    e.preventDefault()
    startDrag(hit.properties.i as number)
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', () => {
      lastTouch = Date.now()
      const { i, moved } = onUp()
      if (!moved) askRemovePoint(i)
    }, { once: true })
  })
  m.on('contextmenu', 'route-points', (e) => {
    // en Android mantener pulsado también lanza contextmenu: ese caso ya lo lleva el arrastre táctil
    if (!routeEditor.editor.active || dragIndex >= 0) return
    e.preventDefault()
    routeEditor.removePoint(e.features![0]!.properties.i as number)
  })
  // cursor: mano sobre los puntos, «añadir» sobre la línea
  m.on('mouseenter', 'route-points', () => { if (routeEditor.editor.active && dragIndex < 0) canvas.style.cursor = 'grab' })
  m.on('mouseleave', 'route-points', () => { if (dragIndex < 0) canvas.style.cursor = 'crosshair' })
  for (const layer of ['route-line', 'route-straight']) {
    m.on('mouseenter', layer, () => { if (routeEditor.editor.active && dragIndex < 0) canvas.style.cursor = 'copy' })
    m.on('mouseleave', layer, () => { if (dragIndex < 0) canvas.style.cursor = 'crosshair' })
  }
}

// al editar, el doble clic no hace zoom (sería añadir dos puntos)
watch(() => routeEditor.editor.active, (on) => {
  if (!map) return
  if (on) map.doubleClickZoom.disable()
  else map.doubleClickZoom.enable()
})

// al abrir una ruta (guardada o desde un track) se encuadra
watch(() => routeEditor.doc.value?.id, () => {
  const d = routeEditor.doc.value
  if (!d?.legs.length) return
  const b = new LngLatBounds()
  for (const c of routeCoords(d)) b.extend([c[0], c[1]])
  map?.fitBounds(b, { padding: { top: 60, left: 60, right: 60, bottom: 220 }, maxZoom: 15, duration: 600 })
})

watch(() => state.basemap, id => map && setBasemap(id))
</script>

<template>
  <div ref="el" class="atlas-map" />
</template>

<style scoped>
.atlas-map { position: absolute; inset: 0; }
.atlas-map :deep(.popup-remove) { border: 0; background: none; color: #b91c1c; font: inherit; font-size: 14px; padding: 6px 4px; cursor: pointer; }
</style>
