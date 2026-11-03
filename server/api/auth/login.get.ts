import { randomBytes } from 'node:crypto'
import { useAppSession } from '../../utils/auth'
import { authorizeUrl, stravaConfigured } from '../../utils/strava'

export default defineEventHandler(async (event) => {
  if (!stravaConfigured()) throw createError({ statusCode: 412, statusMessage: 'Falta STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET' })
  // state contra CSRF en el callback
  const state = randomBytes(16).toString('hex')
  await (await useAppSession(event)).update({ oauthState: state })
  return sendRedirect(event, authorizeUrl(event, state))
})
