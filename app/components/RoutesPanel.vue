<script setup lang="ts">
import { Plus, Download, Trash2, Save, X } from 'lucide-vue-next'
import { km, meters, date } from '~/utils/format'
import type { RouteDoc } from '~/utils/route'

// Pestaña «Rutas planificadas»: lista de rutas o, al editar, nombre, datos, guardar y exportar.
// Las herramientas de dibujo están en el mapa (RouteToolbar).
const { editor, doc, stats, startNew, openSaved, loadSaved, save, deleteSaved, close, rename, undo, redo, exportGpx } = useRouteEditor()

onMounted(loadSaved)

const legErrors = computed(() => (doc.value?.legs ?? []).filter(l => l.error))

async function exportSaved(id: string) {
  await exportGpx(await $fetch<RouteDoc>(`/api/routes/${id}`))
}

async function remove(id: string, name: string) {
  if (confirm(`¿Borrar la ruta «${name}»?`)) await deleteSaved(id)
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
    <!-- lista de rutas guardadas -->
    <template v-if="!editor.active">
      <div class="pad">
        <button class="btn primary with-icon" @click="startNew"><Plus :size="16" /> Nueva ruta</button>
        <p class="hint">También puedes partir de una actividad (✎ en la lista de actividades) o de un track cargado en «Comparar».</p>
      </div>
      <div class="section-head"><span>{{ editor.saved.length }} rutas planificadas</span></div>
      <ul class="list">
        <li v-for="r in editor.saved" :key="r.id" class="route" @click="openSaved(r.id)">
          <div class="body">
            <div class="name">{{ r.name }}</div>
            <div class="meta">{{ km(r.distanceM) }} · {{ meters(r.elevationGainM) }} D+ · {{ date(r.updatedAt) }}</div>
          </div>
          <div class="actions" @click.stop>
            <button title="Descargar GPX" @click="exportSaved(r.id)"><Download :size="15" /></button>
            <button title="Borrar" @click="remove(r.id, r.name)"><Trash2 :size="15" /></button>
          </div>
        </li>
        <li v-if="!editor.saved.length" class="empty">Aún no has planificado ninguna ruta.</li>
      </ul>
    </template>

    <!-- ruta en edición -->
    <template v-else-if="doc">
      <div class="pad editor">
        <input class="name" :value="doc.name" placeholder="Nombre de la ruta" @change="rename(($event.target as HTMLInputElement).value)">

        <div class="stats">
          <div><strong>{{ km(stats.distanceM) }}</strong><span>distancia</span></div>
          <div><strong>{{ editor.elevating ? '…' : meters(stats.elevationGainM) }}</strong><span>desnivel +</span></div>
          <div><strong>{{ stats.points }}</strong><span>puntos</span></div>
        </div>
        <p v-if="editor.pending" class="pending">Calculando…</p>
        <p v-for="(l, i) in legErrors" :key="i" class="warn">Un tramo va en línea recta: {{ l.error }}.</p>

        <div class="tools">
          <button class="btn primary with-icon" :disabled="editor.saving || doc.legs.length === 0" @click="save">
            <Save :size="15" /> {{ editor.saving ? 'Guardando…' : editor.dirty ? 'Guardar' : 'Guardada' }}
          </button>
          <button class="btn with-icon" :disabled="doc.legs.length === 0" @click="exportGpx()"><Download :size="15" /> GPX</button>
          <button class="btn with-icon" @click="close"><X :size="15" /> Cerrar</button>
        </div>

        <ul class="help">
          <li><strong>Clic en el mapa</strong>: añade un punto al final.</li>
          <li><strong>Arrastrar un punto</strong>: lo mueve y recalcula sus tramos.</li>
          <li><strong>Clic sobre la ruta</strong>: inserta un punto sin cambiarla.</li>
          <li><strong>Clic derecho en un punto</strong> (en móvil, tocarlo): lo borra.</li>
          <li>Para cambiar solo un trozo: pon un punto al inicio y otro al final del trozo, y arrastra uno intermedio.</li>
          <li>Motor, altitud, perfil y línea recta: en la barra de la izquierda del mapa.</li>
        </ul>
        <p class="credits">
          Caminos: <a href="https://brouter.de" target="_blank" rel="noopener">BRouter</a> · altitud:
          <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Terrain Tiles</a> · datos © OpenStreetMap
        </p>
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
/* sin ratón no hay :hover: los botones siempre a la vista */
@media (hover: none) { .route .actions { opacity: 1; } }
.route .actions button { display: grid; place-items: center; border: 0; background: none; cursor: pointer; color: #6b7280; padding: 4px; border-radius: 4px; }
.route .actions button:hover { background: #e5e7eb; color: #111; }
.empty { padding: 16px 12px; color: #6b7280; font-size: 13px; }
.editor { display: flex; flex-direction: column; gap: 10px; overflow: auto; }
.editor .name { font: inherit; font-weight: 600; padding: 6px 8px; border: 1px solid #d1d5db; border-radius: 6px; }
.stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.stats div { display: flex; flex-direction: column; background: #f9fafb; border-radius: 6px; padding: 6px 8px; }
.stats strong { font-size: 16px; }
.stats span { font-size: 11px; color: #6b7280; }
.pending { margin: 0; color: #059669; font-size: 12px; }
.warn { margin: 0; font-size: 12px; color: #b45309; }
.tools { display: flex; gap: 6px; flex-wrap: wrap; }
.help { margin: 0; padding-left: 18px; font-size: 12px; color: #4b5563; line-height: 1.6; }
.credits { margin: 0; font-size: 11px; color: #9ca3af; }
.credits a { color: inherit; }
</style>
