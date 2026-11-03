<script setup lang="ts">
const location = window.location
defineProps<{ stravaConfigured: boolean }>()
const error = new URLSearchParams(location.search).get('login')
if (error) history.replaceState(null, '', location.pathname)
</script>

<template>
  <div class="login">
    <div class="card">
      <h1>Track Atlas</h1>
      <p>Explora tus rutas de Strava: superponlas, compáralas, descubre por dónde ya has pasado y crea tu propio heatmap.</p>
      <a v-if="stravaConfigured" class="strava" href="/api/auth/login">Entrar con Strava</a>
      <div v-else class="setup">
        <strong>Falta configurar la API de Strava.</strong>
        <ol>
          <li>Crea una app en <a href="https://www.strava.com/settings/api" target="_blank" rel="noopener">strava.com/settings/api</a>
            con <em>Authorization Callback Domain</em> = <code>{{ location.hostname }}</code>.</li>
          <li>Define <code>STRAVA_CLIENT_ID</code> y <code>STRAVA_CLIENT_SECRET</code> (fichero <code>.env</code>) y reinicia.</li>
        </ol>
      </div>
      <p v-if="error" class="error">No se pudo iniciar sesión ({{ error }}).</p>
      <p class="small">Cada usuario solo ve sus propias actividades.</p>
    </div>
  </div>
</template>

<style scoped>
.login { height: 100vh; display: grid; place-items: center; background: linear-gradient(135deg, #fff1ea, #f3f4f6); }
.card { background: #fff; padding: 32px 36px; border-radius: 14px; box-shadow: 0 8px 30px rgb(0 0 0 / 0.08); width: min(440px, 92vw); text-align: center; }
h1 { margin: 0 0 8px; color: #fc4c02; }
p { color: #374151; line-height: 1.5; }
.strava {
  display: inline-block; margin: 12px 0; padding: 10px 22px; border-radius: 6px; background: #fc4c02;
  color: #fff; font-weight: 600; text-decoration: none;
}
.strava:hover { background: #e34402; }
.setup { text-align: left; font-size: 14px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 10px 14px; }
.setup ol { padding-left: 18px; margin: 6px 0 0; }
.error { color: #dc2626; }
.small { font-size: 12px; color: #6b7280; }
</style>
