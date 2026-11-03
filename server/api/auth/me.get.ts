import { getUser, useAppSession } from '../../utils/auth'
import { stravaConfigured } from '../../utils/strava'

export default defineEventHandler(async (event) => {
  const session = await useAppSession(event)
  const user = session.data.userId ? getUser(session.data.userId) : undefined
  return { user: user ?? null, stravaConfigured: stravaConfigured() }
})
