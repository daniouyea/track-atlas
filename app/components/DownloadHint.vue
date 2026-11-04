<script setup lang="ts">
// Tras descargar el GPX de Strava: indica que se arrastre desde la burbuja de descargas
// del navegador (arriba a la derecha) hasta el mapa.
const { state } = useAtlas()
</script>

<template>
  <div class="download-hint">
    <svg class="arrow" viewBox="0 0 64 64" width="56" height="56" aria-hidden="true">
      <path d="M10 54 C 22 30, 34 20, 52 12" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" />
      <path d="M36 8 L 56 10 L 50 29" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
    <div class="card">
      <button class="close" title="Cerrar" @click="state.downloadHint = false">✕</button>
      <strong>Arrastra el GPX hasta el mapa</strong>
      <ol>
        <li>Abre las descargas del navegador, arriba a la derecha.</li>
        <li>Arrastra el fichero <code>.gpx</code> y suéltalo encima del mapa.</li>
      </ol>
      <p class="small">¿No se ha descargado? Puede que tengas que iniciar sesión en Strava en la pestaña que se ha abierto.</p>
    </div>
  </div>
</template>

<style scoped>
.download-hint { position: fixed; top: 4px; right: 4px; z-index: 30; display: flex; flex-direction: column; align-items: flex-end; pointer-events: none; }
.arrow { color: #c026d3; animation: nudge 1s ease-in-out infinite; filter: drop-shadow(0 2px 3px rgb(0 0 0 / 0.3)); }
@keyframes nudge { 50% { transform: translate(6px, -6px); } }
.card {
  /* a la izquierda de los controles de zoom del mapa */
  pointer-events: auto; position: relative; width: 300px; margin: -6px 52px 0 0; padding: 12px 14px;
  background: #fff; border: 2px solid #c026d3; border-radius: 10px; box-shadow: 0 8px 24px rgb(0 0 0 / 0.18); font-size: 13px;
}
.card ol { margin: 6px 0; padding-left: 18px; line-height: 1.5; }
.small { margin: 0; color: #6b7280; font-size: 12px; }
.close { position: absolute; top: 6px; right: 6px; border: 0; background: none; cursor: pointer; color: #6b7280; }
</style>
