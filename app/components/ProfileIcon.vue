<script setup lang="ts">
import { Bike } from 'lucide-vue-next'
import { PROFILE_BADGES } from '~/utils/icons'

// Bici con una insignia que distingue la modalidad (MTB, carretera, gravel…)
const props = withDefaults(defineProps<{ profile: string, size?: number }>(), { size: 18 })
const badge = computed(() => PROFILE_BADGES[props.profile])
</script>

<template>
  <span class="profile-icon" :style="{ width: `${size + 4}px`, height: `${size + 2}px` }">
    <Bike :size="size" />
    <span v-if="badge" class="badge"><component :is="badge" :size="Math.round(size * 0.55)" :stroke-width="2.5" /></span>
  </span>
</template>

<style scoped>
.profile-icon { position: relative; display: inline-block; line-height: 0; }
.badge {
  position: absolute; right: -2px; bottom: -2px; display: grid; place-items: center; padding: 1px;
  background: var(--badge-bg, #fff); border-radius: 50%; line-height: 0;
}
</style>
