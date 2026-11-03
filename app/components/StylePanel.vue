<script setup lang="ts">
import { basemaps } from '~/utils/basemaps'
import type { TrackStyle } from '~/utils/styles'

const { state, style, setStyle, resetStyle } = useAtlas()
const basemapName = computed(() => basemaps.find(b => b.id === state.basemap)?.name)

const set = <K extends keyof TrackStyle>(k: K, v: TrackStyle[K]) => setStyle({ [k]: v } as Partial<TrackStyle>)
const num = (e: Event) => Number((e.target as HTMLInputElement).value)
const val = (e: Event) => (e.target as HTMLInputElement).value
</script>

<template>
  <div class="style-panel">
    <p class="hint">Ajustes guardados para <strong>{{ basemapName }}</strong></p>

    <fieldset>
      <legend>Mapa base</legend>
      <label>Opacidad
        <input type="range" min="0.1" max="1" step="0.05" :value="style.mapOpacity" @input="set('mapOpacity', num($event))">
        <span>{{ Math.round(style.mapOpacity * 100) }}%</span>
      </label>
      <label>Atenuar hacia
        <select :value="style.veil" @change="set('veil', val($event))">
          <option value="#ffffff">blanco</option>
          <option value="#000000">negro</option>
        </select>
      </label>
    </fieldset>

    <fieldset>
      <legend>Heatmap</legend>
      <label>Color <input type="color" :value="style.heatColor" @input="set('heatColor', val($event))"></label>
      <label>Opacidad
        <input type="range" min="0.05" max="1" step="0.05" :value="style.heatOpacity" @input="set('heatOpacity', num($event))">
        <span>{{ Math.round(style.heatOpacity * 100) }}%</span>
      </label>
      <label>Grosor
        <input type="range" min="0.5" max="4" step="0.25" :value="style.heatWidth" @input="set('heatWidth', num($event))">
        <span>×{{ style.heatWidth }}</span>
      </label>
    </fieldset>

    <fieldset>
      <legend>Seleccionadas</legend>
      <label>Grosor
        <input type="range" min="0.5" max="3" step="0.25" :value="style.selWidth" @input="set('selWidth', num($event))">
        <span>×{{ style.selWidth }}</span>
      </label>
      <label><input type="checkbox" :checked="style.selCasing" @change="set('selCasing', ($event.target as HTMLInputElement).checked)"> Borde blanco</label>
      <p class="hint">El color de cada una se cambia pulsando su punto en la lista.</p>
    </fieldset>

    <fieldset>
      <legend>Comparación</legend>
      <label>Ya recorrido <input type="color" :value="style.refKnown" @input="set('refKnown', val($event))"></label>
      <label>Nuevo <input type="color" :value="style.refNew" @input="set('refNew', val($event))"></label>
      <label>Grosor
        <input type="range" min="0.5" max="3" step="0.25" :value="style.refWidth" @input="set('refWidth', num($event))">
        <span>×{{ style.refWidth }}</span>
      </label>
    </fieldset>

    <button class="link" @click="resetStyle">Restablecer este mapa</button>
  </div>
</template>

<style scoped>
.style-panel { padding: 8px 12px; border-bottom: 1px solid #e5e7eb; background: #fafafa; font-size: 13px; }
fieldset { border: 0; padding: 0; margin: 0 0 8px; display: grid; gap: 4px; }
legend { font-weight: 600; margin-bottom: 2px; }
label { display: flex; align-items: center; gap: 8px; }
input[type="range"] { flex: 1; }
input[type="color"] { width: 36px; height: 22px; padding: 0; border: 1px solid #d1d5db; border-radius: 4px; background: none; }
label span { width: 36px; text-align: right; color: #6b7280; }
.hint { margin: 0 0 6px; font-size: 12px; color: #6b7280; }
</style>
