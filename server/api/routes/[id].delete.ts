import { useDb } from '../../utils/db'
import { userId } from '../../utils/auth'

export default defineEventHandler((event) => {
  useDb().prepare('DELETE FROM routes WHERE user_id = ? AND id = ?').run(userId(event), getRouterParam(event, 'id')!)
  return { ok: true }
})
