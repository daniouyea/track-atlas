import type { H3Event } from 'h3'
import { useDb } from './db'
import { publicOrigin } from './origin'

// Credenciales de la app de API de Strava (https://www.strava.com/settings/api)
const clientId = () => process.env.STRAVA_CLIENT_ID
const clientSecret = () => process.env.STRAVA_CLIENT_SECRET
// configurable para poder probar contra un Strava simulado
const base = () => (process.env.STRAVA_BASE_URL || 'https://www.strava.com').replace(/\/$/, '')

export const stravaConfigured = () => !!(clientId() && clientSecret())

export interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_at: number
  athlete?: { id: number, firstname?: string, lastname?: string, profile_medium?: string }
}

export function redirectUri(event: H3Event) {
  return `${publicOrigin(event)}/api/auth/callback`
}

export function authorizeUrl(event: H3Event, state: string) {
  const q = new URLSearchParams({
    client_id: clientId()!,
    redirect_uri: redirectUri(event),
    response_type: 'code',
    approval_prompt: 'auto',
    // read_all: rutas privadas; activity:read_all: actividades «solo yo»
    scope: 'read,read_all,activity:read_all',
    state,
  })
  return `${base()}/oauth/authorize?${q}`
}

const tokenRequest = (params: Record<string, string>) => $fetch<TokenResponse>(`${base()}/oauth/token`, {
  method: 'POST',
  body: { client_id: clientId(), client_secret: clientSecret(), ...params },
})

export const exchangeCode = (code: string) => tokenRequest({ code, grant_type: 'authorization_code' })

const saveTokens = (userId: number, t: TokenResponse) => {
  const { athlete: _, ...tokens } = t
  useDb().prepare('UPDATE users SET tokens = ? WHERE id = ?').run(JSON.stringify(tokens), userId)
}

async function accessToken(userId: number) {
  const row = useDb().prepare('SELECT tokens FROM users WHERE id = ?').get(userId) as { tokens: string | null } | undefined
  let t = row?.tokens ? JSON.parse(row.tokens) as TokenResponse : undefined
  if (!t) throw createError({ statusCode: 401, statusMessage: 'Sesión de Strava no válida: vuelve a entrar' })
  if (t.expires_at - 60 < Date.now() / 1000) {
    t = await tokenRequest({ refresh_token: t.refresh_token, grant_type: 'refresh_token' })
    saveTokens(userId, t)
  }
  return t.access_token
}

export async function stravaApi<T>(userId: number, path: string, opts: { query?: Record<string, string>, responseType?: 'text' } = {}): Promise<T> {
  try {
    return (await $fetch(`${base()}/api/v3${path}`, {
      headers: { Authorization: `Bearer ${await accessToken(userId)}` },
      query: opts.query,
      responseType: opts.responseType as any,
    })) as T
  } catch (e: any) {
    if (e?.statusCode) throw createError({ statusCode: e.statusCode, statusMessage: `Strava: ${e.statusMessage ?? e.message}` })
    throw e
  }
}

export type StravaRef = { kind: 'activities' | 'routes' | 'segments', id: string }

/** Admite URLs de strava.com y enlaces cortos compartidos desde la app (strava.app.link). */
export async function parseStravaUrl(input: string): Promise<StravaRef | null> {
  const match = (s: string) => {
    const m = s.match(/strava\.com\/(activities|routes|segments)\/(\d+)/)
    return m ? { kind: m[1] as StravaRef['kind'], id: m[2]! } : null
  }
  const direct = match(input)
  if (direct || !/^https?:\/\/(strava\.app\.link|link\.strava\.com)\//.test(input.trim())) return direct
  // el enlace corto redirige (o lleva la URL real en el HTML)
  const res = await fetch(input.trim(), { redirect: 'follow' })
  return match(res.url) ?? match(await res.text())
}
