import { userId } from '../../utils/auth'

/**
 * Tramo «por caminos» con BRouter (https://brouter.de), con perfiles de bici. Se usa su servidor
 * público, que pide un uso moderado: solo se llama al soltar un punto y se cachean las respuestas
 * (deshacer, rehacer o mover un punto adelante y atrás no repiten la petición).
 */
const BROUTER_PROFILES = ['trekking', 'gravel', 'mtb', 'fastbike', 'fastbike-verylowtraffic', 'safety'] as const
const BROUTER_URL = process.env.BROUTER_URL || 'https://brouter.de/brouter'

const cache = new Map<string, { coordinates: [number, number, number | null][], distanceM: number }>()
const CACHE_MAX = 300

const isPoint = (p: unknown): p is [number, number] =>
  Array.isArray(p) && p.length >= 2 && p.slice(0, 2).every(v => typeof v === 'number' && Number.isFinite(v))

export default defineEventHandler(async (event) => {
  userId(event) // solo con sesión
  const { from, to, profile } = await readBody<{ from?: unknown, to?: unknown, profile?: string }>(event)
  if (!isPoint(from) || !isPoint(to)) throw createError({ statusCode: 400, statusMessage: 'from/to deben ser [lng, lat]' })
  if (!BROUTER_PROFILES.includes(profile as typeof BROUTER_PROFILES[number])) throw createError({ statusCode: 400, statusMessage: 'Perfil no válido' })

  const lonlats = `${from[0].toFixed(6)},${from[1].toFixed(6)}|${to[0].toFixed(6)},${to[1].toFixed(6)}`
  const key = `${profile}|${lonlats}`
  const hit = cache.get(key)
  if (hit) return hit

  const res = await fetch(`${BROUTER_URL}?lonlats=${lonlats}&profile=${profile}&alternativeidx=0&format=geojson`, {
    signal: AbortSignal.timeout(30_000),
    headers: { 'User-Agent': 'TrackAtlas (uso personal)' },
  }).catch(() => null)
  if (!res) throw createError({ statusCode: 504, statusMessage: 'BRouter no responde' })
  if (!res.ok) {
    // BRouter explica el error en texto plano (p. ej. «from-position not mapped in existing datafile»)
    const msg = (await res.text()).trim().slice(0, 160)
    const friendly = /not mapped/i.test(msg)
      ? 'No hay caminos cerca de este punto'
      : /watchdog|timeout/i.test(msg)
        ? 'Tramo demasiado largo para el servidor público de BRouter: añade puntos intermedios'
        : `BRouter: ${msg || res.status}`
    throw createError({ statusCode: 422, statusMessage: friendly })
  }
  const fc = await res.json() as { features?: { properties?: Record<string, string>, geometry?: { coordinates?: number[][] } }[] }
  const f = fc.features?.[0]
  const coords = f?.geometry?.coordinates
  if (!coords?.length) throw createError({ statusCode: 422, statusMessage: 'BRouter no encontró ruta' })
  const result = {
    coordinates: coords.map(c => [c[0]!, c[1]!, c[2] ?? null] as [number, number, number | null]),
    distanceM: Number(f!.properties?.['track-length']) || 0,
  }
  cache.set(key, result)
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!)
  return result
})
