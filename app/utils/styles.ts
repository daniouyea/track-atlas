export interface TrackStyle {
  /** opacidad del mapa base (0-1): por debajo de 1 se aclara/oscurece para resaltar los tracks */
  mapOpacity: number
  /** color con el que se atenúa: blanco aclara, negro oscurece */
  veil: string
  heatColor: string
  heatOpacity: number
  /** multiplicador de grosor */
  heatWidth: number
  selWidth: number
  selCasing: boolean
  refKnown: string
  refNew: string
  refWidth: number
}

const base: TrackStyle = {
  mapOpacity: 1,
  veil: '#ffffff',
  heatColor: '#fc4c02',
  heatOpacity: 0.4,
  heatWidth: 1,
  selWidth: 1,
  selCasing: true,
  refKnown: '#16a34a',
  refNew: '#c026d3',
  refWidth: 1,
}

// Cada mapa base tiene colores dominantes distintos: se parte de un ajuste que contraste
const perBasemap: Record<string, Partial<TrackStyle>> = {
  cyclosm: { heatColor: '#d6006f' },
  mtn: { heatColor: '#e4007c', mapOpacity: 0.85 },
  pnoa: { heatColor: '#ffe14d', heatOpacity: 0.55, refKnown: '#4ade80', refNew: '#ff4dff' },
  // el heatmap de Strava es rojo/amarillo: el propio en cian para distinguirlos
  strava: { veil: '#000000', heatColor: '#38bdf8', heatOpacity: 0.6, refKnown: '#4ade80', refNew: '#f472b6' },
  dark: { veil: '#000000', heatColor: '#ffb347', refKnown: '#4ade80', refNew: '#f472b6' },
}

export const defaultStyle = (basemap: string): TrackStyle => ({ ...base, ...perBasemap[basemap] })
