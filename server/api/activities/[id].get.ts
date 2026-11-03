import { useDb } from '../../utils/db'
import { userId } from '../../utils/auth'

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  const row = useDb().prepare(`
    SELECT a.id, a.name, a.type, a.start_time AS startTime, a.distance_m AS distanceM,
           a.moving_time_s AS movingTimeS, a.elapsed_time_s AS elapsedTimeS,
           a.elevation_gain_m AS elevationGainM, a.description, a.gear,
           json_array(a.min_lng, a.min_lat, a.max_lng, a.max_lat) AS bbox, t.detail
    FROM activities a JOIN tracks t ON t.user_id = a.user_id AND t.activity_id = a.id
    WHERE a.user_id = ? AND a.id = ?
  `).get(userId(event), id!) as Record<string, string> | undefined
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Actividad no encontrada' })
  return { ...row, bbox: JSON.parse(row.bbox!), detail: JSON.parse(row.detail!) }
})
