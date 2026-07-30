<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { createPatch, registerMathWorklets, type RuntimeOptions } from '../sw-patch'
import BASS_PATCH from './patches/adr-bass.swpatch?raw'
import DEFAULT_PATCH from './patches/default.swpatch?raw'
import PING_PONG_DELAY_PATCH from './patches/ping-pong-delay.swpatch?raw'

type NoteOff = (end: number) => number
interface Synth {
  on: (...args: unknown[]) => NoteOff
}

type SynthPatch = 'default' | 'bass'

// Dummy audio code just to get something going
const ctx = new AudioContext({ latencyHint: 'interactive' })
const output = new GainNode(ctx, { gain: 0.4 })
output.connect(ctx.destination)
const delayTime = new ConstantSourceNode(ctx, { offset: 0.25 })
const feedback = new ConstantSourceNode(ctx, { offset: 0.55 })
const wet = new ConstantSourceNode(ctx, { offset: 0.35 })
const Q = new ConstantSourceNode(ctx, { offset: 5 })
for (const signal of [delayTime, feedback, wet, Q]) signal.start()
const inputDelay = 0.01
let mounted = true
let delay: AudioNode
let synth: Synth
let activeSynthPatch: SynthPatch
const synthPatchModel = ref<SynthPatch>('bass')

const createSynth = (patch: SynthPatch) =>
  createPatch(patch === 'default' ? DEFAULT_PATCH : BASS_PATCH, ctx, {
    config: { oscillatorType: 'sawtooth' },
  } as RuntimeOptions) as unknown as Synth

const selectSynth = (patch: SynthPatch) => {
  synth = createSynth(patch)
  activeSynthPatch = patch
}

// A patch may instantiate a math worklet while its top-level connections are
// evaluated. Do not evaluate either patch until the worklet module is loaded.
const patchesReady = registerMathWorklets(ctx).then(() => {
  if (!mounted) return false
  delay = createPatch(PING_PONG_DELAY_PATCH, ctx, {
    config: { delayTime, feedback, wet },
  }) as unknown as AudioNode
  delay.connect(output)
  selectSynth(synthPatchModel.value)
  return true
})

// A string because <input type="range"> has a silly API.
const delayTimeModel = ref('0.25')
const feedbackModel = ref('0.55')
const wetModel = ref('0.35')
const qModel = ref('5')

const bindSignal = (model: typeof wetModel, signal: ConstantSourceNode) =>
  watch(
    model,
    (value) => signal.offset.setTargetAtTime(Number(value), ctx.currentTime + inputDelay, 0.01),
    { immediate: true },
  )

bindSignal(delayTimeModel, delayTime)
bindSignal(feedbackModel, feedback)
bindSignal(wetModel, wet)
bindSignal(qModel, Q)

type ActiveNote = [off: NoteOff, pitch: ConstantSourceNode]

const noteOffs = new Map<number, ActiveNote>()
const pendingNotes = new Set<number>()
const releaseNote = (keyCode: number) => {
  pendingNotes.delete(keyCode)
  const note = noteOffs.get(keyCode)
  if (note) {
    const [off, pitch] = note
    // Remove the note before running patch code so re-entrant release events
    // cannot call a patch's `once fn off` more than once.
    noteOffs.delete(keyCode)
    const cutTime = off(ctx.currentTime + inputDelay)
    pitch.stop(cutTime)
  }
}

const releaseAllNotes = () => {
  pendingNotes.clear()
  for (const keyCode of noteOffs.keys()) releaseNote(keyCode)
}

watch(synthPatchModel, async (patch) => {
  const ready = await patchesReady
  if (!ready || !mounted || patch !== synthPatchModel.value) return
  releaseAllNotes()
  selectSynth(patch)
})

const handleKeyDown = (e: KeyboardEvent) => {
  if (noteOffs.has(e.keyCode) || pendingNotes.has(e.keyCode)) return

  if (ctx.state === 'suspended') void ctx.resume()
  pendingNotes.add(e.keyCode)
  void patchesReady.then((ready) => {
    if (!ready || !mounted || !pendingNotes.delete(e.keyCode)) return
    const pitch = new ConstantSourceNode(ctx, {
      offset: (1200 * (e.keyCode % 23)) / 11 - 1200 * 3,
    })
    const velocity = 0.8
    pitch.start()
    const commonArgs = [delay, ctx.currentTime + inputDelay, pitch, velocity, 0.01, 0.5]
    // The stock patch takes sustain before release, while the bass patch takes
    // release and its filter Q signal. Keeping the calls distinct prevents an
    // AudioNode from being interpreted as the default patch's release duration.
    const off =
      activeSynthPatch === 'default'
        ? synth.on(...commonArgs, 0.7, 0.1)
        : synth.on(...commonArgs, 0.1, Q)
    noteOffs.set(e.keyCode, [off, pitch])
  })
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
  mounted = false
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
  <label for="synth-patch">Synth patch</label>
  <select id="synth-patch" v-model="synthPatchModel">
    <option value="default">Default</option>
    <option value="bass">Bass</option>
  </select>
  <label for="delay-time">Delay time</label>
  <input id="delay-time" type="range" v-model="delayTimeModel" min="0" max="2" step="any" />
  <label for="feedback">Feedback</label>
  <input id="feedback" type="range" v-model="feedbackModel" min="0" max="0.95" step="any" />
  <label for="wet">Wet level</label>
  <input id="wet" type="range" v-model="wetModel" min="0" max="1" step="any" />
  <label for="filter-q">Filter Q</label>
  <input id="filter-q" type="range" v-model="qModel" min="0" max="20" step="any" />
</template>

<style scoped></style>
