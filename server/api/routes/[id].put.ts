import { useDb } from '../../utils/db'
import { userId } from '../../utils/auth'

// Crea o actualiza una ruta (el id lo genera el cliente)
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  if (!/^[\w-]{8,64}$/.test(id)) throw createError({ statusCode: 400, statusMessage: 'id no válido' })
  const body = await readBody<{ name?: string, waypoints?: unknown[], legs?: unknown[], distanceM?: number, elevationGainM?: number }>(event)
  if (!Array.isArray(body?.waypoints) || !Array.isArray(body.legs)) throw createError({ statusCode: 400, statusMessage: 'Faltan waypoints/legs' })
  const name = (body.name ?? '').trim().slice(0, 120) || 'Ruta sin nombre'
  const now = new Date().toISOString()
  useDb().prepare(`
    INSERT INTO routes (user_id, id, name, data, distance_m, elevation_gain_m, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, id) DO UPDATE SET name = excluded.name, data = excluded.data,
      distance_m = excluded.distance_m, elevation_gain_m = excluded.elevation_gain_m, updated_at = excluded.updated_at
  `).run(userId(event), id, name, JSON.stringify({ waypoints: body.waypoints, legs: body.legs }),
    Number(body.distanceM) || 0, Number(body.elevationGainM) || 0, now, now)
  return { id, name, updatedAt: now }
})
