import { stravaConfigured, stravaTokens } from '../../utils/strava'

export default defineEventHandler(() => {
  const t = stravaTokens()
  return {
    configured: stravaConfigured(),
    connected: !!t,
    athlete: t?.athlete ? [t.athlete.firstname, t.athlete.lastname].filter(Boolean).join(' ') : null,
  }
})
