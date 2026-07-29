<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { createPatch, type RuntimeOptions } from '../sw-patch'
import BASS_PATCH from './patches/adr-bass.swpatch?raw'
import PING_PONG_DELAY_PATCH from './patches/ping-pong-delay.swpatch?raw'

type NoteOff = (end: number) => number
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
const output = new GainNode(ctx, { gain: 0.4 })
output.connect(ctx.destination)
const wet = new ConstantSourceNode(ctx, { offset: 0.4 })
wet.start()
const delay = createPatch(PING_PONG_DELAY_PATCH, ctx, { config: { wet } }) as unknown as AudioNode
delay.connect(output)
const inputDelay = 0.01

const synth = createPatch(BASS_PATCH, ctx, {
  config: { oscillatorType: 'sawtooth' },
} as RuntimeOptions) as unknown as Synth

// A string because <input type="range"> has a silly API.
const wetModel = ref('0.4')

watch(
  wetModel,
  (value) => {
    wet.offset.setTargetAtTime(Number(value), ctx.currentTime + inputDelay, 0.01)
  },
  { immediate: true },
)

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
  if (noteOffs.has(e.keyCode)) return

  if (ctx.state === 'suspended') void ctx.resume()

  const pitch = new ConstantSourceNode(ctx, { offset: (1200 * (e.keyCode % 23)) / 11 - 1200 * 3 })
  const velocity = 0.8
  pitch.start()
  const off = synth.on(delay, ctx.currentTime + inputDelay, pitch, velocity)
  noteOffs.set(e.keyCode, [off, pitch])
}

const handleKeyUp = (e: KeyboardEvent) => {
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
  <label for="wet">Wet level</label>
  <input type="range" v-model="wetModel" min="0" max="1" step="any" />
</template>

<style scoped></style>
