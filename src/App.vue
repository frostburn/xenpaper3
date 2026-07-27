<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { createPatch, type RuntimeOptions } from '../sw-patch'
import DEFAULT_PATCH from './patches/default.swpatch?raw'

type NoteOff = (stop?: number) => number
interface Synth {
  on: (
    destination: AudioNode,
    start: number,
    pitch: AudioNode,
    velocity: number,
    attack?: number,
    decay?: number,
    sustain?: number,
    release?: number,
  ) => NoteOff
}

// Dummy audio code just to get something going
const ctx = new AudioContext({ latencyHint: 'interactive' })
const inputDelay = 0.01

const synth = createPatch(DEFAULT_PATCH, ctx, {
  config: { oscillatorType: 'square' },
} as RuntimeOptions) as unknown as Synth

type ActiveNote = [off: NoteOff, pitch: ConstantSourceNode]

const noteOffs = new Map<number, ActiveNote>()

const releaseNote = (keyCode: number) => {
  const note = noteOffs.get(keyCode)
  if (note) {
    const [off, pitch] = note
    const cutTime = off(ctx.currentTime + inputDelay)
    pitch.stop(cutTime)
    noteOffs.delete(keyCode)
  }
}

const releaseAllNotes = () => {
  for (const keyCode of noteOffs.keys()) releaseNote(keyCode)
}

const handleKeyDown = (e: KeyboardEvent) => {
  console.log('down', e.keyCode)
  if (noteOffs.has(e.keyCode)) {
    console.log('nope')
    return
  }

  if (ctx.state === 'suspended') void ctx.resume()

  const pitch = new ConstantSourceNode(ctx, { offset: (1200 * (e.keyCode % 10)) / 10 })
  const velocity = 0.2
  const attack = 0.02
  pitch.start()
  const off = synth.on(ctx.destination, ctx.currentTime + inputDelay, pitch, velocity, attack)
  noteOffs.set(e.keyCode, [off, pitch])
}

const handleKeyUp = (e: KeyboardEvent) => {
  console.log('up', e.keyCode)
  releaseNote(e.keyCode)
}

const handleVisibilityChange = () => {
  if (document.visibilityState === 'hidden') releaseAllNotes()
}

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown)
  window.addEventListener('keyup', handleKeyUp)
  window.addEventListener('blur', releaseAllNotes)
  document.addEventListener('visibilitychange', handleVisibilityChange)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown)
  window.removeEventListener('keyup', handleKeyUp)
  window.removeEventListener('blur', releaseAllNotes)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  releaseAllNotes()
  void ctx.close()
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
