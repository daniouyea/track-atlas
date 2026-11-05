<script setup lang="ts">
import { Route, Mountain, Bike, MoveRight, Undo2, Redo2, ArrowLeftRight, Trash2, Check } from 'lucide-vue-next'
import { ROUTE_COLOR } from '~/composables/useAtlas'
import type { ElevationSource, Engine } from '~/composables/useRouteEditor'

// Herramientas de dibujo del editor de rutas, en vertical sobre el mapa
const { editor, doc, history, undo, redo, reverse, clearRoute } = useRouteEditor()

type Menu = 'engine' | 'elevation' | 'profile' | null
const open = ref<Menu>(null)
const root = ref<HTMLElement>()
const toggle = (m: Menu) => { open.value = open.value === m ? null : m }

const engine = computed(() => editor.engines.find(e => e.id === editor.engine))
const profiles = computed(() => engine.value?.profiles ?? [])
const profileName = computed(() => profiles.value.find(p => p.id === editor.profile)?.name)

const ELEVATION: { id: ElevationSource, name: string, description: string }[] = [
  { id: 'dem', name: 'Modelo del terreno', description: 'Igual para todos los tramos, también los rectos' },
  { id: 'engine', name: 'Del motor de rutas', description: 'La de tus tracks o la que da BRouter' },
]

function pickEngine(id: Engine) {
  editor.engine = id
  editor.straight = false
  // perfil válido para el motor elegido
  const ps = editor.engines.find(e => e.id === id)?.profiles ?? []
  if (ps.length && !ps.some(p => p.id === editor.profile)) editor.profile = ps[0]!.id
  open.value = null
}

function clearAll() {
  if (doc.value?.waypoints.length && confirm('¿Borrar todos los puntos de la ruta?')) clearRoute()
}

const onClick = (e: MouseEvent) => { if (!root.value?.contains(e.target as Node)) open.value = null }
const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') open.value = null }
onMounted(() => { document.addEventListener('click', onClick); document.addEventListener('keydown', onKey) })
onBeforeUnmount(() => { document.removeEventListener('click', onClick); document.removeEventListener('keydown', onKey) })
</script>

<template>
  <div ref="root" class="route-toolbar" :style="{ '--accent': ROUTE_COLOR }">
    <div class="group">
      <div class="item">
        <button class="tool menu" :class="{ on: open === 'engine' }" :data-tip="`Motor: ${engine?.name ?? editor.engine}`" @click="toggle('engine')">
          <Route :size="18" />
        </button>
        <div v-if="open === 'engine'" class="popover">
          <div class="title">Calcular rutas con</div>
          <button
            v-for="e in editor.engines" :key="e.id" class="option" :disabled="!e.available"
            :class="{ selected: e.id === editor.engine && !editor.straight }" @click="pickEngine(e.id)"
          >
            <Check v-if="e.id === editor.engine && !editor.straight" :size="14" class="check" />
            <span class="name">{{ e.name }}</span>
            <span class="desc">{{ e.description }}</span>
          </button>
        </div>
      </div>

      <div class="item">
        <button class="tool menu" :class="{ on: open === 'elevation' }" :data-tip="`Altitud: ${ELEVATION.find(x => x.id === editor.elevation)?.name}`" @click="toggle('elevation')">
          <Mountain :size="18" />
        </button>
        <div v-if="open === 'elevation'" class="popover">
          <div class="title">Altitud</div>
          <button
            v-for="x in ELEVATION" :key="x.id" class="option" :class="{ selected: x.id === editor.elevation }"
            @click="editor.elevation = x.id; open = null"
          >
            <Check v-if="x.id === editor.elevation" :size="14" class="check" />
            <span class="name">{{ x.name }}</span>
            <span class="desc">{{ x.description }}</span>
          </button>
        </div>
      </div>

      <div v-if="profiles.length" class="item">
        <button class="tool menu" :class="{ on: open === 'profile' }" :data-tip="`Perfil: ${profileName}`" @click="toggle('profile')">
          <Bike :size="18" />
        </button>
        <div v-if="open === 'profile'" class="popover">
          <div class="title">Perfil de {{ engine?.name }}</div>
          <button
            v-for="p in profiles" :key="p.id" class="option" :class="{ selected: p.id === editor.profile }"
            @click="editor.profile = p.id; open = null"
          >
            <Check v-if="p.id === editor.profile" :size="14" class="check" />
            <span class="name">{{ p.name }}</span>
          </button>
        </div>
      </div>
    </div>

    <div class="group">
      <button
        class="tool" :class="{ active: editor.straight }"
        :data-tip="editor.straight ? 'Línea recta (activado)' : 'Línea recta: trazar sin calcular'"
        @click="editor.straight = !editor.straight"
      >
        <MoveRight :size="18" />
      </button>
    </div>

    <div class="group">
      <button class="tool" :disabled="!history.canUndo" data-tip="Deshacer (Ctrl+Z)" @click="undo"><Undo2 :size="18" /></button>
      <button class="tool" :disabled="!history.canRedo" data-tip="Rehacer (Ctrl+Y)" @click="redo"><Redo2 :size="18" /></button>
      <button class="tool" :disabled="!doc?.legs.length" data-tip="Invertir el sentido" @click="reverse"><ArrowLeftRight :size="18" /></button>
      <button class="tool" :disabled="!doc?.waypoints.length" data-tip="Borrar todos los puntos" @click="clearAll"><Trash2 :size="18" /></button>
    </div>
  </div>
</template>

<style scoped>
.route-toolbar { position: absolute; left: 10px; top: 62px; z-index: 3; display: flex; flex-direction: column; gap: 8px; }
.group { display: flex; flex-direction: column; background: #fff; border-radius: 8px; box-shadow: 0 2px 10px rgb(0 0 0 / 0.18); }
.item { position: relative; }
.tool {
  position: relative; display: grid; place-items: center; width: 36px; height: 36px; border: 0; background: none;
  color: #374151; cursor: pointer;
}
.group > .tool + .tool, .group > .item + .item, .group > .tool + .item, .group > .item + .tool { border-top: 1px solid #f1f1f1; }
.group > :first-child .tool, .group > .tool:first-child { border-radius: 8px 8px 0 0; }
.tool:hover:not(:disabled) { background: #f3f4f6; }
.tool:disabled { color: #d1d5db; cursor: default; }
.tool.on { background: #f3f4f6; }
.tool.active, .tool.active:hover:not(:disabled) { background: var(--accent); color: #fff; }
/* indicador de menú desplegable */
.tool.menu::after { content: ''; position: absolute; right: 4px; bottom: 4px; border: 3px solid transparent; border-right-color: currentColor; border-bottom-color: currentColor; opacity: 0.6; }
/* tooltip a la derecha */
.tool[data-tip]:hover::before {
  content: attr(data-tip); position: absolute; left: calc(100% + 8px); top: 50%; transform: translateY(-50%);
  white-space: nowrap; background: rgb(17 24 39 / 0.9); color: #fff; font-size: 12px; padding: 4px 8px; border-radius: 4px;
  pointer-events: none; z-index: 5;
}
.tool.on[data-tip]:hover::before { display: none; }
.popover {
  position: absolute; left: calc(100% + 8px); top: 0; z-index: 6; width: 250px; padding: 6px;
  background: #fff; border-radius: 8px; box-shadow: 0 6px 20px rgb(0 0 0 / 0.18);
}
.title { font-size: 12px; font-weight: 600; color: #6b7280; padding: 4px 8px; }
.option {
  position: relative; display: flex; flex-direction: column; align-items: flex-start; width: 100%; padding: 6px 8px 6px 26px;
  border: 0; background: none; border-radius: 6px; cursor: pointer; text-align: left;
}
.option:hover:not(:disabled) { background: #f3f4f6; }
.option:disabled { cursor: default; opacity: 0.5; }
.option.selected .name { color: var(--accent); font-weight: 600; }
.check { position: absolute; left: 7px; top: 9px; color: var(--accent); }
.name { font-size: 13px; color: #111; }
.desc { font-size: 11px; color: #6b7280; }
</style>
