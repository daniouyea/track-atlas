import { userId } from '../../utils/auth'
import { routeOnTracks } from '../../utils/trackGraph'

const isPoint = (p: unknown): p is [number, number] =>
  Array.isArray(p) && p.length >= 2 && p.slice(0, 2).every(v => typeof v === 'number' && Number.isFinite(v))

// Tramo de ruta siguiendo los tracks del usuario
export default defineEventHandler(async (event) => {
  const { from, to } = await readBody<{ from?: unknown, to?: unknown }>(event)
  if (!isPoint(from) || !isPoint(to)) throw createError({ statusCode: 400, statusMessage: 'from/to deben ser [lng, lat]' })
  const r = routeOnTracks(userId(event), [from[0], from[1]], [to[0], to[1]])
  if ('error' in r) throw createError({ statusCode: 422, statusMessage: r.error })
  return r
})
