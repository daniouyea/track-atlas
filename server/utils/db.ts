import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

let db: DatabaseSync | undefined

export function dataDir() {
  return process.env.DATA_DIR || join(process.cwd(), 'data')
}

/** Dueño provisional de los datos importados antes de que hubiera usuarios. */
export const LEGACY_USER = 0

const SCHEMA_VERSION = 1

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,            -- id de atleta de Strava
    firstname TEXT,
    lastname TEXT,
    avatar TEXT,
    tokens TEXT,                       -- tokens OAuth de Strava (JSON)
    created_at TEXT NOT NULL,
    last_login_at TEXT
  );

  CREATE TABLE IF NOT EXISTS activities (
    user_id INTEGER NOT NULL,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT,
    start_time TEXT,
    distance_m REAL,
    moving_time_s INTEGER,
    elapsed_time_s INTEGER,
    elevation_gain_m REAL,
    description TEXT,
    gear TEXT,
    min_lng REAL, min_lat REAL, max_lng REAL, max_lat REAL,
    source_file TEXT,
    imported_at TEXT NOT NULL,
    PRIMARY KEY (user_id, id)
  );
  CREATE INDEX IF NOT EXISTS activities_start ON activities(user_id, start_time);

  -- detail: [[lng, lat, ele, dist_m, t_s], ...] remuestreado cada ~8 m
  -- overview: [[lng, lat], ...] simplificado para vista general / heatmap
  CREATE TABLE IF NOT EXISTS tracks (
    user_id INTEGER NOT NULL,
    activity_id TEXT NOT NULL,
    detail TEXT NOT NULL,
    overview TEXT NOT NULL,
    PRIMARY KEY (user_id, activity_id),
    FOREIGN KEY (user_id, activity_id) REFERENCES activities(user_id, id) ON DELETE CASCADE ON UPDATE CASCADE
  );

  -- índice espacial simple: celdas de rejilla por las que pasa cada actividad
  CREATE TABLE IF NOT EXISTS cells (
    user_id INTEGER NOT NULL,
    cell TEXT NOT NULL,
    activity_id TEXT NOT NULL,
    PRIMARY KEY (user_id, cell, activity_id),
    FOREIGN KEY (user_id, activity_id) REFERENCES activities(user_id, id) ON DELETE CASCADE ON UPDATE CASCADE
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS cells_activity ON cells(user_id, activity_id);

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`

export function useDb() {
  const file = join(dataDir(), 'atlas.sqlite')
  // si el fichero desaparece con la conexión abierta, se seguiría escribiendo en un
  // inodo borrado y los datos se perderían al reiniciar: se reabre
  if (db && !existsSync(file)) {
    db.close()
    db = undefined
  }
  if (db) return db
  mkdirSync(dataDir(), { recursive: true })
  const d = new DatabaseSync(file)
  d.exec('PRAGMA journal_mode = WAL')
  migrate(d)
  d.exec('PRAGMA foreign_keys = ON')
  db = d
  return d
}

const version = (d: DatabaseSync) => (d.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
const hasTable = (d: DatabaseSync, name: string) => !!d.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name)

function migrate(d: DatabaseSync) {
  if (version(d) >= SCHEMA_VERSION) return

  // v0: base de datos de un solo usuario (sin user_id)
  const legacy = hasTable(d, 'activities') && !(d.prepare('PRAGMA table_info(activities)').all() as { name: string }[]).some(c => c.name === 'user_id')
  if (legacy) {
    // copia de seguridad antes de tocar nada
    const backup = join(dataDir(), `atlas.v0-backup-${Date.now()}.sqlite`)
    d.exec(`VACUUM INTO '${backup.replaceAll("'", "''")}'`)
    console.log(`[db] copia de seguridad antes de migrar: ${backup}`)
  }

  d.exec('PRAGMA foreign_keys = OFF')
  d.exec('BEGIN')
  try {
    if (legacy) {
      for (const t of ['cells', 'tracks', 'activities']) d.exec(`ALTER TABLE ${t} RENAME TO ${t}_v0`)
      d.exec('DROP INDEX IF EXISTS cells_activity')
    }
    d.exec(SCHEMA)
    if (legacy) {
      // los datos existentes se asignan al primer usuario que inicie sesión (ver claimLegacyData)
      d.exec(`
        INSERT INTO activities SELECT ${LEGACY_USER}, id, name, type, start_time, distance_m, moving_time_s, elapsed_time_s,
          elevation_gain_m, description, gear, min_lng, min_lat, max_lng, max_lat, source_file, imported_at FROM activities_v0;
        INSERT INTO tracks SELECT ${LEGACY_USER}, activity_id, detail, overview FROM tracks_v0;
        INSERT INTO cells SELECT ${LEGACY_USER}, cell, activity_id FROM cells_v0;
        DROP TABLE cells_v0; DROP TABLE tracks_v0; DROP TABLE activities_v0;
        DELETE FROM settings WHERE key = 'strava_tokens';
      `)
    }
    d.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
    d.exec('COMMIT')
  } catch (e) {
    d.exec('ROLLBACK')
    throw e
  }
}

export function transaction<T>(fn: () => T): T {
  const d = useDb()
  d.exec('BEGIN')
  try {
    const r = fn()
    d.exec('COMMIT')
    return r
  } catch (e) {
    d.exec('ROLLBACK')
    throw e
  }
}

/** Cambia cada vez que el usuario importa datos; sirve para cachear respuestas. */
export function dataVersion(userId: number): string {
  const row = useDb().prepare('SELECT COUNT(*) AS n, MAX(imported_at) AS last FROM activities WHERE user_id = ?').get(userId) as { n: number, last: string | null }
  return `${userId}-${row.n}-${row.last ?? ''}`
}

export function getSetting<T>(key: string): T | undefined {
  const row = useDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row ? JSON.parse(row.value) as T : undefined
}

export function setSetting(key: string, value: unknown) {
  if (value === undefined) useDb().prepare('DELETE FROM settings WHERE key = ?').run(key)
  else useDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, JSON.stringify(value))
}
