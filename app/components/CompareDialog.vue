<script setup lang="ts">
const emit = defineEmits<{ close: [] }>()
const { state, loadReferenceUrl, loadReferenceFile } = useAtlas()
const url = ref('')
const input = ref<HTMLInputElement>()
onMounted(() => input.value?.focus())

async function load(fn: () => Promise<void>) {
  await fn()
  if (!state.compareError) emit('close')
}

function submit() {
  if (url.value.trim()) load(() => loadReferenceUrl(url.value.trim()))
}

function pickFile(e: Event) {
  const el = e.target as HTMLInputElement
  const file = el.files?.[0]
  el.value = ''
  if (file) load(() => loadReferenceFile(file))
}

// la descarga sigue en la pestaña de Strava; aquí se cierra el modal y se indica dónde arrastrarla
function downloadFromStrava() {
  state.downloadHint = true
  close()
}

function close() {
  state.compareError = null
  emit('close')
}
</script>

<template>
  <div class="backdrop" @click.self="close">
    <div class="dialog">
      <h2>Comparar con un track</h2>
      <p class="hint">Marca qué parte ya has recorrido y qué actividades tuyas coinciden más.</p>

      <form class="row" @submit.prevent="submit">
        <input ref="input" v-model="url" type="url" placeholder="URL de Strava: actividad, ruta o segmento" :disabled="state.compareBusy">
        <button class="btn primary" :disabled="state.compareBusy || !url.trim()">Comparar</button>
      </form>
      <p class="hint">
        o <label class="link">elige un fichero GPX / TCX / FIT<input type="file" accept=".gpx,.tcx,.fit,.gz" hidden @change="pickFile"></label>
        (también puedes soltarlo directamente en el mapa)
      </p>

      <p v-if="state.compareBusy" class="status">Cargando y comparando…</p>
      <div v-if="state.compareError" class="error">
        {{ state.compareError.message }}
        <template v-if="state.compareError.exportUrl">
          <br><a :href="state.compareError.exportUrl" target="_blank" rel="noopener" @click="downloadFromStrava">Descargar el GPX desde Strava</a> y suéltalo en el mapa.
        </template>
      </div>

      <div class="footer"><button class="btn" @click="close">Cerrar</button></div>
    </div>
  </div>
</template>

<style scoped>
.backdrop { position: fixed; inset: 0; background: rgb(0 0 0 / 0.35); display: grid; place-items: center; z-index: 10; }
.dialog { background: #fff; border-radius: 10px; padding: 20px 24px; width: min(560px, 92vw); }
h2 { margin: 0 0 4px; font-size: 18px; }
.row { display: flex; gap: 6px; margin: 12px 0 6px; }
.row input { flex: 1; min-width: 0; padding: 6px 10px; border: 1px solid #d1d5db; border-radius: 6px; }
.hint { margin: 0; font-size: 13px; color: #6b7280; }
.link { padding: 0; text-decoration: underline; }
.status { color: #1f78ff; font-size: 13px; }
.error { margin-top: 10px; font-size: 13px; color: #dc2626; }
.footer { text-align: right; margin-top: 16px; }
</style>
