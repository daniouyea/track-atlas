import { upsertUser, useAppSession } from '../../utils/auth'
import { exchangeCode } from '../../utils/strava'

export default defineEventHandler(async (event) => {
  const { code, state, error } = getQuery(event)
  const session = await useAppSession(event)
  const expected = session.data.oauthState
  if (error || !code) return sendRedirect(event, `/?login=${encodeURIComponent(String(error ?? 'cancelado'))}`)
  if (!expected || state !== expected) return sendRedirect(event, '/?login=estado_invalido')
  const userId = upsertUser(await exchangeCode(String(code)))
  await session.update({ userId, oauthState: undefined })
  return sendRedirect(event, '/')
})
