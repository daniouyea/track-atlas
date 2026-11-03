<script setup lang="ts">
import { basemaps } from '~/utils/basemaps'

const { state } = useAtlas()
const showStyle = ref(false)
</script>

<template>
  <div class="map-toolbar">
    <div class="bar">
      <select v-model="state.basemap" title="Mapa base">
        <option v-for="b in basemaps" :key="b.id" :value="b.id">{{ b.name }}</option>
      </select>
      <label title="Mostrar todas tus actividades"><input v-model="state.showHeat" type="checkbox"> Heatmap</label>
      <label title="Radio de búsqueda al hacer clic en el mapa">
        Radio
        <select v-model.number="state.nearRadius">
          <option v-for="r in [25, 50, 100, 250, 500]" :key="r" :value="r">{{ r }} m</option>
        </select>
      </label>
      <button class="btn small" :class="{ active: showStyle }" title="Colores, grosores y opacidad del mapa" @click="showStyle = !showStyle">
        Estilo
      </button>
    </div>
    <div v-if="showStyle" class="popover">
      <StylePanel />
    </div>
  </div>
</template>

<style scoped>
.map-toolbar { position: absolute; top: 10px; left: 10px; z-index: 2; display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
.bar, .popover { background: rgb(255 255 255 / 0.96); border-radius: 8px; box-shadow: 0 2px 10px rgb(0 0 0 / 0.18); }
.bar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; padding: 6px 10px; font-size: 13px; }
.bar label { display: flex; align-items: center; gap: 4px; white-space: nowrap; }
.bar select { padding: 3px 6px; }
.popover { width: 300px; max-height: calc(100vh - 80px); overflow: auto; }
.popover :deep(.style-panel) { background: none; border: 0; }
</style>
