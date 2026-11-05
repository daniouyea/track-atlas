import { useDb } from '../../utils/db'
import { userId } from '../../utils/auth'

export default defineEventHandler((event) => {
  const row = useDb().prepare('SELECT id, name, data FROM routes WHERE user_id = ? AND id = ?')
    .get(userId(event), getRouterParam(event, 'id')!) as { id: string, name: string, data: string } | undefined
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Ruta no encontrada' })
  return { id: row.id, name: row.name, ...JSON.parse(row.data) }
})
