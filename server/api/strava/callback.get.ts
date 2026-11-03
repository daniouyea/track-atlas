import { exchangeCode } from '../../utils/strava'

export default defineEventHandler(async (event) => {
  const { code, error } = getQuery(event)
  if (error || !code) return sendRedirect(event, `/?strava=${encodeURIComponent(String(error ?? 'cancelado'))}`)
  await exchangeCode(String(code))
  return sendRedirect(event, '/?strava=ok')
})
