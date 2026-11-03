import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

let db: DatabaseSync | undefined

export function dataDir() {
  return process.env.DATA_DIR || join(process.cwd(), 'data')
}

export function useDb() {
  if (db) return db
  mkdirSync(dataDir(), { recursive: true })
  db = new DatabaseSync(join(dataDir(), 'atlas.sqlite'))
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY,
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
      imported_at TEXT NOT NULL
    );

    -- detail: [[lng, lat, ele, dist_m, t_s], ...] remuestreado cada ~8 m
    -- overview: [[lng, lat], ...] simplificado para vista general / heatmap
    CREATE TABLE IF NOT EXISTS tracks (
      activity_id TEXT PRIMARY KEY REFERENCES activities(id) ON DELETE CASCADE,
      detail TEXT NOT NULL,
      overview TEXT NOT NULL
    );

    -- índice espacial simple: celdas de rejilla por las que pasa cada actividad
    CREATE TABLE IF NOT EXISTS cells (
      cell TEXT NOT NULL,
      activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      PRIMARY KEY (cell, activity_id)
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS cells_activity ON cells(activity_id);
  `)
  return db
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

/** Cambia cada vez que se importan datos; sirve para cachear respuestas. */
export function dataVersion(): string {
  const row = useDb().prepare('SELECT COUNT(*) AS n, MAX(imported_at) AS last FROM activities').get() as { n: number, last: string | null }
  return `${row.n}-${row.last ?? ''}`
}
