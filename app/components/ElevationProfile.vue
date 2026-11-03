<script setup lang="ts">
import type { DetailPoint } from '~/composables/useAtlas'

const { state, details } = useAtlas()
const box = ref<HTMLDivElement>()
const width = ref(600)
const height = 150
const pad = { l: 44, r: 12, t: 10, b: 22 }

let ro: ResizeObserver | undefined
onMounted(() => {
  ro = new ResizeObserver(([e]) => { width.value = e!.contentRect.width })
  ro.observe(box.value!)
})
onBeforeUnmount(() => ro?.disconnect())

const tracks = computed(() => state.selected
  .map(id => ({ id, color: state.colors[id]!, name: details[id]?.name ?? '', pts: details[id]?.detail.filter(p => p[2] != null) ?? [] }))
  .filter(t => t.pts.length > 1))

const domain = computed(() => {
  let maxD = 0, minE = Infinity, maxE = -Infinity
  for (const t of tracks.value) {
    maxD = Math.max(maxD, t.pts.at(-1)![3])
    for (const p of t.pts) { minE = Math.min(minE, p[2]!); maxE = Math.max(maxE, p[2]!) }
  }
  const margin = Math.max(10, (maxE - minE) * 0.08)
  return { maxD: maxD || 1, minE: minE - margin, maxE: maxE + margin }
})

const plotW = computed(() => Math.max(10, width.value - pad.l - pad.r))
const plotH = height - pad.t - pad.b
const x = (d: number) => pad.l + (d / domain.value.maxD) * plotW.value
const y = (e: number) => pad.t + (1 - (e - domain.value.minE) / (domain.value.maxE - domain.value.minE)) * plotH

const paths = computed(() => tracks.value.map((t) => {
  // no hace falta más de ~2 puntos por píxel
  const step = Math.max(1, Math.floor(t.pts.length / (plotW.value * 2)))
  let d = ''
  for (let i = 0; i < t.pts.length; i += step) d += `${i ? 'L' : 'M'}${x(t.pts[i]![3]).toFixed(1)},${y(t.pts[i]![2]!).toFixed(1)}`
  return { id: t.id, color: t.color, d }
}))

const xTicks = computed(() => {
  const km = domain.value.maxD / 1000
  const step = [1, 2, 5, 10, 20, 25, 50, 100].find(s => km / s <= Math.max(2, plotW.value / 80)) ?? 200
  const ticks: number[] = []
  for (let k = 0; k <= km; k += step) ticks.push(k)
  return ticks
})

const yTicks = computed(() => {
  const { minE, maxE } = domain.value
  const step = [10, 20, 50, 100, 200, 250, 500].find(s => (maxE - minE) / s <= 4) ?? 1000
  const ticks: number[] = []
  for (let e = Math.ceil(minE / step) * step; e <= maxE; e += step) ticks.push(e)
  return ticks
})

function eleAt(pts: DetailPoint[], dist: number) {
  if (dist > pts.at(-1)![3]) return null
  let lo = 0, hi = pts.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (pts[mid]![3] < dist) lo = mid + 1
    else hi = mid
  }
  return pts[lo]![2]
}

const hoverInfo = computed(() => {
  const d = state.hoverDistance
  if (d == null) return null
  return {
    x: x(d),
    km: (d / 1000).toFixed(2),
    rows: tracks.value.map(t => ({ id: t.id, color: t.color, name: t.name, ele: eleAt(t.pts, d) })).filter(r => r.ele != null),
  }
})

function onMove(e: MouseEvent) {
  const rect = (e.currentTarget as SVGElement).getBoundingClientRect()
  const px = e.clientX - rect.left
  if (px < pad.l || px > pad.l + plotW.value) { state.hoverDistance = null; return }
  state.hoverDistance = ((px - pad.l) / plotW.value) * domain.value.maxD
}
</script>

<template>
  <div ref="box" class="profile">
    <svg v-if="tracks.length" :width="width" :height="height" @mousemove="onMove" @mouseleave="state.hoverDistance = null">
      <g class="grid">
        <line v-for="e in yTicks" :key="'y' + e" :x1="pad.l" :x2="pad.l + plotW" :y1="y(e)" :y2="y(e)" />
        <text v-for="e in yTicks" :key="'yt' + e" :x="pad.l - 6" :y="y(e) + 4" text-anchor="end">{{ e }}</text>
        <text v-for="k in xTicks" :key="'xt' + k" :x="x(k * 1000)" :y="height - 6" text-anchor="middle">{{ k }} km</text>
      </g>
      <path v-for="p in paths" :key="p.id" :d="p.d" :stroke="p.color" fill="none" stroke-width="2" stroke-linejoin="round" />
      <line v-if="hoverInfo" class="cursor" :x1="hoverInfo.x" :x2="hoverInfo.x" :y1="pad.t" :y2="pad.t + plotH" />
    </svg>
    <div v-else class="empty">Sin datos de altitud</div>
    <div v-if="hoverInfo" class="tooltip" :style="{ left: `${Math.min(hoverInfo.x + 10, width - 200)}px` }">
      <strong>{{ hoverInfo.km }} km</strong>
      <div v-for="r in hoverInfo.rows" :key="r.id" class="row">
        <span class="dot" :style="{ background: r.color }" />
        <span class="name">{{ r.name }}</span>
        <span>{{ Math.round(r.ele!) }} m</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.profile { position: relative; height: 150px; user-select: none; }
svg { display: block; cursor: crosshair; }
.grid line { stroke: #e5e7eb; }
.grid text { font-size: 10px; fill: #6b7280; }
.cursor { stroke: #111; stroke-width: 1; pointer-events: none; }
.empty { padding: 2rem; color: #6b7280; text-align: center; }
.tooltip {
  position: absolute; top: 6px; pointer-events: none; width: 190px;
  background: rgba(255, 255, 255, 0.95); border: 1px solid #e5e7eb; border-radius: 6px;
  padding: 4px 8px; font-size: 12px; box-shadow: 0 2px 6px rgb(0 0 0 / 0.1);
}
.row { display: flex; align-items: center; gap: 6px; }
.name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
</style>
