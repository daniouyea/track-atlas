import { randomBytes } from 'node:crypto'
import type { H3Event } from 'h3'
import { getSetting, setSetting, transaction, useDb, LEGACY_USER } from './db'
import type { TokenResponse } from './strava'
import { isHttps } from './origin'

interface SessionData {
  userId?: number
  oauthState?: string
}

// SESSION_SECRET en producción; en desarrollo se genera y se guarda en la base de datos
function sessionPassword() {
  let secret = process.env.SESSION_SECRET || getSetting<string>('session_secret')
  if (!secret) {
    secret = randomBytes(32).toString('hex')
    setSetting('session_secret', secret)
  }
  return secret
}

export function useAppSession(event: H3Event) {
  return useSession<SessionData>(event, {
    name: 'ta_session',
    password: sessionPassword(),
    maxAge: 60 * 60 * 24 * 30,
    cookie: { httpOnly: true, sameSite: 'lax', secure: isHttps(event), path: '/' },
  })
}

/** Usuario autenticado (lo fija el middleware de auth en todas las rutas /api protegidas). */
export function userId(event: H3Event): number {
  const id = event.context.userId as number | undefined
  if (!id) throw createError({ statusCode: 401, statusMessage: 'No has iniciado sesión' })
  return id
}

export interface User { id: number, firstname: string | null, lastname: string | null, avatar: string | null }

export const getUser = (id: number) =>
  useDb().prepare('SELECT id, firstname, lastname, avatar FROM users WHERE id = ?').get(id) as User | undefined

/** Crea o actualiza el usuario tras el login con Strava. */
export function upsertUser(t: TokenResponse): number {
  const a = t.athlete
  if (!a?.id) throw createError({ statusCode: 502, statusMessage: 'Strava no devolvió el atleta' })
  const { athlete: _, ...tokens } = t
  const db = useDb()
  const now = new Date().toISOString()
  transaction(() => {
    const first = !(db.prepare('SELECT 1 FROM users LIMIT 1').get())
    db.prepare(`
      INSERT INTO users (id, firstname, lastname, avatar, tokens, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET firstname = excluded.firstname, lastname = excluded.lastname,
        avatar = excluded.avatar, tokens = excluded.tokens, last_login_at = excluded.last_login_at
    `).run(a.id, a.firstname ?? null, a.lastname ?? null, a.profile_medium ?? null, JSON.stringify(tokens), now, now)
    // los datos importados antes de existir usuarios pasan al primero que entra
    if (first) db.prepare('UPDATE activities SET user_id = ? WHERE user_id = ?').run(a.id, LEGACY_USER)
  })
  return a.id
}
