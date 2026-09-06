<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { parseStrudelSampleMap } from '../../../sw-seq'
import {
  compileSourceInitialization,
  drumSamplesForLane,
  parseDrumClipNotes,
} from '../../daw/score'
import type { SourceRange } from '../../daw/score'
import {
  beatToNumber,
  type ClipDisplayMode,
  type InstrumentLane,
  type SourceClip,
} from '../../daw/project'
import InstrumentLaneComponent from './InstrumentLane.vue'

const props = defineProps<{
  lane: InstrumentLane
  globalSource?: string
  selectedClipId?: string
  pixelsPerBeat: number
  scrollLeft: number
  displayMode: ClipDisplayMode
  collapsed?: boolean
  playingRangesByClip?: Readonly<Record<string, readonly SourceRange[]>>
}>()
const emit = defineEmits<{
  insert: [beat: number]
  select: [clip: SourceClip]
  'place-playhead': [beat: number]
  move: [clip: SourceClip, beat: number]
  delete: [clip: SourceClip]
  'update-source': [source: string]
  'update-patch-source': [source: string]
  'update-name': [name: string]
  'update-gain': [gain: number]
  deleteLane: []
  'toggle-collapse': []
}>()

const drumkitDraft = ref(props.lane.patchSource)
const drumkitUrl = ref('')
const drumkitError = ref('')
const loadingDrumkit = ref(false)

watch(
  () => props.lane.patchSource,
  (source) => {
    if (source !== drumkitDraft.value) drumkitDraft.value = source
  },
)

const commitDrumkitSource = (source: string): boolean => {
  try {
    drumSamplesForLane({ ...props.lane, patchSource: source })
    drumkitError.value = ''
    emit('update-patch-source', source)
    return true
  } catch (error) {
    drumkitError.value = error instanceof Error ? error.message : String(error)
    return false
  }
}

const editDrumkitSource = (source: string) => {
  drumkitDraft.value = source
  commitDrumkitSource(source)
}

const importDrumkitJson = (source: string, manifestUrl?: string) => {
  const manifest = parseStrudelSampleMap(JSON.parse(source))
  const normalized = manifestUrl
    ? {
        ...manifest,
        _base: new URL(manifest._base ?? '.', manifestUrl).href,
      }
    : manifest
  const serialized = JSON.stringify(normalized, null, 2)
  drumkitDraft.value = serialized
  commitDrumkitSource(serialized)
}

const loadDrumkitUrl = async () => {
  loadingDrumkit.value = true
  drumkitError.value = ''
  try {
    const url = new URL(drumkitUrl.value, globalThis.location.href)
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Unable to load drumkit: HTTP ${response.status}`)
    importDrumkitJson(await response.text(), url.href)
  } catch (error) {
    drumkitError.value = error instanceof Error ? error.message : String(error)
  } finally {
    loadingDrumkit.value = false
  }
}

const uploadDrumkit = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    importDrumkitJson(await file.text())
  } catch (error) {
    drumkitError.value = error instanceof Error ? error.message : String(error)
  } finally {
    input.value = ''
  }
}

// Rows run top-to-bottom, so reverse alphabetical order puts alphabetical
// progression from the bottom of the roll upwards.
const samples = computed(() =>
  [...drumSamplesForLane(props.lane)].sort((left, right) => right.localeCompare(left)),
)
const eventsByClip = computed(() => {
  let initialization
  try {
    const globalInitialization = compileSourceInitialization(props.globalSource ?? '')
    initialization = compileSourceInitialization(props.lane.source, globalInitialization)
  } catch {
    initialization = undefined
  }
  return Object.fromEntries(
    props.lane.clips.map((clip) => {
      try {
        if (!initialization) throw new Error('Invalid initialization source')
        return [
          clip.id,
          parseDrumClipNotes(clip.source, samples.value, beatToNumber(clip.length), initialization),
        ]
      } catch {
        return [clip.id, []]
      }
    }),
  )
})
</script>

<template>
  <InstrumentLaneComponent
    class="drum-lane"
    :lane="lane"
    :selected-clip-id="selectedClipId"
    :pixels-per-beat="pixelsPerBeat"
    :scroll-left="scrollLeft"
    :display-mode="displayMode"
    :collapsed="collapsed"
    :playing-ranges-by-clip="playingRangesByClip"
    lane-label="Drum lane"
    timeline-label="Drum lane"
    editor-label="Drum lane source"
    :drum-samples="samples"
    @insert="emit('insert', $event)"
    @select="emit('select', $event)"
    @place-playhead="emit('place-playhead', $event)"
    @move="(clip, beat) => emit('move', clip, beat)"
    @delete="emit('delete', $event)"
    @update-source="emit('update-source', $event)"
    @update-name="emit('update-name', $event)"
    @update-gain="emit('update-gain', $event)"
    @delete-lane="emit('deleteLane')"
    @toggle-collapse="emit('toggle-collapse')"
  >
    <template #settings>
      <span class="drum-description">{{ samples.join(' · ') }}</span>
      <label class="drumkit-source">
        Drumkit (SW Patch or Strudel JSON)
        <textarea
          aria-label="Drumkit source"
          rows="3"
          :value="drumkitDraft"
          @input="editDrumkitSource(($event.target as HTMLTextAreaElement).value)"
        />
        <span class="drumkit-import">
          <input
            v-model="drumkitUrl"
            aria-label="Drumkit JSON URL"
            type="url"
            placeholder="https://…/strudel.json"
          />
          <button type="button" :disabled="loadingDrumkit || !drumkitUrl" @click="loadDrumkitUrl">
            {{ loadingDrumkit ? 'Loading…' : 'Load URL' }}
          </button>
          <label class="drumkit-upload">
            Upload JSON
            <input
              aria-label="Upload drumkit JSON"
              type="file"
              accept="application/json,.json"
              @change="uploadDrumkit"
            />
          </label>
        </span>
        <span v-if="drumkitError" class="drumkit-error" role="alert">{{ drumkitError }}</span>
      </label>
    </template>
    <template #preview="{ clip }">
      <span class="drum-preview" aria-label="Drum pattern preview">
        <span
          v-for="sample in samples"
          :key="sample"
          class="drum-row-label"
          :style="{ height: `${100 / samples.length}%` }"
          >{{ sample }}</span
        >
        <i
          v-for="(event, index) in eventsByClip[clip.id]"
          :key="`${event.sample}-${event.beat}-${index}`"
          :data-sample="event.sample"
          :data-beat="event.beat"
          :style="{
            left: `${(event.beat / beatToNumber(clip.length)) * 100}%`,
            width: `${Math.max(2, (event.duration / beatToNumber(clip.length)) * 100)}%`,
            height: `${60 / samples.length}%`,
            top: `${(samples.indexOf(event.sample ?? '') * 100 + 20) / samples.length}%`,
          }"
        />
      </span>
    </template>
  </InstrumentLaneComponent>
</template>

<style scoped>
.drum-description {
  flex: 1;
  color: var(--xenpaper-lavender);
}
.drumkit-source {
  display: grid;
  gap: 0.25rem;
  flex: 1 1 24rem;
}
.drumkit-source textarea {
  min-width: 20rem;
  color: inherit;
  background: var(--xenpaper-bg-control);
}
.drumkit-import {
  display: flex;
  gap: 0.4rem;
}
.drumkit-import input[type='url'] {
  flex: 1;
  min-width: 12rem;
}
.drumkit-upload {
  cursor: pointer;
}
.drumkit-upload input {
  position: absolute;
  width: 1px;
  height: 1px;
  clip-path: inset(50%);
}
.drumkit-error {
  color: var(--xenpaper-light-red);
}
.drum-preview {
  position: absolute;
  inset: 0;
}
.drum-row-label {
  position: relative;
  display: block;
  z-index: 2;
  padding-left: 0.25rem;
  text-align: left;
  color: white;
  font-weight: 700;
  text-shadow:
    -1px -1px 0 var(--xenpaper-purple),
    1px -1px 0 var(--xenpaper-purple),
    -1px 1px 0 var(--xenpaper-purple),
    1px 1px 0 var(--xenpaper-purple);
  border-bottom: 1px solid var(--xenpaper-purple);
  pointer-events: none;
}
.drum-preview i {
  position: absolute;
  z-index: 1;
  border-radius: 0.2rem;
  background: var(--xenpaper-lavender);
}
</style>
