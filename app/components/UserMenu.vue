<script setup lang="ts">
const { state, logout } = useAtlas()
const open = ref(false)
const root = ref<HTMLElement>()
const name = computed(() => [state.user?.firstname, state.user?.lastname].filter(Boolean).join(' ') || 'Mi cuenta')

// se cierra al pulsar fuera o con Escape
const onClick = (e: MouseEvent) => { if (!root.value?.contains(e.target as Node)) open.value = false }
const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') open.value = false }
onMounted(() => {
  document.addEventListener('click', onClick)
  document.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onClick)
  document.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div ref="root" class="user-menu">
    <button class="trigger" :aria-expanded="open" @click="open = !open">
      <img v-if="state.user?.avatar" :src="state.user.avatar" alt="">
      <span class="name">{{ name }}</span>
      <span class="caret">▾</span>
    </button>
    <div v-if="open" class="menu" role="menu">
      <a :href="`https://www.strava.com/athletes/${state.user?.id}`" target="_blank" rel="noopener" role="menuitem" @click="open = false">
        Ver perfil en Strava ↗
      </a>
      <button role="menuitem" @click="logout">Cerrar sesión</button>
    </div>
  </div>
</template>

<style scoped>
.user-menu { position: relative; border-bottom: 1px solid #f1f1f1; }
.trigger {
  display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 12px;
  border: 0; background: none; cursor: pointer; font-size: 13px; color: #374151; text-align: left;
}
.trigger:hover, .trigger[aria-expanded="true"] { background: #f8f8f8; }
.trigger img { width: 22px; height: 22px; border-radius: 50%; }
.name { flex: 1; }
.caret { color: #9ca3af; font-size: 11px; }
.menu {
  position: absolute; top: calc(100% + 2px); left: 8px; z-index: 20; min-width: 200px;
  background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; box-shadow: 0 6px 20px rgb(0 0 0 / 0.12);
  padding: 4px; display: flex; flex-direction: column;
}
.menu a, .menu button {
  padding: 7px 10px; border: 0; background: none; border-radius: 6px; cursor: pointer;
  font-size: 13px; color: #111; text-decoration: none; text-align: left;
}
.menu a:hover, .menu button:hover { background: #f3f4f6; }
.menu button { color: #b91c1c; }
</style>
