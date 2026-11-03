<script setup lang="ts">
import { importZip, type ImportResult } from '~/utils/importZip'

const emit = defineEmits<{ close: [] }>()
const { state, afterImport } = useAtlas()

const busy = ref(false)
const error = ref('')
const results = ref<ImportResult[]>([])
const force = ref(false)
/** actividades procesadas / total */
const processing = ref<{ done: number, total: number } | null>(null)

async function run(fn: () => Promise<ImportResult | ImportResult[]>, pollServer = false) {
  busy.value = true
  error.value = ''
  results.value = []
  // la importación desde carpeta corre en el servidor: se consulta su progreso
  const timer = pollServer
    ? setInterval(async () => {
        const p = await $fetch<{ running: boolean, done: number, total: number }>('/api/import/progress').catch(() => null)
        if (p?.running && p.total) processing.value = p
      }, 700)
    : undefined
  try {
    const r = await fn()
    results.value = Array.isArray(r) ? r : [r]
    await afterImport()
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? e?.message ?? String(e)
  } finally {
    clearInterval(timer)
    busy.value = false
    processing.value = null
  }
}

function upload(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) run(() => importZip(file, force.value, (done, total) => { processing.value = { done, total } }))
}

const importLocal = () => run(() => $fetch<ImportResult[]>('/api/import/local', { method: 'POST', query: force.value ? { force: 1 } : {} }), true)
</script>

<template>
  <div class="backdrop" @click.self="emit('close')">
    <div class="dialog">
      <h2>Importar actividades</h2>
      <ol>
        <li>En Strava: <a href="https://www.strava.com/athlete/delete_your_account" target="_blank" rel="noopener">Ajustes → Mi cuenta → Descargar o eliminar tu cuenta</a> → «Solicitar archivo».</li>
        <li>Te llega por email un ZIP con <code>activities.csv</code> y la carpeta <code>activities/</code>.</li>
        <li>Elígelo aquí. Se lee en tu navegador y solo se envían las actividades nuevas (no las fotos).</li>
      </ol>

      <label class="btn primary" :class="{ disabled: busy }">
        Elegir ZIP de exportación
        <input type="file" accept=".zip" hidden :disabled="busy" @change="upload">
      </label>
      <p class="hint">
        ¿ZIP muy grande? Cópialo (o descomprimido) en <code>data/import/{{ state.user?.id }}/</code> y
        <button class="link" :disabled="busy" @click="importLocal">importa desde la carpeta</button>.
      </p>

      <label class="hint"><input v-model="force" type="checkbox" :disabled="busy"> Volver a procesar también las ya importadas</label>

      <div v-if="busy" class="status">
        <template v-if="processing && processing.total">
          Importando actividades: {{ processing.done }} / {{ processing.total }}
          <progress :value="processing.done" :max="processing.total" />
        </template>
        <template v-else-if="processing">Nada nuevo que importar</template>
        <template v-else>Leyendo el ZIP…</template>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
      <div v-for="(r, i) in results" :key="i" class="result">
        <strong>{{ r.source ? `${r.source}: ` : '' }}{{ r.imported }} importadas</strong>
        <span v-if="r.unchanged">, {{ r.unchanged }} ya estaban</span>
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
.status { color: #1f78ff; margin: 10px 0; }
progress { display: block; width: 100%; margin-top: 4px; }
label.hint { display: block; margin: 6px 0; }
.error { color: #dc2626; }
.result { font-size: 14px; margin-top: 8px; }
details { font-size: 12px; max-height: 200px; overflow: auto; }
.footer { text-align: right; margin-top: 16px; }
.disabled { opacity: 0.5; pointer-events: none; }
</style>
