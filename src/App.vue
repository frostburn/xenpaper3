<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { createPatch, registerMathWorklets, type RuntimeOptions } from '../sw-patch'
import BASS_PATCH from './patches/adr-bass.swpatch?raw'
import DEFAULT_PATCH from './patches/default.swpatch?raw'
import PING_PONG_DELAY_PATCH from './patches/ping-pong-delay.swpatch?raw'
import PTOLEMY_PATCH from './patches/ptolemy.swpatch?raw'
import SOFTSAW_PATCH from './patches/softsaw.swpatch?raw'
import SOFT_NATIVE_PATCH from './patches/soft-native.swpatch?raw'

type NoteOff = (end: number) => number
interface Synth {
  on: (...args: unknown[]) => NoteOff
  dispose: () => void
}

type SynthPatch = 'default' | 'bass' | 'ptolemy' | 'softsaw' | 'soft'
type OscillatorType = 'sine' | 'triangle' | 'sawtooth' | 'square' | 'parabolic'

const standardOscillatorTypes = ['sine', 'square', 'sawtooth', 'triangle'] as const
const softOscillatorTypes = ['triangle', 'sawtooth', 'square', 'parabolic'] as const

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
let synth: Synth | undefined
let activeSynthPatch: SynthPatch
const synthPatchModel = ref<SynthPatch>('bass')
const oscillatorTypeModel = ref<OscillatorType>('sawtooth')
const oscillatorTypeOptions = computed<readonly OscillatorType[]>(() =>
  synthPatchModel.value === 'soft' ? softOscillatorTypes : standardOscillatorTypes,
)
const retiredSynths = new Map<Synth, ReturnType<typeof setTimeout>>()

watch(synthPatchModel, () => {
  if (!oscillatorTypeOptions.value.includes(oscillatorTypeModel.value)) {
    oscillatorTypeModel.value = oscillatorTypeOptions.value[0]!
  }
})

const synthPatches: Record<SynthPatch, string> = {
  bass: BASS_PATCH,
  default: DEFAULT_PATCH,
  ptolemy: PTOLEMY_PATCH,
  softsaw: SOFTSAW_PATCH,
  soft: SOFT_NATIVE_PATCH,
}

const createSynth = (patch: SynthPatch, oscillatorType: OscillatorType) =>
  createPatch(synthPatches[patch], ctx, {
    config: { oscillatorType },
  } as RuntimeOptions) as unknown as Synth

const retireSynth = (oldSynth: Synth, after: number) => {
  const delayMilliseconds = Math.max(0, (after - ctx.currentTime) * 1000)
  if (delayMilliseconds === 0) {
    oldSynth.dispose()
    return
  }
  const timer = setTimeout(() => {
    retiredSynths.delete(oldSynth)
    oldSynth.dispose()
  }, delayMilliseconds)
  retiredSynths.set(oldSynth, timer)
}

const selectSynth = (patch: SynthPatch, oscillatorType: OscillatorType) => {
  const oldSynth = synth
  const notesEnd = oldSynth ? releaseAllNotes() : ctx.currentTime
  synth = createSynth(patch, oscillatorType)
  activeSynthPatch = patch
  if (oldSynth) retireSynth(oldSynth, notesEnd)
}

// A patch may instantiate a math worklet while its top-level connections are
// evaluated. Do not evaluate either patch until the worklet module is loaded.
const patchesReady = registerMathWorklets(ctx).then(() => {
  if (!mounted) return false
  delay = createPatch(PING_PONG_DELAY_PATCH, ctx, {
    config: { delayTime, feedback, wet },
  }) as unknown as AudioNode
  delay.connect(output)
  selectSynth(synthPatchModel.value, oscillatorTypeModel.value)
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
const releaseNote = (keyCode: number): number => {
  pendingNotes.delete(keyCode)
  const note = noteOffs.get(keyCode)
  if (note) {
    const [off, pitch] = note
    // Remove the note before running patch code so re-entrant release events
    // cannot call a patch's `once fn off` more than once.
    noteOffs.delete(keyCode)
    const cutTime = off(ctx.currentTime + inputDelay)
    pitch.stop(cutTime)
    return cutTime
  }
  return ctx.currentTime
}

const releaseAllNotes = () => {
  pendingNotes.clear()
  let notesEnd = ctx.currentTime
  for (const keyCode of noteOffs.keys()) notesEnd = Math.max(notesEnd, releaseNote(keyCode))
  return notesEnd
}

watch([synthPatchModel, oscillatorTypeModel], async ([patch, oscillatorType]) => {
  const ready = await patchesReady
  if (
    !ready ||
    !mounted ||
    patch !== synthPatchModel.value ||
    oscillatorType !== oscillatorTypeModel.value
  )
    return
  selectSynth(patch, oscillatorType)
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
      activeSynthPatch !== 'bass'
        ? synth!.on(...commonArgs, 0.7, 0.1)
        : synth!.on(...commonArgs, 0.1, Q)
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
  synth?.dispose()
  for (const [retiredSynth, timer] of retiredSynths) {
    clearTimeout(timer)
    retiredSynth.dispose()
  }
  retiredSynths.clear()
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
    <option value="ptolemy">Ptolemy</option>
    <option value="softsaw">Softsaw</option>
    <option value="soft">Native Soft</option>
  </select>
  <label for="oscillator-type">Oscillator type</label>
  <select id="oscillator-type" v-model="oscillatorTypeModel">
    <option v-for="type in oscillatorTypeOptions" :key="type" :value="type">
      {{ type.charAt(0).toUpperCase() + type.slice(1) }}
    </option>
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
