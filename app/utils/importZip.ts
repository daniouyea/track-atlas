import { BlobReader, TextWriter, Uint8ArrayWriter, ZipReader, configure, type FileEntry } from '@zip.js/zip.js'

// Sin web workers: evita tener que servir sus scripts aparte; DecompressionStream nativo ya es rápido
configure({ useWebWorkers: false })

export interface ImportResult {
  source?: string
  imported: number
  unchanged: number
  skipped: { id: string, reason: string }[]
  errors: { file: string, error: string }[]
}

// Muy por debajo del límite de 100 MB por petición de Cloudflare
const BATCH_BYTES = 20 * 1024 * 1024
const BATCH_FILES = 40

/** Comprime con gzip en el navegador: un GPX ocupa 5-10 veces menos al subirlo. */
async function gzip(data: Uint8Array<ArrayBuffer>) {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn()
    } catch (e: any) {
      const status = e?.response?.status ?? e?.statusCode
      // 4xx no se arregla reintentando
      if (i >= attempts || (status >= 400 && status < 500)) throw e
      await new Promise(r => setTimeout(r, 1000 * i))
    }
  }
}

/**
 * Importa el ZIP de exportación de Strava leyéndolo en el navegador: solo sube activities.csv y los
 * ficheros de actividades que faltan (no las fotos), en tandas pequeñas.
 */
export async function importZip(file: File, force: boolean, onProgress: (done: number, total: number) => void): Promise<ImportResult> {
  // BlobReader lee por trozos: no carga el ZIP entero en memoria
  const reader = new ZipReader(new BlobReader(file))
  try {
    const entries = (await reader.getEntries()).filter((e): e is FileEntry => !e.directory)
    const byName = new Map(entries.map(e => [e.filename, e]))
    const csvEntry = entries.find(e => e.filename.split('/').pop()!.toLowerCase() === 'activities.csv')
    const csv = csvEntry ? await csvEntry.getData(new TextWriter()) : null

    const plan = await $fetch<{ needed: string[] }>('/api/import/start', {
      method: 'POST',
      body: { csv, files: entries.map(e => e.filename), force },
    })

    let done = 0
    onProgress(done, plan.needed.length)
    let batch: [string, Uint8Array<ArrayBuffer>][] = []
    let bytes = 0
    const flush = async () => {
      const form = new FormData()
      for (const [name, data] of batch) form.append(name, new Blob([data]))
      await withRetry(() => $fetch('/api/import/files', { method: 'POST', body: form }))
      done += batch.length
      onProgress(done, plan.needed.length)
      batch = []
      bytes = 0
    }
    for (const name of plan.needed) {
      const entry = byName.get(name)
      if (!entry) continue
      const raw = await entry.getData(new Uint8ArrayWriter())
      // los .fit.gz / .gpx.gz de Strava ya van comprimidos; el resto se comprime y se marca con .gz
      const data = name.endsWith('.gz') ? raw : await gzip(raw)
      batch.push([name.endsWith('.gz') ? name : `${name}.gz`, data])
      bytes += data.byteLength
      if (bytes >= BATCH_BYTES || batch.length >= BATCH_FILES) await flush()
    }
    if (batch.length) await flush()

    return await $fetch<ImportResult>('/api/import/finish', { method: 'POST' })
  } finally {
    await reader.close()
  }
}
