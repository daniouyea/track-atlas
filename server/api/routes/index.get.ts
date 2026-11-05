import { useDb } from '../../utils/db'
import { userId } from '../../utils/auth'

export default defineEventHandler(event => useDb().prepare(`
  SELECT id, name, distance_m AS distanceM, elevation_gain_m AS elevationGainM, created_at AS createdAt, updated_at AS updatedAt
  FROM routes WHERE user_id = ? ORDER BY updated_at DESC
`).all(userId(event)))
