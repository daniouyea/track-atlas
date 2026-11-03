export default defineNuxtConfig({
  compatibilityDate: '2026-11-01',
  ssr: false,
  devtools: { enabled: false },
  nitro: {
    // módulo nativo de Node 24, no hay que empaquetarlo
    rollupConfig: { external: ['node:sqlite'] },
  },
  css: ['maplibre-gl/dist/maplibre-gl.css', '~/assets/main.css'],
  app: {
    head: {
      title: 'Track Atlas',
      htmlAttrs: { lang: 'es' },
      meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
    },
  },
  vite: {
    // en Docker sobre bind mount los eventos de fichero no siempre llegan
    server: { watch: { usePolling: true, interval: 300 } },
  },
})
