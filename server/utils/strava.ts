import type { H3Event } from 'h3'
import { getSetting, setSetting } from './db'

// Credenciales de la app de API de Strava (https://www.strava.com/settings/api)
const clientId = () => process.env.STRAVA_CLIENT_ID
const clientSecret = () => process.env.STRAVA_CLIENT_SECRET
export const stravaConfigured = () => !!(clientId() && clientSecret())

interface Tokens {
  access_token: string
  refresh_token: string
  expires_at: number
  athlete?: { id: number, firstname?: string, lastname?: string }
}

export const stravaTokens = () => getSetting<Tokens>('strava_tokens')

export function redirectUri(event: H3Event) {
  return `${getRequestURL(event, { xForwardedHost: true, xForwardedProto: true }).origin}/api/strava/callback`
}

export function authorizeUrl(event: H3Event) {
  const q = new URLSearchParams({
    client_id: clientId()!,
    redirect_uri: redirectUri(event),
    response_type: 'code',
    approval_prompt: 'auto',
    // read_all: rutas privadas; activity:read_all: actividades «solo yo»
    scope: 'read,read_all,activity:read_all',
  })
  return `https://www.strava.com/oauth/authorize?${q}`
}

async function tokenRequest(params: Record<string, string>) {
  const tokens = await $fetch<Tokens>('https://www.strava.com/oauth/token', {
    method: 'POST',
    body: { client_id: clientId(), client_secret: clientSecret(), ...params },
  })
  // la respuesta de refresh no trae athlete: se conserva el anterior
  setSetting('strava_tokens', { ...tokens, athlete: tokens.athlete ?? stravaTokens()?.athlete })
}

export const exchangeCode = (code: string) => tokenRequest({ code, grant_type: 'authorization_code' })

async function accessToken() {
  const t = stravaTokens()
  if (!t) throw createError({ statusCode: 401, statusMessage: 'Strava no está conectado' })
  if (t.expires_at - 60 < Date.now() / 1000) {
    await tokenRequest({ refresh_token: t.refresh_token, grant_type: 'refresh_token' })
  }
  return stravaTokens()!.access_token
}

export async function stravaApi<T>(path: string, opts: { query?: Record<string, string>, responseType?: 'text' } = {}): Promise<T> {
  try {
    return await $fetch<T>(`https://www.strava.com/api/v3${path}`, {
      headers: { Authorization: `Bearer ${await accessToken()}` },
      query: opts.query,
      responseType: opts.responseType as any,
    })
  } catch (e: any) {
    if (e?.statusCode && e.statusCode !== 401) throw createError({ statusCode: e.statusCode, statusMessage: `Strava: ${e.statusMessage ?? e.message}` })
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
