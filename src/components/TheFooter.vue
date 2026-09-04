<script setup lang="ts">
import { version } from '../../package.json'
</script>
<template>
  <footer>
    Xenpaper {{ version }} is the fault of Lumi Pakkanen. Built with Vue 3, Vite, TypeScript and
    Peggy. Inspired by Xenpaper 1 by Damien Clarke.
  </footer>
</template>
<style scoped>
footer {
  color: var(--xenpaper-ink);
}
</style>
