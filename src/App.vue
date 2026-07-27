<script setup lang="ts">
import {createPatch} from '../sw-patch'
import DEFAULT_PATCH from './patches/default.swpatch?raw'

// Dummy audio code just to get something going
const ctx = new AudioContext({latencyHint: 'interactive'})
const inputDelay = 0.01

const synth = createPatch(DEFAULT_PATCH, ctx, {oscillatorType: 'square'})

const noteOffs = new Map()

window.addEventListener('keydown', (e) => {
  console.log('down', e.keyCode)
  if (noteOffs.has(e.keyCode)) {
    console.log('nope')
    return
  }
  const pitch = new ConstantSourceNode(ctx, {offset: 1200 * (e.keyCode % 10) / 10})
  const velocity = 0.2
  const attack = 0.05
  pitch.start()
  const off = synth.on(ctx.destination, ctx.currentTime + inputDelay, pitch, velocity, attack)
  noteOffs.set(e.keyCode, [off, pitch])
})

window.addEventListener('keyup', (e) => {
  console.log('up', e.keyCode)
  if (noteOffs.has(e.keyCode)) {
    const [off, pitch] = noteOffs.get(e.keyCode)
    const cutTime = off(ctx.currentTime + inputDelay)
    pitch.stop(cutTime)
  }
  noteOffs.delete(e.keyCode)
})

</script>

<template>
  <h1>You did it!</h1>
  <p>
    Visit <a href="https://vuejs.org/" target="_blank" rel="noopener">vuejs.org</a> to read the
    documentation
  </p>
</template>

<style scoped></style>
