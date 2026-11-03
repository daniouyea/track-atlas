import type { H3Event } from 'h3'

/**
 * URL pública tal como la ve el visitante. Detrás de Cloudflare (SSL «Flexible») + Traefik la
 * petición llega por HTTP aunque el visitante use HTTPS: Traefik reescribe X-Forwarded-Proto,
 * pero deja pasar CF-Visitor, que dice el esquema real.
 */
export function publicOrigin(event: H3Event) {
  const url = getRequestURL(event, { xForwardedHost: true, xForwardedProto: true })
  let scheme = url.protocol.replace(':', '')
  try {
    const cf = JSON.parse(getRequestHeader(event, 'cf-visitor') ?? '{}') as { scheme?: string }
    if (cf.scheme) scheme = cf.scheme
  } catch {}
  return `${scheme}://${url.host}`
}

export const isHttps = (event: H3Event) => publicOrigin(event).startsWith('https:')
