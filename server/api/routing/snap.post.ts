import { userId } from '../../utils/auth'
import { snapToTracks } from '../../utils/trackGraph'

// Engancha un punto de paso al track propio más cercano (null si no hay ninguno cerca)
export default defineEventHandler(async (event) => {
  const { point } = await readBody<{ point?: [number, number] }>(event)
  if (!Array.isArray(point) || !point.slice(0, 2).every(v => Number.isFinite(v))) throw createError({ statusCode: 400, statusMessage: 'point debe ser [lng, lat]' })
  return { point: snapToTracks(userId(event), [point[0], point[1]]) }
})
