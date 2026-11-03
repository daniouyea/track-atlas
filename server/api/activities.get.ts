import { useDb } from '../utils/db'

export default defineEventHandler(() => {
  return useDb().prepare(`
    SELECT id, name, type, start_time AS startTime, distance_m AS distanceM,
           moving_time_s AS movingTimeS, elapsed_time_s AS elapsedTimeS,
           elevation_gain_m AS elevationGainM, gear,
           json_array(min_lng, min_lat, max_lng, max_lat) AS bbox
    FROM activities ORDER BY start_time DESC
  `).all().map(r => ({ ...r, bbox: JSON.parse(r.bbox as string) }))
})
