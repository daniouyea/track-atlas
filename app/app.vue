<script setup lang="ts">
import { basemaps } from '~/utils/basemaps'
import { km } from '~/utils/format'

const { state, filtered, years, types, byId, profileTracks, loadActivities, clearSelection, focus, loadReferenceFile } = useAtlas()
const showImport = ref(false)
const showStyle = ref(false)
const stravaNotice = ref('')

// arrastrar un GPX/FIT al mapa para compararlo
const dragging = ref(false)
function onDrop(e: DragEvent) {
  dragging.value = false
  const file = e.dataTransfer?.files[0]
  if (file) loadReferenceFile(file)
}

onMounted(async () => {
  // vuelta del OAuth de Strava
  const params = new URLSearchParams(location.search)
  if (params.has('strava')) {
    stravaNotice.value = params.get('strava') === 'ok' ? 'Conectado con Strava. Ya puedes pegar URLs.' : `No se pudo conectar con Strava (${params.get('strava')})`
    history.replaceState(null, '', location.pathname)
  }
  await loadActivities()
  if (!state.activities.length) showImport.value = true
  else focus(state.activities.map(a => a.id))
})

const totalKm = computed(() => km(filtered.value.reduce((s, a) => s + (a.distanceM ?? 0), 0)))
const nearItems = computed(() => (state.near?.results ?? [])
  .map(r => ({ r, a: byId.value.get(r.id)! }))
  .filter(x => x.a))

function selectAllNear() {
  const { toggle } = useAtlas()
  for (const { a } of nearItems.value) if (!state.selected.includes(a.id)) toggle(a.id)
}
</script>

<template>
  <div class="layout">
    <aside class="sidebar">
      <header>
        <h1>Track Atlas</h1>
        <button class="btn" @click="showImport = true">Importar</button>
      </header>

      <div class="controls">
        <select v-model="state.basemap" title="Mapa base">
          <option v-for="b in basemaps" :key="b.id" :value="b.id">{{ b.name }}</option>
        </select>
        <label><input v-model="state.showHeat" type="checkbox"> Heatmap</label>
        <button class="btn small" :class="{ active: showStyle }" title="Colores, grosores y opacidad del mapa" @click="showStyle = !showStyle">Estilo</button>
        <label title="Radio de búsqueda al hacer clic en el mapa">
          Radio
          <select v-model.number="state.nearRadius">
            <option v-for="r in [25, 50, 100, 250, 500]" :key="r" :value="r">{{ r }} m</option>
          </select>
        </label>
      </div>

      <StylePanel v-if="showStyle" />
      <p v-if="stravaNotice" class="notice" @click="stravaNotice = ''">{{ stravaNotice }}</p>
      <ComparePanel />

      <section v-if="state.near" class="near">
        <div class="section-head">
          <strong v-if="state.near.loading">Buscando…</strong>
          <strong v-else-if="!nearItems.length">Nunca has pasado por aquí</strong>
          <strong v-else>Has pasado por aquí {{ nearItems.length }} {{ nearItems.length === 1 ? 'vez' : 'veces' }}</strong>
          <span>
            <button v-if="nearItems.length > 1" class="link" @click="selectAllNear">ver todas</button>
            <button class="link" @click="state.near = null">✕</button>
          </span>
        </div>
        <ul class="list">
          <ActivityItem
            v-for="{ r, a } in nearItems" :key="a.id" :activity="a"
            :note="`a ${r.distanceM} m, km ${(r.atDistanceM / 1000).toFixed(1)}`"
          />
        </ul>
      </section>

      <div class="filters">
        <input v-model="state.filters.q" type="search" placeholder="Buscar por nombre…">
        <select v-model="state.filters.year">
          <option value="">Todos los años</option>
          <option v-for="y in years" :key="y" :value="y">{{ y }}</option>
        </select>
        <select v-if="types.length > 1" v-model="state.filters.type">
          <option value="">Todos los tipos</option>
          <option v-for="t in types" :key="t" :value="t">{{ t }}</option>
        </select>
      </div>

      <div class="section-head">
        <span>{{ filtered.length }} actividades · {{ totalKm }}</span>
        <span v-if="state.selected.length">
          <button class="link" @click="focus(state.selected)">encuadrar</button>
          <button class="link" @click="clearSelection">limpiar ({{ state.selected.length }})</button>
        </span>
      </div>
      <ul class="list main-list">
        <ActivityItem v-for="a in filtered" :key="a.id" :activity="a" />
      </ul>
    </aside>

    <main
      class="map-area"
      @dragover.prevent="dragging = true" @dragleave.self="dragging = false" @drop.prevent="onDrop"
    >
      <AtlasMap />
      <div v-if="dragging" class="drop-hint">Suelta el GPX / FIT para compararlo con tus actividades</div>
      <div v-if="profileTracks.length" class="profile-panel">
        <ElevationProfile />
      </div>
      <div v-if="!state.near && state.loaded && state.activities.length" class="tip">
        Clic en el mapa: ¿he pasado por aquí? · Clic en una actividad: superponer
      </div>
    </main>

    <ImportDialog v-if="showImport" @close="showImport = false" />
  </div>
</template>
