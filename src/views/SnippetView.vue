<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { createDefaultSnippet, decodeSnippet, encodeSnippet, compileSnippet } from '../snippet'
import { DawAudioEngine } from '../daw/audio-engine'
import { createDefaultProject, type PitchedInstrumentLane } from '../daw/project'
import XenpaperSourceEditor from '../components/daw/XenpaperSourceEditor.vue'
import InstrumentSettings from '../components/daw/InstrumentSettings.vue'
import TransportControls from '../components/daw/TransportControls.vue'
import PianoRoll from '../components/PianoRoll.vue'

const route = useRoute()
const router = useRouter()
const snippet = ref(createDefaultSnippet())
const urlError = ref('')
const audioError = ref('')
const copyStatus = ref('')
const playing = ref(false)
const pending = ref(false)
const playhead = ref(0)
const shareFormat = ref<'url' | 'wiki' | 'discord'>('url')
const shareField = ref<HTMLInputElement>()
let engine: DawAudioEngine | undefined
let timer: ReturnType<typeof setInterval> | undefined
let playRequest = 0

const clearTimer = () => {
  clearInterval(timer)
  timer = undefined
}
const stop = (reset = true) => {
  playRequest++
  engine?.stop()
  clearTimer()
  playing.value = false
  pending.value = false
  if (reset) playhead.value = 0
}

watch(
  () => route.hash,
  (hash) => {
    if (hash === encodeSnippet(snippet.value)) {
      urlError.value = ''
      return
    }
    stop()
    try {
      snippet.value = decodeSnippet(hash)
      urlError.value = ''
    } catch (error) {
      urlError.value = error instanceof Error ? error.message : String(error)
    }
  },
  { immediate: true },
)

const encoded = computed(() => encodeSnippet(snippet.value))
watch(encoded, (hash) => {
  stop()
  urlError.value = ''
  copyStatus.value = ''
  if (route.hash !== hash)
    void router.replace({ path: route.path, hash }).catch((error) => {
      urlError.value = error instanceof Error ? error.message : String(error)
    })
})

const compiled = computed(() => {
  try {
    return { result: compileSnippet(snippet.value), error: '' }
  } catch (error) {
    return { result: undefined, error: error instanceof Error ? error.message : String(error) }
  }
})
const settingsLane = computed<PitchedInstrumentLane>(() => ({
  ...(createDefaultProject().instrumentLanes[0]! as PitchedInstrumentLane),
  ...snippet.value.lane,
}))
const shareUrl = computed(() => {
  const resolved = router.resolve({ path: '/snippet', hash: encoded.value })
  return new URL(resolved.href, window.location.href).href
})
const shareText = computed(() =>
  shareFormat.value === 'wiki'
    ? `[${shareUrl.value} Xenpaper snippet]`
    : shareFormat.value === 'discord'
      ? `<${shareUrl.value}>`
      : shareUrl.value,
)
watch(shareFormat, () => {
  copyStatus.value = ''
})

const copy = async () => {
  try {
    await navigator.clipboard.writeText(shareText.value)
    copyStatus.value = 'Copied!'
  } catch {
    shareField.value?.focus()
    shareField.value?.select()
    copyStatus.value = 'Select and copy the link with Ctrl/⌘ C.'
  }
}
const play = async () => {
  if (playing.value) {
    stop(false)
    return
  }
  const result = compiled.value.result
  if (!result || pending.value) return
  const request = ++playRequest
  pending.value = true
  audioError.value = ''
  try {
    engine ??= new DawAudioEngine()
    engine.addEventListener('ended', ended)
    if (engine.context.state === 'suspended') await engine.context.resume()
    if (request !== playRequest) return
    await engine.play(result.project, playhead.value, { allowClipTempoDirective: true })
    if (request !== playRequest) return
    playing.value = true
    timer = setInterval(() => {
      playhead.value = engine?.positionBeats ?? 0
    }, 25)
  } catch (error) {
    if (request === playRequest)
      audioError.value = error instanceof Error ? error.message : String(error)
  } finally {
    if (request === playRequest) pending.value = false
  }
}
function ended() {
  stop()
}
onBeforeUnmount(() => {
  stop()
  engine?.removeEventListener('ended', ended)
  engine?.dispose()
})
</script>

<template>
  <div class="snippet">
    <header class="snippet-header">
      <h1>Xenpaper snippet</h1>
      <RouterLink to="/daw">Open the DAW</RouterLink>
    </header>
    <p class="intro">One clip. A whole musical idea. Edit, listen, and share it as a link.</p>
    <p v-if="urlError" role="alert" class="error">
      {{ urlError }} Edit the snippet to create a new link.
    </p>
    <div class="toolbar">
      <TransportControls :playing="playing" :playhead="playhead" @play="play" @stop="stop()" />
      <span v-if="pending" role="status">Preparing audio…</span>
      <span v-else-if="compiled.result" class="duration"
        >{{ compiled.result.score.duration.toFraction() }} beats</span
      >
    </div>
    <p v-if="audioError" role="alert" class="error">{{ audioError }}</p>
    <div class="workspace">
      <section aria-label="Clip editor" class="clip-editor">
        <h2>Clip source</h2>
        <XenpaperSourceEditor
          editor-label="Xenpaper snippet source"
          :source="snippet.source"
          :rows="16"
          :diagnostics="compiled.result?.diagnostics"
          @update:source="snippet.source = $event"
        />
        <p class="help">
          Tempo and time directives belong here: <code>@tempo(120bpm)</code>,
          <code>@time(4/4)</code>.
        </p>
        <p v-if="compiled.error" role="alert" class="error">{{ compiled.error }}</p>
      </section>
      <aside aria-label="Instrument lane configuration" class="lane-config">
        <h2>Instrument lane</h2>
        <InstrumentSettings
          :lane="settingsLane"
          @update-instrument="snippet.lane.instrument = $event"
        />
        <label class="gain"
          >Gain
          <input
            v-model.number="snippet.lane.gain"
            aria-label="Instrument gain"
            type="range"
            min="0"
            max="1"
            step="0.01"
          />
          <output>{{ Math.round(snippet.lane.gain * 100) }}%</output>
        </label>
        <label class="source-label">Lane source</label>
        <XenpaperSourceEditor
          editor-label="Instrument lane source"
          :source="snippet.lane.source"
          :rows="7"
          @update:source="snippet.lane.source = $event"
        />
        <p class="help">Tuning and sound defaults inherited by the clip.</p>
      </aside>
    </div>
    <section class="preview" aria-label="Snippet piano roll">
      <PianoRoll :score="compiled.result?.score" />
    </section>
    <section class="share" aria-label="Share snippet">
      <h2>Share snippet</h2>
      <p class="help">The clip and instrument settings are stored in the URL.</p>
      <div class="share-controls">
        <select v-model="shareFormat" aria-label="Share format">
          <option value="url">URL</option>
          <option value="wiki">MediaWiki</option>
          <option value="discord">Discord</option>
        </select>
        <input
          ref="shareField"
          :value="shareText"
          aria-label="Shareable snippet link"
          readonly
          @focus="shareField?.select()"
        />
        <button type="button" @click="copy">Copy link</button>
      </div>
      <p v-if="copyStatus" role="status" class="help">{{ copyStatus }}</p>
    </section>
  </div>
</template>

<style scoped>
.snippet {
  max-width: 80rem;
  margin: auto;
  padding: 1.5rem;
  color: var(--xenpaper-slate-100);
  font-size: 0.875rem;
}
.snippet-header,
.toolbar,
.gain,
.share-controls {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}
.snippet-header {
  justify-content: space-between;
}
h1 {
  margin: 0;
  font-size: 1.6rem;
}
h2 {
  margin: 0 0 1rem;
  font-size: 1.15rem;
}
.intro,
.help,
.duration {
  color: var(--xenpaper-slate-400);
}
.intro {
  margin: 0.5rem 0 1.5rem;
}
.toolbar {
  border-block: 1px solid var(--xenpaper-slate-500);
  padding: 0.75rem 0;
}
.duration {
  margin-left: auto;
}
.workspace {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  gap: 1.5rem;
  margin-top: 1.5rem;
}
.clip-editor,
.lane-config {
  min-width: 0;
}
.lane-config {
  padding-left: 1.5rem;
  border-left: 1px solid var(--xenpaper-slate-500);
}
.gain {
  margin: 1rem 0;
}
.gain input {
  flex: 1;
  min-width: 5rem;
}
.gain output {
  min-width: 3rem;
}
.source-label {
  display: block;
  margin-bottom: 0.5rem;
}
.help {
  font-size: 0.75rem;
  line-height: 1.6;
}
.error {
  color: var(--xenpaper-light-red);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.preview {
  margin: 1.5rem 0;
  min-width: 0;
  overflow-x: auto;
}
.share {
  padding-block: 1rem;
  border-top: 1px solid var(--xenpaper-slate-500);
}
.share h2 {
  margin-bottom: 0.25rem;
}
.share-controls input {
  flex: 1;
  min-width: 8rem;
}
.snippet :deep(button:not(.line-caret)),
.snippet :deep(select),
.snippet :deep(input:not([type='range']):not([type='radio']):not([type='file'])) {
  min-height: 2rem;
  border: 1px solid var(--xenpaper-slate-500);
  border-radius: 0.3rem;
  padding: 0.35rem 0.55rem;
  color: inherit;
  background: var(--xenpaper-slate-850);
  font: inherit;
}
.snippet :deep(button) {
  cursor: pointer;
}
.snippet :deep(input[type='range']),
.snippet :deep(input[type='radio']) {
  accent-color: var(--xenpaper-cyan);
}
.snippet :deep(.instrument-kind) {
  flex-wrap: wrap;
}
.snippet :deep(.instrument-import) {
  flex-wrap: wrap;
}
.snippet :deep(.instrument-import input[type='url']) {
  min-width: 0;
  width: 100%;
}
.snippet :deep(.instrument-source label) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-top: 0.4rem;
}
.snippet :deep(.instrument-source select) {
  min-width: 0;
  max-width: 70%;
}
@media (max-width: 760px) {
  .snippet {
    padding: 1rem;
  }
  .workspace {
    grid-template-columns: minmax(0, 1fr);
  }
  .lane-config {
    padding: 1rem 0 0;
    border-left: 0;
    border-top: 1px solid var(--xenpaper-slate-500);
  }
  .duration {
    margin-left: 0;
  }
  .share-controls input {
    flex-basis: 100%;
    order: 3;
  }
}
</style>
