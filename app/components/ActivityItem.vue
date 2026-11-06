<script setup lang="ts">
import type { Activity } from '~/composables/useAtlas'
import { km, meters, duration, date } from '~/utils/format'

const props = defineProps<{ activity: Activity, note?: string }>()
const { state, toggle, focus, setColor, loadDetail } = useAtlas()
const { editor, startFromTrack, close } = useRouteEditor()

// si el elemento desaparece de la lista con el cursor encima, no queda resaltado en el mapa
onBeforeUnmount(() => { if (state.hoverActivity === props.activity.id) state.hoverActivity = null })

/** Abre el editor de rutas con esta actividad como punto de partida */
async function toRoute() {
  if (editor.active && !close()) return
  const d = await loadDetail(props.activity.id)
  startFromTrack(props.activity.name, d.detail.map(p => [p[0], p[1], p[2]]))
  state.sidebarView = 'routes'
}
</script>

<template>
  <li
    class="item" :class="{ selected: state.selected.includes(activity.id) }"
    :style="{ '--c': state.colors[activity.id] }"
    @click="toggle(activity.id)"
    @mouseenter="state.hoverActivity = activity.id"
    @mouseleave="state.hoverActivity === activity.id && (state.hoverActivity = null)"
  >
    <!-- seleccionada: el punto abre el selector de color -->
    <label v-if="state.selected.includes(activity.id)" class="swatch" title="Cambiar color" @click.stop>
      <input type="color" :value="state.colors[activity.id]" @input="setColor(activity.id, ($event.target as HTMLInputElement).value)">
    </label>
    <span v-else class="swatch" />
    <div class="body">
      <div class="name" :title="activity.name">{{ activity.name }}</div>
      <div class="meta">
        {{ date(activity.startTime) }} · {{ km(activity.distanceM) }} · {{ meters(activity.elevationGainM) }} D+ · {{ duration(activity.movingTimeS) }}
        <template v-if="note"> · <em>{{ note }}</em></template>
      </div>
    </div>
    <div class="actions" @click.stop>
      <button title="Encuadrar" @click="focus([activity.id])">⌖</button>
      <button title="Crear una ruta a partir de esta actividad" @click="toRoute">✎</button>
      <a :href="`https://www.strava.com/activities/${activity.id}`" target="_blank" rel="noopener" title="Abrir en Strava">↗</a>
    </div>
  </li>
</template>

<style scoped>
.item {
  display: flex; align-items: center; gap: 8px; padding: 6px 10px; cursor: pointer;
  border-bottom: 1px solid #f1f1f1;
}
.item:hover { background: #f8f8f8; }
.item.selected { background: color-mix(in srgb, var(--c) 10%, white); }
.swatch { width: 10px; height: 10px; border-radius: 50%; border: 2px solid #d1d5db; flex: none; }
.selected .swatch { background: var(--c); border-color: var(--c); cursor: pointer; position: relative; }
.selected .swatch:hover { transform: scale(1.4); }
.swatch input { position: absolute; inset: 0; opacity: 0; width: 100%; height: 100%; cursor: pointer; }
.body { flex: 1; min-width: 0; }
.name { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.meta { font-size: 12px; color: #6b7280; }
.actions { display: flex; gap: 2px; opacity: 0; }
.item:hover .actions { opacity: 1; }
/* sin ratón no hay :hover: los botones siempre a la vista */
@media (hover: none) { .actions { opacity: 1; } }
.actions button, .actions a {
  border: 0; background: none; cursor: pointer; font-size: 15px; color: #6b7280;
  text-decoration: none; padding: 2px 4px; border-radius: 4px;
}
.actions button:hover, .actions a:hover { background: #e5e7eb; color: #111; }
</style>
