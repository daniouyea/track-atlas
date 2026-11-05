<script setup lang="ts">
import { Activity, Route as RouteIcon, Upload, GitCompare, PanelLeftClose, PanelLeftOpen, ChevronUp, ChevronDown } from 'lucide-vue-next'
import { km } from '~/utils/format'

const { state, filtered, zoneActive, years, types, byId, profileTracks, loadMe, syncStrava, loadActivities, clearSelection, focus, loadReferenceFile } = useAtlas()
const routeEditor = useRouteEditor()
const { mobile, collapsed, setCollapsed, openView } = useSidebar()
const showImport = ref(false)
const showCompare = ref(false)

// arrastrar un GPX/FIT al mapa para compararlo
const dragging = ref(false)
function onDrop(e: DragEvent) {
  dragging.value = false
  const file = e.dataTransfer?.files[0]
  if (file) loadReferenceFile(file)
}
// un error al soltar un fichero en el mapa se muestra en la ventana de comparación
watch(() => state.compareError, (e) => { if (e) showCompare.value = true })

onMounted(async () => {
  if (!(await loadMe())) return
  await loadActivities()
  if (state.activities.length) focus(state.activities.map(a => a.id))
  // novedades de Strava (la primera vez, las últimas actividades)
  const hadNone = !state.activities.length
  await syncStrava()
  if (hadNone && state.activities.length) focus(state.activities.map(a => a.id))
  if (!state.activities.length) showImport.value = true
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
  <div v-if="state.user === undefined" />
  <LoginScreen v-else-if="!state.user" :strava-configured="state.stravaConfigured" />
  <div v-else class="layout" :class="{ collapsed, mobile }">
    <!-- barra plegada: franja de iconos; cada uno despliega la barra en su pestaña -->
    <aside v-if="collapsed" class="rail">
      <button class="rail-btn" :title="mobile ? 'Abrir el panel' : 'Desplegar la barra lateral'" @click="setCollapsed(false)">
        <component :is="mobile ? ChevronUp : PanelLeftOpen" :size="18" />
      </button>
      <hr>
      <button
        class="rail-btn" :class="{ on: state.sidebarView === 'activities' }" title="Actividades"
        @click="openView('activities')"
      >
        <Activity :size="18" />
      </button>
      <button
        class="rail-btn" :class="{ on: state.sidebarView === 'routes' }" title="Rutas planificadas"
        @click="openView('routes')"
      >
        <RouteIcon :size="18" />
        <span v-if="routeEditor.editor.active" class="dot" />
      </button>
      <hr>
      <button class="rail-btn" title="Importar" @click="showImport = true"><Upload :size="18" /></button>
      <button class="rail-btn" title="Comparar con un track" @click="showCompare = true"><GitCompare :size="18" /></button>
      <button class="rail-btn avatar" :title="[state.user.firstname, state.user.lastname].filter(Boolean).join(' ')" @click="setCollapsed(false)">
        <img v-if="state.user.avatar" :src="state.user.avatar" alt="">
        <span v-else>{{ (state.user.firstname ?? '?').charAt(0) }}</span>
      </button>
    </aside>

    <aside v-else class="sidebar">
      <header>
        <h1>Track Atlas</h1>
        <button class="collapse" :title="mobile ? 'Cerrar el panel' : 'Plegar la barra lateral'" @click="setCollapsed(true)">
          <component :is="mobile ? ChevronDown : PanelLeftClose" :size="18" />
        </button>
      </header>
      <UserMenu />

      <!-- lo hecho y lo planificado, al mismo nivel -->
      <nav class="tabs" role="tablist">
        <button role="tab" :aria-selected="state.sidebarView === 'activities'" @click="state.sidebarView = 'activities'">
          <Activity :size="15" /> Actividades
        </button>
        <button role="tab" :aria-selected="state.sidebarView === 'routes'" @click="state.sidebarView = 'routes'">
          <RouteIcon :size="15" /> Rutas planificadas
          <span v-if="routeEditor.editor.active" class="dot" title="Editando una ruta" />
        </button>
      </nav>

      <div v-if="state.syncNotice" class="notice">
        <template v-if="state.syncNotice.firstSync">
          Hemos traído tus {{ state.syncNotice.imported }} actividades más recientes de Strava.
          Para el resto, <button class="link" @click="showImport = true">importa el ZIP o descarga el historial</button>.
        </template>
        <template v-else-if="state.syncNotice.imported">
          {{ state.syncNotice.imported }} {{ state.syncNotice.imported === 1 ? 'actividad nueva' : 'actividades nuevas' }} de Strava.
        </template>
        <template v-if="state.syncNotice.pending">
          Quedan {{ state.syncNotice.pending }} por traer: se descargarán en la próxima sincronización.
        </template>
        <template v-if="state.syncNotice.errors.length">
          {{ state.syncNotice.errors.length }} no se pudieron descargar.
        </template>
        <button class="link" title="Cerrar" @click="state.syncNotice = null">✕</button>
      </div>
      <RoutesPanel v-if="state.sidebarView === 'routes'" />
      <template v-else>
      <div class="tab-actions">
        <button class="btn small with-icon" title="Importar el ZIP de Strava o sincronizar" @click="showImport = true">
          <Upload :size="14" /> Importar
        </button>
        <button class="btn small with-icon" title="Comparar un track (URL de Strava o GPX) con tus actividades" @click="showCompare = true">
          <GitCompare :size="14" /> Comparar con un track
        </button>
      </div>
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
        <label class="in-view" title="La lista muestra solo las actividades que pasan por la zona que ves en el mapa">
          <input v-model="state.filters.inView" type="checkbox"> Solo lo visible en el mapa
        </label>
      </div>

      <div class="section-head">
        <span>{{ filtered.length }} actividades · {{ totalKm }}<template v-if="zoneActive"> en esta zona</template></span>
        <span v-if="state.selected.length">
          <button class="link" @click="focus(state.selected)">encuadrar</button>
          <button class="link" @click="clearSelection">limpiar ({{ state.selected.length }})</button>
        </span>
      </div>
      <ul class="list main-list">
        <ActivityItem v-for="a in filtered" :key="a.id" :activity="a" />
        <li v-if="zoneActive && !filtered.length" class="empty">Ninguna actividad pasa por la zona del mapa.</li>
      </ul>
      </template>
    </aside>

    <main
      class="map-area"
      @dragover.prevent="dragging = true" @dragleave.self="dragging = false" @drop.prevent="onDrop"
    >
      <AtlasMap />
      <!-- barras de la esquina superior izquierda, apiladas (si la de arriba ocupa dos líneas, la otra baja) -->
      <div class="map-left">
        <MapToolbar />
        <RouteToolbar v-if="routeEditor.editor.active" />
      </div>
      <div v-if="dragging" class="drop-hint">Suelta el GPX / FIT para compararlo con tus actividades</div>
      <div v-if="profileTracks.length" class="profile-panel">
        <ElevationProfile />
      </div>
      <div v-if="routeEditor.editor.active && !routeEditor.doc.value?.waypoints.length" class="tip">
        {{ mobile ? 'Toca' : 'Haz clic en' }} el mapa para poner el punto de salida
      </div>
      <div v-else-if="!routeEditor.editor.active && !state.near && !profileTracks.length && state.loaded && state.activities.length" class="tip">
        <template v-if="mobile">Toca el mapa: ¿he pasado por aquí?</template>
        <template v-else>Clic en el mapa: ¿he pasado por aquí? · Clic en una actividad: superponer</template>
      </div>
    </main>

    <ImportDialog v-if="showImport" @close="showImport = false" />
    <CompareDialog v-if="showCompare" @close="showCompare = false" />
    <DownloadHint v-if="state.downloadHint" />
  </div>
</template>
