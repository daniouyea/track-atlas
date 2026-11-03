<script setup lang="ts">
const emit = defineEmits<{ close: [] }>()
const { afterImport } = useAtlas()

interface ImportResult {
  source?: string
  imported: number
  skipped: { id: string, reason: string }[]
  errors: { file: string, error: string }[]
}

const busy = ref(false)
const error = ref('')
const results = ref<ImportResult[]>([])

async function run(fn: () => Promise<ImportResult | ImportResult[]>) {
  busy.value = true
  error.value = ''
  results.value = []
  try {
    const r = await fn()
    results.value = Array.isArray(r) ? r : [r]
    await afterImport()
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? e?.message ?? String(e)
  } finally {
    busy.value = false
  }
}

function upload(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) run(() => $fetch<ImportResult>('/api/import', { method: 'POST', body: file, headers: { 'Content-Type': 'application/zip' } }))
}

const importLocal = () => run(() => $fetch<ImportResult[]>('/api/import-local', { method: 'POST' }))
</script>

<template>
  <div class="backdrop" @click.self="emit('close')">
    <div class="dialog">
      <h2>Importar actividades</h2>
      <ol>
        <li>En Strava: <a href="https://www.strava.com/athlete/delete_your_account" target="_blank" rel="noopener">Ajustes → Mi cuenta → Descargar o eliminar tu cuenta</a> → «Solicitar archivo».</li>
        <li>Te llega por email un ZIP con <code>activities.csv</code> y la carpeta <code>activities/</code>.</li>
        <li>Súbelo aquí. Puedes repetirlo cuando quieras: las actividades existentes se actualizan.</li>
      </ol>

      <label class="btn primary" :class="{ disabled: busy }">
        Subir ZIP de exportación
        <input type="file" accept=".zip" hidden :disabled="busy" @change="upload">
      </label>
      <p class="hint">
        ¿ZIP muy grande? Cópialo (o descomprimido) en <code>data/import/</code> y
        <button class="link" :disabled="busy" @click="importLocal">importa desde la carpeta</button>.
      </p>

      <p v-if="busy" class="status">Importando… puede tardar un par de minutos.</p>
      <p v-if="error" class="error">{{ error }}</p>
      <div v-for="(r, i) in results" :key="i" class="result">
        <strong>{{ r.source ? `${r.source}: ` : '' }}{{ r.imported }} importadas</strong>
        <span v-if="r.skipped.length">, {{ r.skipped.length }} sin GPS u omitidas</span>
        <span v-if="r.errors.length" class="error">, {{ r.errors.length }} con error</span>
        <details v-if="r.errors.length || r.skipped.length">
          <summary>Detalles</summary>
          <ul>
            <li v-for="e in r.errors" :key="e.file" class="error">{{ e.file }}: {{ e.error }}</li>
            <li v-for="s in r.skipped" :key="s.id">{{ s.id }}: {{ s.reason }}</li>
          </ul>
        </details>
      </div>

      <div class="footer"><button class="btn" @click="emit('close')">Cerrar</button></div>
    </div>
  </div>
</template>

<style scoped>
.backdrop { position: fixed; inset: 0; background: rgb(0 0 0 / 0.35); display: grid; place-items: center; z-index: 10; }
.dialog { background: #fff; border-radius: 10px; padding: 20px 24px; width: min(560px, 92vw); max-height: 85vh; overflow: auto; }
h2 { margin: 0 0 8px; font-size: 18px; }
ol { padding-left: 20px; line-height: 1.5; font-size: 14px; }
.hint { font-size: 13px; color: #6b7280; }
.link { border: 0; background: none; color: #fc4c02; cursor: pointer; padding: 0; font: inherit; text-decoration: underline; }
.status { color: #1f78ff; }
.error { color: #dc2626; }
.result { font-size: 14px; margin-top: 8px; }
details { font-size: 12px; max-height: 200px; overflow: auto; }
.footer { text-align: right; margin-top: 16px; }
.disabled { opacity: 0.5; pointer-events: none; }
</style>
