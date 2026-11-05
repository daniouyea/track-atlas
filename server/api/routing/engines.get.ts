import { userId } from '../../utils/auth'

/**
 * Motores de cálculo de rutas que ofrece el editor. Los de pago o con registro solo se activan si
 * hay clave en el entorno; mientras tanto se listan como no disponibles para que se sepa que existen.
 * (Google Maps no se ofrece: sus condiciones prohíben usar sus rutas sobre mapas que no sean de Google.)
 */
export default defineEventHandler((event) => {
  userId(event)
  return [
    { id: 'tracks', name: 'Mis tracks', description: 'Por donde ya has pasado', available: true, profiles: [] },
    {
      id: 'brouter', name: 'BRouter', description: 'Caminos y carreteras (OpenStreetMap)', available: true,
      profiles: [
        { id: 'trekking', name: 'Cicloturismo' },
        { id: 'gravel', name: 'Gravel' },
        { id: 'mtb', name: 'MTB' },
        { id: 'fastbike', name: 'Carretera' },
        { id: 'fastbike-verylowtraffic', name: 'Carretera, poco tráfico' },
        { id: 'safety', name: 'Lo más seguro' },
      ],
    },
    { id: 'ors', name: 'OpenRouteService', description: 'Requiere clave de API (ORS_API_KEY)', available: !!process.env.ORS_API_KEY, profiles: [] },
    { id: 'graphhopper', name: 'GraphHopper', description: 'Requiere clave de API (GRAPHHOPPER_KEY)', available: !!process.env.GRAPHHOPPER_KEY, profiles: [] },
    { id: 'mapbox', name: 'Mapbox', description: 'Requiere token (MAPBOX_TOKEN)', available: !!process.env.MAPBOX_TOKEN, profiles: [] },
  ]
})
