import { getUser, useAppSession } from '../utils/auth'

// Toda la API salvo /api/auth/* exige sesión; cada usuario solo accede a sus datos
export default defineEventHandler(async (event) => {
  const path = event.path
  if (!path.startsWith('/api/') || path.startsWith('/api/auth/')) return
  const session = await useAppSession(event)
  const id = session.data.userId
  if (!id || !getUser(id)) throw createError({ statusCode: 401, statusMessage: 'No has iniciado sesión' })
  event.context.userId = id
})
