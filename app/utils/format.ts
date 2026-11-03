export const km = (m?: number | null) => m == null ? '–' : `${(m / 1000).toFixed(1)} km`
export const meters = (m?: number | null) => m == null ? '–' : `${Math.round(m)} m`

export function duration(s?: number | null) {
  if (s == null) return '–'
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`
}

const dateFmt = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
export const date = (iso?: string | null) => iso ? dateFmt.format(new Date(iso)) : '–'

// Colores bien distinguibles sobre cualquier mapa base, asignados por orden de selección.
// Sin verdes ni magentas: son los de «ya recorrido» / «nuevo» de la comparación.
export const PALETTE = ['#fc4c02', '#1f78ff', '#eab308', '#0891b2', '#e11d48', '#7c3aed', '#92400e', '#1e293b', '#64748b']
