<script setup lang="ts">
import type { InstrumentLane } from '../../daw/project'

defineProps<{ lane: InstrumentLane }>()
</script>

<template>
  <header class="instrument-header">
    <strong>{{ lane.name }}</strong>
    <span>{{ lane.patchSource }} SW Patch · {{ lane.oscillatorType }}</span>
  </header>
</template>

<style scoped>
.instrument-header {
  display: flex;
  justify-content: space-between;
  padding: 0.6rem;
  background: #283143;
}
</style>
