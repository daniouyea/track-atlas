import { useDb } from '../utils/db'
import { cellsAround, nearestOnTrack, type DetailPoint } from '../utils/geo'
import { userId } from '../utils/auth'

// "¿He pasado por aquí?": actividades cuya traza pasa a menos de r metros del punto.
export default defineEventHandler((event) => {
  const q = getQuery(event)
  const lat = Number(q.lat), lng = Number(q.lng)
  const r = Math.min(Math.max(Number(q.r) || 100, 5), 2000)
  if (!Number.isFinite(lat) || !Number.isFinite(lng))
    throw createError({ statusCode: 400, statusMessage: 'lat/lng requeridos' })

  const db = useDb()
  const cells = cellsAround(lng, lat, r)
  const candidates = db.prepare(`
    SELECT DISTINCT c.activity_id AS id, t.detail
    FROM cells c JOIN tracks t ON t.user_id = c.user_id AND t.activity_id = c.activity_id
    WHERE c.user_id = ? AND c.cell IN (SELECT value FROM json_each(?))
  `).all(userId(event), JSON.stringify(cells)) as { id: string, detail: string }[]

  return candidates
    .map((c) => {
      const detail = JSON.parse(c.detail) as DetailPoint[]
      const n = nearestOnTrack(lng, lat, detail)
      return { id: c.id, distanceM: Math.round(n.distanceM), atDistanceM: detail[n.index]![3] }
    })
    .filter(c => c.distanceM <= r)
})
