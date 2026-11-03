<script setup lang="ts">
import { km, meters } from '~/utils/format'

const { state, byId, style, toggle, loadReferenceUrl, loadReferenceFile, clearReference } = useAtlas()
const url = ref('')

const SOURCES: Record<string, string> = {
  'file': 'Fichero',
  'mine': 'Actividad mía',
  'strava-activity': 'Actividad de Strava',
  'strava-route': 'Ruta de Strava',
  'strava-segment': 'Segmento de Strava',
}

function submit() {
  if (url.value.trim()) loadReferenceUrl(url.value.trim())
}

function pickFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) loadReferenceFile(file)
}

const cmp = computed(() => state.comparison)
const knownPct = computed(() => cmp.value ? Math.round((cmp.value.coveredM / cmp.value.totalM) * 100) : 0)
const matches = computed(() => (cmp.value?.matches ?? []).map(m => ({ m, a: byId.value.get(m.id)! })).filter(x => x.a))
const showAll = ref(false)
const visibleMatches = computed(() => showAll.value ? matches.value : matches.value.slice(0, 10))
watch(cmp, () => { showAll.value = false })

function overlayTop(n: number) {
  for (const { a } of matches.value.slice(0, n)) if (!state.selected.includes(a.id)) toggle(a.id)
}
</script>

<template>
  <section class="compare">
    <form v-if="!state.reference" class="row" @submit.prevent="submit">
      <input v-model="url" type="url" placeholder="URL de Strava: actividad, ruta o segmento" :disabled="state.compareBusy">
      <button class="btn" :disabled="state.compareBusy || !url.trim()">Comparar</button>
    </form>
    <p v-if="!state.reference" class="hint">
      o <label class="link">elige un GPX/FIT<input type="file" accept=".gpx,.tcx,.fit,.gz" hidden @change="pickFile"></label>
      (también puedes soltarlo en el mapa)
    </p>

    <p v-if="state.compareBusy" class="hint">Cargando y comparando…</p>
    <div v-if="state.compareError" class="error">
      {{ state.compareError.message }}
      <template v-if="state.compareError.exportUrl">
        <br><a :href="state.compareError.exportUrl" target="_blank" rel="noopener">Descargar GPX desde Strava</a> y suéltalo en el mapa.
      </template>
      <template v-if="state.compareError.needsStrava && state.compareError.configured">
        <br><a href="/api/strava/connect">Conectar con Strava</a>
      </template>
    </div>

    <template v-if="state.reference">
      <div class="ref-head">
        <div class="ref-name">
          <a v-if="state.reference.url" :href="state.reference.url" target="_blank" rel="noopener">{{ state.reference.name }}</a>
          <template v-else>{{ state.reference.name }}</template>
          <div class="meta">{{ SOURCES[state.reference.source] }} · {{ km(state.reference.distanceM) }} · {{ meters(state.reference.elevationGainM) }} D+</div>
        </div>
        <button class="link" title="Quitar" @click="clearReference">✕</button>
      </div>

      <template v-if="cmp">
        <div class="bar">
          <span :style="{ width: `${knownPct}%`, background: style.refKnown }" />
          <span :style="{ width: `${100 - knownPct}%`, background: style.refNew }" />
        </div>
        <div class="legend">
          <span><i :style="{ background: style.refKnown }" /> Ya recorrido {{ km(cmp.coveredM) }} ({{ knownPct }}%)</span>
          <span><i :style="{ background: style.refNew }" /> Nuevo {{ km(cmp.totalM - cmp.coveredM) }}</span>
        </div>
        <div class="row small">
          <label>Tolerancia
            <select v-model.number="state.compareTolerance">
              <option v-for="t in [15, 30, 50, 100]" :key="t" :value="t">{{ t }} m</option>
            </select>
          </label>
          <button v-if="matches.length" class="link" @click="overlayTop(3)">superponer las {{ Math.min(3, matches.length) }} más parecidas</button>
        </div>
      </template>
    </template>

    <ul v-if="matches.length" class="list">
      <ActivityItem
        v-for="{ m, a } in visibleMatches" :key="a.id" :activity="a"
        :note="`${km(m.overlapM)} en común (${m.pct}%)`"
      />
    </ul>
    <p v-else-if="cmp" class="hint">Ninguna de tus actividades pasa por este recorrido.</p>
    <button v-if="matches.length > visibleMatches.length" class="link more" @click="showAll = true">
      ver las {{ matches.length }} actividades que coinciden
    </button>
  </section>
</template>

<style scoped>
.compare { padding: 8px 12px; border-bottom: 2px solid #c026d333; display: flex; flex-direction: column; gap: 6px; }
.row { display: flex; gap: 6px; align-items: center; }
.row input { flex: 1; min-width: 0; padding: 5px 8px; border: 1px solid #d1d5db; border-radius: 6px; }
.small { font-size: 12px; justify-content: space-between; }
.hint { margin: 0; font-size: 12px; color: #6b7280; }
.error { font-size: 12px; color: #dc2626; }
.ref-head { display: flex; justify-content: space-between; gap: 8px; }
.ref-name { font-weight: 600; min-width: 0; }
.ref-name a { color: inherit; }
.meta { font-size: 12px; font-weight: normal; color: #6b7280; }
.bar { display: flex; height: 8px; border-radius: 4px; overflow: hidden; background: #e5e7eb; }
.legend { display: flex; justify-content: space-between; font-size: 12px; }
.legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; vertical-align: -1px; }
.list { margin: 0 -12px; max-height: 30vh; }
.more { align-self: flex-start; font-size: 12px; }
</style>
