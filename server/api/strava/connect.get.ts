import { authorizeUrl, stravaConfigured } from '../../utils/strava'

export default defineEventHandler((event) => {
  if (!stravaConfigured()) throw createError({ statusCode: 412, statusMessage: 'Falta STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET' })
  return sendRedirect(event, authorizeUrl(event))
})
