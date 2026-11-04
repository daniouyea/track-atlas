import type { LayerSpecification, SourceSpecification, StyleSpecification } from 'maplibre-gl'

export interface Basemap {
  id: string
  name: string
  style: string | StyleSpecification
  /** capas que se añaden encima del estilo (que puede venir de una URL) al cargarlo */
  overlay?: { sources: Record<string, SourceSpecification>, layers: LayerSpecification[] }
}

const IGN = 'https://www.ign.es/wmts'
const wmts = (service: string, layer: string, format: string) =>
  `${IGN}/${service}?request=GetTile&service=WMTS&version=1.0.0&layer=${layer}&style=default`
  + `&tilematrixset=GoogleMapsCompatible&tilematrix={z}&tilerow={y}&tilecol={x}&format=${format}`

function raster(tiles: string[], attribution: string, maxzoom = 19): StyleSpecification {
  return {
    version: 8,
    sources: { base: { type: 'raster', tiles, tileSize: 256, attribution, maxzoom } },
    layers: [{ id: 'base', type: 'raster', source: 'base' }],
  }
}

export const basemaps: Basemap[] = [
  { id: 'liberty', name: 'OpenStreetMap', style: 'https://tiles.openfreemap.org/styles/liberty' },
  {
    id: 'cyclosm', name: 'CyclOSM (bici)',
    style: raster(['a', 'b', 'c'].map(s => `https://${s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png`),
      '<a href="https://www.cyclosm.org">CyclOSM</a> · © OpenStreetMap', 20),
  },
  { id: 'mtn', name: 'IGN Topográfico', style: raster([wmts('mapa-raster', 'MTN', 'image/jpeg')], '© IGN España', 17) },
  { id: 'ign', name: 'IGN Base', style: raster([wmts('ign-base', 'IGNBaseTodo', 'image/png')], '© IGN España', 18) },
  { id: 'pnoa', name: 'Ortofoto PNOA', style: raster([wmts('pnoa-ma', 'OI.OrthoimageCoverage', 'image/jpeg')], '© IGN España · PNOA', 20) },
  { id: 'dark', name: 'Oscuro', style: 'https://tiles.openfreemap.org/styles/dark' },
  {
    // heatmap global de Strava (bici) sobre el mapa oscuro; pasa por nuestro servidor (ver server/api/heatmap)
    id: 'strava', name: 'Heatmap global de Strava',
    style: 'https://tiles.openfreemap.org/styles/dark',
    overlay: {
      sources: {
        'strava-heat': {
          type: 'raster', tileSize: 256, maxzoom: 12, // sin login en Strava no hay más detalle
          tiles: [`${location.origin}/api/heatmap/{z}/{x}/{y}`],
          attribution: 'Heatmap © Strava',
        },
      },
      layers: [{ id: 'strava-heat', type: 'raster', source: 'strava-heat', paint: { 'raster-opacity': 0.9 } }],
    },
  },
]
