<script setup lang="ts">
import { km, meters, date } from '~/utils/format'
import { BROUTER_PROFILES, downloadGpx, type RouteDoc } from '~/utils/route'

const { editor, doc, stats, history, startNew, openSaved, loadSaved, save, deleteSaved, close, rename, reverse, clearRoute, undo, redo } = useRouteEditor()
const { state } = useAtlas()

onMounted(loadSaved)

const legErrors = computed(() => (doc.value?.legs ?? []).filter(l => l.error))

async function exportSaved(id: string) {
  downloadGpx(await $fetch<RouteDoc>(`/api/routes/${id}`))
}

async function remove(id: string, name: string) {
  if (confirm(`¿Borrar la ruta «${name}»?`)) await deleteSaved(id)
}

function back() {
  if (!editor.active || close()) state.sidebarView = 'activities'
}

// atajos de teclado mientras se edita (fuera de los campos de texto)
function onKey(e: KeyboardEvent) {
  if (!editor.active || (e.target as HTMLElement)?.closest('input, textarea, select')) return
  const mod = e.ctrlKey || e.metaKey
  if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
  else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo() }
}
onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <section class="routes">
    <div class="section-head">
      <button class="link" @click="back">← Actividades</button>
      <strong>{{ editor.active ? 'Editando ruta' : 'Mis rutas' }}</strong>
    </div>

    <!-- lista de rutas guardadas -->
    <template v-if="!editor.active">
      <div class="pad">
        <button class="btn primary" @click="startNew">Nueva ruta</button>
        <p class="hint">También puedes empezar desde una actividad (✎ en la lista) o desde un track cargado en «Comparar».</p>
      </div>
      <ul class="list">
        <li v-for="r in editor.saved" :key="r.id" class="route" @click="openSaved(r.id)">
          <div class="body">
            <div class="name">{{ r.name }}</div>
            <div class="meta">{{ km(r.distanceM) }} · {{ meters(r.elevationGainM) }} D+ · {{ date(r.updatedAt) }}</div>
          </div>
          <div class="actions" @click.stop>
            <button title="Descargar GPX" @click="exportSaved(r.id)">⤓</button>
            <button title="Borrar" @click="remove(r.id, r.name)">🗑</button>
          </div>
        </li>
        <li v-if="!editor.saved.length" class="empty">Aún no tienes rutas guardadas.</li>
      </ul>
    </template>

    <!-- editor -->
    <template v-else-if="doc">
      <div class="pad editor">
        <input class="name" :value="doc.name" placeholder="Nombre de la ruta" @change="rename(($event.target as HTMLInputElement).value)">

        <div class="modes" role="radiogroup" aria-label="Cómo se calculan los tramos">
          <label :class="{ on: editor.mode === 'tracks' }" title="Por donde ya has pasado">
            <input v-model="editor.mode" type="radio" value="tracks"> Mis tracks
          </label>
          <label :class="{ on: editor.mode === 'brouter' }" title="Por caminos y carreteras (BRouter)">
            <input v-model="editor.mode" type="radio" value="brouter"> Caminos
          </label>
          <label :class="{ on: editor.mode === 'straight' }" title="Sin calcular: para trazar a mano">
            <input v-model="editor.mode" type="radio" value="straight"> Recta
          </label>
        </div>
        <label v-if="editor.mode === 'brouter'" class="profile">
          Perfil
          <select v-model="editor.profile">
            <option v-for="p in BROUTER_PROFILES" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
        </label>

        <div class="stats">
          <span><strong>{{ km(stats.distanceM) }}</strong></span>
          <span><strong>{{ meters(stats.elevationGainM) }}</strong> D+</span>
          <span>{{ stats.points }} puntos</span>
          <span v-if="editor.pending" class="pending">calculando…</span>
        </div>

        <p v-for="(l, i) in legErrors" :key="i" class="warn">Un tramo va en línea recta: {{ l.error }}.</p>

        <div class="tools">
          <button class="btn small" :disabled="!history.canUndo" title="Deshacer (Ctrl+Z)" @click="undo">↶ Deshacer</button>
          <button class="btn small" :disabled="!history.canRedo" title="Rehacer (Ctrl+Y)" @click="redo">↷ Rehacer</button>
          <button class="btn small" :disabled="doc.legs.length === 0" @click="reverse">⇄ Invertir</button>
          <button class="btn small" :disabled="!doc.waypoints.length" @click="clearRoute">Borrar todo</button>
        </div>

        <div class="tools">
          <button class="btn primary" :disabled="editor.saving || doc.legs.length === 0" @click="save">
            {{ editor.saving ? 'Guardando…' : editor.dirty ? 'Guardar' : 'Guardada' }}
          </button>
          <button class="btn" :disabled="doc.legs.length === 0" @click="downloadGpx(doc)">Exportar GPX</button>
          <button class="btn" @click="close">Cerrar</button>
        </div>

        <ul class="help">
          <li><strong>Clic en el mapa</strong>: añade un punto al final.</li>
          <li><strong>Arrastrar un punto</strong>: lo mueve y recalcula sus tramos.</li>
          <li><strong>Clic sobre la ruta</strong>: inserta un punto sin cambiarla.</li>
          <li><strong>Clic derecho en un punto</strong>: lo borra.</li>
          <li>Para cambiar solo un trozo: pon un punto al inicio y otro al final del trozo, y arrastra uno intermedio.</li>
        </ul>
        <p class="credits">Caminos: <a href="https://brouter.de" target="_blank" rel="noopener">BRouter</a> · datos © OpenStreetMap</p>
      </div>
    </template>
  </section>
</template>

<style scoped>
.routes { display: flex; flex-direction: column; min-height: 0; flex: 1; }
.pad { padding: 10px 12px; }
.hint { font-size: 12px; color: #6b7280; margin: 8px 0 0; }
.route { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid #f1f1f1; cursor: pointer; }
.route:hover { background: #f8f8f8; }
.route .body { flex: 1; min-width: 0; }
.route .name { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.route .meta { font-size: 12px; color: #6b7280; }
.route .actions { display: flex; gap: 2px; opacity: 0; }
.route:hover .actions { opacity: 1; }
.route .actions button { border: 0; background: none; cursor: pointer; font-size: 15px; color: #6b7280; padding: 2px 5px; border-radius: 4px; }
.route .actions button:hover { background: #e5e7eb; color: #111; }
.empty { padding: 16px 12px; color: #6b7280; font-size: 13px; }
.editor { display: flex; flex-direction: column; gap: 10px; overflow: auto; }
.editor .name { font: inherit; font-weight: 600; padding: 6px 8px; border: 1px solid #d1d5db; border-radius: 6px; }
.modes { display: flex; border: 1px solid #d1d5db; border-radius: 6px; overflow: hidden; }
.modes label { flex: 1; text-align: center; padding: 6px 4px; font-size: 13px; cursor: pointer; }
.modes label.on { background: #7c3aed; color: #fff; }
.modes input { display: none; }
.stats { display: flex; gap: 12px; align-items: baseline; font-size: 14px; flex-wrap: wrap; }
.pending { color: #7c3aed; font-size: 12px; }
.warn { margin: 0; font-size: 12px; color: #b45309; }
.tools { display: flex; gap: 6px; flex-wrap: wrap; }
.profile { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.profile select { flex: 1; padding: 4px 6px; }
.credits { margin: 0; font-size: 11px; color: #9ca3af; }
.credits a { color: inherit; }
.help { margin: 0; padding-left: 18px; font-size: 12px; color: #4b5563; line-height: 1.6; }
</style>
