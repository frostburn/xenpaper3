<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
  watchEffect,
} from 'vue'
import { clamp, Fraction } from 'xen-dev-utils'
import ArrangementTimeline from '../components/daw/ArrangementTimeline.vue'
import { EditorHistory } from '../daw/editor-history'
import ClipSourceEditor from '../components/daw/ClipSourceEditor.vue'
import DrumLane from '../components/daw/DrumLane.vue'
import GlobalLane from '../components/daw/GlobalLane.vue'
import PitchedLane from '../components/daw/PitchedLane.vue'
import TransportControls from '../components/daw/TransportControls.vue'
import { DawAudioEngine, renderProjectToWavBlob } from '../daw/audio-engine'
import { demoProjects } from '../demo-projects'
import {
  clipSourceDiagnostics,
  compileSourceInitialization,
  drumSamplesForLane,
  parseClipNotes,
  parseDrumClipNotes,
  sourceClipLength,
  sourceLineCarets,
  type ScheduledLaneNote,
  type SourceRange,
} from '../daw/score'
import {
  beat,
  beatToNumber,
  createClip,
  createDefaultProject,
  createDrumLane,
  createInstrumentLane,
  parseDawProject,
  serializeDawProject,
  snapBeat,
  type DawProject,
  type ClipDisplayMode,
  type InstrumentLane,
  type SourceClip,
} from '../daw/project'

const project = ref(createDefaultProject())
const projectLoadError = ref('')
const selectedClipId = ref<string>()
const settingsLaneId = ref<string>()
const playhead = ref(0)
const pixelsPerBeat = ref(64)
const scrollLeft = ref(0)
const collapsedLaneIds = ref(new Set<string>())
const gridDenominator = ref(4)
const grid = computed(() => beat(1, gridDenominator.value))
const followPlayhead = ref(true)
const timeline = ref<InstanceType<typeof ArrangementTimeline>>()
const shortcutsOpen = ref(false)
const displayMode = ref<ClipDisplayMode>('piano-roll')
const playing = ref(false)
const soloClipKey = ref<string>()
const soloSelectedClip = ref(false)
const playbackError = ref('')
const renderTailSeconds = ref(2)
const rendering = ref(false)
const playbackPending = ref(false)
let playTimer: ReturnType<typeof setInterval> | undefined
let audioEngine: DawAudioEngine | undefined
let playbackRequestId = 0
const editor = ref<InstanceType<typeof ClipSourceEditor>>()
const workspace = ref<HTMLElement>()
const clipInspector = ref<HTMLElement>()
const laneSettingsInspector = ref<HTMLElement>()
const clipInspectorWidth = ref<number>()
let inspectorResizeStart: { x: number; width: number } | undefined
let workspaceResizeObserver: ResizeObserver | undefined
const compactInspector = ref(false)
const inspectorMinWidth = computed(() => (compactInspector.value ? 288 : 320))
const inspectorMaxWidth = ref(320)
const inspectorCurrentWidth = computed(() => clipInspectorWidth.value ?? inspectorMinWidth.value)
const arrangerMinWidth = 320
const inspectorDividerWidth = 8
const inspectorResizeStep = 24

const setClipInspectorWidth = (width: number) => {
  const workspaceWidth = workspace.value?.getBoundingClientRect().width ?? 0
  inspectorMaxWidth.value = Math.max(
    inspectorMinWidth.value,
    workspaceWidth - arrangerMinWidth - inspectorDividerWidth,
  )
  clipInspectorWidth.value = Math.round(
    clamp(inspectorMinWidth.value, inspectorMaxWidth.value, width),
  )
}

const measureClipInspector = () => {
  compactInspector.value = window.innerWidth <= 1000
  const renderedWidth = clipInspector.value?.getBoundingClientRect().width ?? 0
  setClipInspectorWidth(clipInspectorWidth.value ?? (renderedWidth || inspectorMinWidth.value))
}

const resizeClipInspector = (event: PointerEvent) => {
  if (!inspectorResizeStart) return
  setClipInspectorWidth(inspectorResizeStart.width + inspectorResizeStart.x - event.clientX)
}

const stopClipInspectorResize = () => {
  inspectorResizeStart = undefined
  window.removeEventListener('pointermove', resizeClipInspector)
  window.removeEventListener('pointerup', stopClipInspectorResize)
  window.removeEventListener('pointercancel', stopClipInspectorResize)
}

const startClipInspectorResize = (event: PointerEvent) => {
  if (event.button !== 0) return
  event.preventDefault()
  inspectorResizeStart = {
    x: event.clientX,
    width: clipInspector.value?.getBoundingClientRect().width ?? inspectorMinWidth.value,
  }
  window.addEventListener('pointermove', resizeClipInspector)
  window.addEventListener('pointerup', stopClipInspectorResize)
  window.addEventListener('pointercancel', stopClipInspectorResize)
}

const resizeClipInspectorWithKeyboard = (event: KeyboardEvent) => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  event.preventDefault()
  const width =
    clipInspectorWidth.value ??
    clipInspector.value?.getBoundingClientRect().width ??
    inspectorMinWidth.value
  setClipInspectorWidth(
    width + (event.key === 'ArrowLeft' ? inspectorResizeStep : -inspectorResizeStep),
  )
}
const selectedLaneId = ref<string>()
const selectedLane = computed(() =>
  project.value.instrumentLanes.find(({ id }) => id === selectedLaneId.value),
)
const selectedClip = computed(() =>
  selectedLane.value?.clips.find(({ id }) => id === selectedClipId.value),
)
const selectedClipDiagnostics = computed(() => {
  const lane = selectedLane.value
  const clip = selectedClip.value
  if (!lane || !clip) return []
  try {
    const global = compileSourceInitialization(project.value.globalTrack.source)
    const initialization = compileSourceInitialization(lane.source, global)
    return clipSourceDiagnostics(
      clip.source,
      drumSamplesForLane(lane),
      initialization,
      clip.start,
      project.value.globalTrack.timeSignatureChanges[0],
    )
  } catch {
    return []
  }
})
const clipNotes = computed(() => {
  const notes = new Map<string, readonly ScheduledLaneNote[]>()
  let global
  try {
    global = compileSourceInitialization(project.value.globalTrack.source)
  } catch {
    return notes
  }
  for (const lane of project.value.instrumentLanes) {
    let initialization
    try {
      initialization = compileSourceInitialization(lane.source, global)
    } catch {
      continue
    }
    const samples = drumSamplesForLane(lane)
    for (const clip of lane.clips) {
      try {
        notes.set(
          clipSourceKey(lane.id, clip.id),
          samples.length
            ? parseDrumClipNotes(clip.source, samples, beatToNumber(clip.length), initialization)
            : parseClipNotes(clip.source, beatToNumber(clip.length), initialization),
        )
      } catch {
        // Invalid clip source has no playback highlights while it is being edited.
      }
    }
  }
  return notes
})
const playingRangesByLane = computed(() => {
  const ranges = new Map<string, Record<string, readonly SourceRange[]>>()
  if (!playing.value) return ranges
  for (const lane of project.value.instrumentLanes) {
    const clips: Record<string, readonly SourceRange[]> = {}
    for (const clip of lane.clips) {
      const key = clipSourceKey(lane.id, clip.id)
      if (soloClipKey.value && soloClipKey.value !== key) continue
      const relativeBeat = playhead.value - beatToNumber(clip.start)
      clips[clip.id] = (clipNotes.value.get(key) ?? [])
        .filter(({ beat, duration }) => beat <= relativeBeat && relativeBeat < beat + duration)
        .flatMap(({ sourceRanges }) => sourceRanges)
    }
    ranges.set(lane.id, clips)
  }
  return ranges
})
const selectedClipPlayingRanges = computed(() => {
  const lane = selectedLane.value
  const clip = selectedClip.value
  return lane && clip ? (playingRangesByLane.value.get(lane.id)?.[clip.id] ?? []) : []
})
const selectedClipLineCarets = computed(() => {
  const lane = selectedLane.value
  const clip = selectedClip.value
  if (!lane || !clip) return []
  return sourceLineCarets(clip.source, clipNotes.value.get(clipSourceKey(lane.id, clip.id)) ?? [])
})
const projectEndBeat = computed(() =>
  Math.max(
    0,
    ...project.value.instrumentLanes.flatMap((lane) =>
      lane.clips.map((clip) => beatToNumber(clip.start) + beatToNumber(clip.length)),
    ),
  ),
)
watchEffect(() => {
  const signature = project.value.globalTrack.timeSignatureChanges[0]!
  const defaultBar = beat(signature.numerator * 4, signature.denominator)
  let globalInitialization
  try {
    globalInitialization = compileSourceInitialization(project.value.globalTrack.source)
  } catch {
    // Keep independently valid clips usable while an initialization source is being edited.
    globalInitialization = undefined
  }

  for (const lane of project.value.instrumentLanes) {
    let initialization
    try {
      initialization = compileSourceInitialization(lane.source, globalInitialization)
    } catch {
      initialization = undefined
    }
    const samples = drumSamplesForLane(lane)
    for (const clip of lane.clips) {
      try {
        clip.length = sourceClipLength(clip.source, defaultBar, samples, initialization)
      } catch {
        // A clip may contain incomplete syntax while it is being edited. Isolate that
        // failure so initialization changes still resize every other clip in the project.
        clip.length = defaultBar
      }
    }
  }
})

// History contains editable project data only: moving the playhead or selecting a clip
// is not an edit. Fraction.reviver preserves rational beats without a JSON format change.
const history = reactive(new EditorHistory(JSON.stringify(project.value)))
const recordProject = () => history.record(JSON.stringify(project.value))
watch(
  () => JSON.stringify(project.value),
  (snapshot) => history.record(snapshot),
)
const beginEdit = () => {
  recordProject()
  history.begin()
}
const restoreHistory = (redo = false) => {
  recordProject()
  const snapshot = redo ? history.redo() : history.undo()
  if (snapshot === undefined) return
  stopPlayback()
  project.value = JSON.parse(snapshot, Fraction.reviver) as DawProject
  if (!selectedClip.value) selectedClipId.value = undefined
  if (!selectedLane.value) selectedLaneId.value = undefined
  if (!project.value.instrumentLanes.some(({ id }) => id === settingsLaneId.value)) {
    settingsLaneId.value = undefined
  }
}

const clearPlayTimer = () => {
  if (playTimer !== undefined) clearInterval(playTimer)
  playTimer = undefined
}

const finishPlayback = () => {
  playing.value = false
  playbackPending.value = false
  soloClipKey.value = undefined
  playhead.value = 0
  clearPlayTimer()
}

const insertClip = async (lane: InstrumentLane, rawBeat: number) => {
  beginEdit()
  settingsLaneId.value = undefined
  const start = snapBeat(Math.max(0, rawBeat), grid.value)
  const clip = createClip(lane, start)
  lane.clips.push(clip)
  selectedClipId.value = clip.id
  selectedLaneId.value = lane.id
  if (!playing.value) playhead.value = beatToNumber(start)
  await nextTick()
  timeline.value?.reveal(beatToNumber(start))
  editor.value?.focus()
}

const selectClip = (lane: InstrumentLane, clip: SourceClip) => {
  settingsLaneId.value = undefined
  selectedClipId.value = clip.id
  selectedLaneId.value = lane.id
  if (!playing.value) playhead.value = beatToNumber(clip.start)
}

const editLaneSettings = (lane: InstrumentLane) => {
  settingsLaneId.value = lane.id
  selectedClipId.value = undefined
  selectedLaneId.value = lane.id
}

const startPlayback = async (
  fromBeat: number,
  playbackProject = project.value,
  clipScope?: string,
) => {
  const requestId = ++playbackRequestId
  playbackPending.value = true
  playbackError.value = ''
  try {
    // Keep the transport usable in SSR/test environments; browsers take the audio path below.
    if (typeof AudioContext === 'undefined') {
      clearPlayTimer()
      playhead.value = fromBeat
      playing.value = true
      soloClipKey.value = clipScope
      playTimer = setInterval(() => (playhead.value += 0.05), 25)
      return
    }
    audioEngine ??= new DawAudioEngine()
    audioEngine.addEventListener('ended', finishPlayback)
    if (audioEngine.context.state === 'suspended') await audioEngine.context.resume()
    if (requestId !== playbackRequestId) return
    await audioEngine.play(playbackProject, fromBeat)
    if (requestId !== playbackRequestId) return
    clearPlayTimer()
    playhead.value = fromBeat
    playing.value = true
    soloClipKey.value = clipScope
    playTimer = setInterval(() => {
      playhead.value = audioEngine?.positionBeats ?? playhead.value
    }, 25)
  } catch (error) {
    if (requestId !== playbackRequestId) return
    playbackError.value = error instanceof Error ? error.message : String(error)
  } finally {
    if (requestId === playbackRequestId) playbackPending.value = false
  }
}

const pausePlayback = () => {
  playbackRequestId += 1
  playbackPending.value = false
  audioEngine?.stop()
  playing.value = false
  soloClipKey.value = undefined
  clearPlayTimer()
}

const togglePlayback = async () => {
  if (playing.value) return pausePlayback()
  await startPlayback(playhead.value)
}

const seekPlayback = (at: number) => {
  const position = Math.max(0, at)
  if (playing.value) void startPlayback(position)
  else playhead.value = position
}

const playSelectedClip = (relativeBeat = 0) => {
  if (!selectedLane.value || !selectedClip.value) return
  const fromBeat = beatToNumber(selectedClip.value.start) + relativeBeat
  if (!soloSelectedClip.value) return startPlayback(fromBeat)
  const soloLane = { ...selectedLane.value, clips: [selectedClip.value] }
  return startPlayback(
    fromBeat,
    { ...project.value, instrumentLanes: [soloLane] },
    clipSourceKey(selectedLane.value.id, selectedClip.value.id),
  )
}

const updateSoloSelectedClip = (solo: boolean) => {
  soloSelectedClip.value = solo
  if (!playing.value && !playbackPending.value) return

  const lane = selectedLane.value
  const clip = selectedClip.value
  if (!solo || !lane || !clip) {
    void startPlayback(playhead.value)
    return
  }

  const soloLane = { ...lane, clips: [clip] }
  void startPlayback(
    playhead.value,
    { ...project.value, instrumentLanes: [soloLane] },
    clipSourceKey(lane.id, clip.id),
  )
}

const toggleLaneCollapse = (laneId: string) => {
  const next = new Set(collapsedLaneIds.value)
  if (next.has(laneId)) next.delete(laneId)
  else next.add(laneId)
  collapsedLaneIds.value = next
}

const stopPlayback = () => {
  pausePlayback()
  playhead.value = 0
}

const moveClip = (clip: SourceClip, rawBeat: number) => {
  clip.start = snapBeat(Math.max(0, rawBeat), grid.value)
  if (!playing.value) playhead.value = beatToNumber(clip.start)
}

const deleteClip = (lane: InstrumentLane, clip: SourceClip) => {
  beginEdit()
  const index = lane.clips.findIndex(({ id }) => id === clip.id)
  if (index === -1) return
  lane.clips.splice(index, 1)
  if (selectedLaneId.value === lane.id && selectedClipId.value === clip.id) {
    selectedClipId.value = undefined
    selectedLaneId.value = undefined
  }
}

const addInstrumentLane = () => {
  beginEdit()
  project.value.instrumentLanes.push(createInstrumentLane(project.value))
}
const addDrumLane = () => {
  beginEdit()
  project.value.instrumentLanes.push(createDrumLane(project.value))
}

const deleteInstrumentLane = (lane: InstrumentLane) => {
  beginEdit()
  const index = project.value.instrumentLanes.findIndex(({ id }) => id === lane.id)
  if (index === -1) return
  project.value.instrumentLanes.splice(index, 1)
  const nextCollapsedLaneIds = new Set(collapsedLaneIds.value)
  nextCollapsedLaneIds.delete(lane.id)
  collapsedLaneIds.value = nextCollapsedLaneIds
  if (settingsLaneId.value === lane.id) settingsLaneId.value = undefined
  if (selectedLaneId.value === lane.id) {
    selectedClipId.value = undefined
    selectedLaneId.value = undefined
  }
}

const deleteSelectedClip = () => {
  if (selectedLane.value && selectedClip.value) deleteClip(selectedLane.value, selectedClip.value)
}

const duplicateSelectedClip = async () => {
  const lane = selectedLane.value
  const source = selectedClip.value
  if (!lane || !source) return
  beginEdit()
  const clip = createClip(lane, source.start.add(source.length))
  clip.source = source.source
  clip.length = source.length
  lane.clips.push(clip)
  selectClip(lane, clip)
  await nextTick()
  timeline.value?.reveal(beatToNumber(clip.start))
}

const updateClipSource = (clip: SourceClip, source: string) => {
  clip.source = source
}

const clipSourceKey = (laneId: string, clipId: string) => `${laneId}\u0000${clipId}`

const updateClipSourceById = (source: string, sourceKey?: string) => {
  const clip = sourceKey
    ? project.value.instrumentLanes
        .flatMap((lane) =>
          lane.clips.map((clip) => ({ clip, sourceKey: clipSourceKey(lane.id, clip.id) })),
        )
        .find((entry) => entry.sourceKey === sourceKey)?.clip
    : selectedClip.value
  if (clip) updateClipSource(clip, source)
}

const replaceProject = (source: string) => {
  const importedProject = parseDawProject(source)
  stopPlayback()
  project.value = importedProject
  history.reset(JSON.stringify(importedProject))
  projectLoadError.value = ''
  selectedClipId.value = undefined
  selectedLaneId.value = undefined
  settingsLaneId.value = undefined
  collapsedLaneIds.value = new Set()
  scrollLeft.value = 0
}

const importProject = async (event: Event) => {
  const input = event.currentTarget as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    replaceProject(await file.text())
  } catch (error) {
    projectLoadError.value = error instanceof Error ? error.message : String(error)
  } finally {
    // Allow selecting the same file again after fixing it on disk.
    input.value = ''
  }
}

const exportProject = () => {
  try {
    const blob = new Blob([serializeDawProject(project.value)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    const basename =
      project.value.title
        .trim()
        .replace(/[^a-z0-9_-]+/gi, '-')
        .replace(/^-+|-+$/g, '') || 'untitled-project'
    anchor.href = url
    anchor.download = `${basename}.xenpaper.json`
    anchor.click()
    URL.revokeObjectURL(url)
    projectLoadError.value = ''
  } catch (error) {
    projectLoadError.value = error instanceof Error ? error.message : String(error)
  }
}

const renderProject = async () => {
  if (rendering.value) return
  rendering.value = true
  playbackError.value = ''
  try {
    const blob = await renderProjectToWavBlob(
      project.value,
      renderTailSeconds.value,
      audioEngine?.context.sampleRate,
    )
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    const basename =
      project.value.title
        .trim()
        .replace(/[^a-z0-9_-]+/gi, '-')
        .replace(/^-+|-+$/g, '') || 'untitled-project'
    anchor.href = url
    anchor.download = `${basename}.wav`
    anchor.click()
    URL.revokeObjectURL(url)
  } catch (error) {
    playbackError.value = error instanceof Error ? error.message : String(error)
  } finally {
    rendering.value = false
  }
}

const onShortcut = (event: KeyboardEvent) => {
  if (event.defaultPrevented || event.repeat || event.isComposing || event.altKey) return
  const target = event.target instanceof Element ? event.target : undefined
  const clipButton = target?.closest<HTMLButtonElement>('button.clip')
  const editing = target?.closest(
    'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
  )
  const command = event.ctrlKey || event.metaKey
  const key = event.key.toLowerCase()
  if (command && key === 's') {
    event.preventDefault()
    // Source editors flush their drafts earlier in this event. Let derived clip
    // lengths settle too, before serializing or scheduling the updated score.
    void nextTick(exportProject)
    return
  }
  if (command && key === 'enter') {
    event.preventDefault()
    void nextTick(() => playSelectedClip())
    return
  }
  // Native text undo, arrows, spaces, and deletion must remain native.
  if (editing) return
  if (command) {
    if (key === 'z' || key === 'y') {
      event.preventDefault()
      restoreHistory(key === 'y' || event.shiftKey)
    } else if (key === 'd' && selectedClip.value) {
      event.preventDefault()
      void duplicateSelectedClip()
    }
    return
  }
  // Space on a focused toolbar button should activate it once, not also toggle playback.
  if (target?.closest('button, a, summary') && !target.closest('.clip')) return
  if (event.key === ' ') {
    event.preventDefault()
    void togglePlayback()
  } else if (event.key === 'Escape') {
    stopPlayback()
  } else if (event.key === 'Home') {
    event.preventDefault()
    seekPlayback(0)
    timeline.value?.reveal(0)
  } else if (event.key === 'Enter' && clipButton) {
    event.preventDefault()
    if (clipButton.getAttribute('aria-pressed') !== 'true') clipButton.click()
    void nextTick(() => editor.value?.focus())
  } else if (event.key === 'Delete' && selectedClip.value) {
    event.preventDefault()
    beginEdit()
    deleteSelectedClip()
  }
}
onMounted(() => window.addEventListener('keydown', onShortcut))

onMounted(() => {
  measureClipInspector()
  window.addEventListener('resize', measureClipInspector)
  if (typeof ResizeObserver !== 'undefined') {
    workspaceResizeObserver = new ResizeObserver(measureClipInspector)
    if (workspace.value) workspaceResizeObserver.observe(workspace.value)
  }
})

onMounted(async () => {
  const searchParams = new URL(document.location.href).searchParams
  const demoId = searchParams.get('demo')
  if (demoId) {
    const demoProject = demoProjects[demoId]
    if (!demoProject) {
      projectLoadError.value = `Unknown demo project: ${demoId}`
      return
    }
    try {
      replaceProject(demoProject)
    } catch (error) {
      projectLoadError.value = error instanceof Error ? error.message : String(error)
    }
    return
  }

  const projectUrl = searchParams.get('project')
  if (!projectUrl) return
  try {
    const response = await fetch(new URL(projectUrl, document.baseURI))
    if (!response.ok) throw new Error(`Could not load project (${response.status})`)
    replaceProject(await response.text())
  } catch (error) {
    projectLoadError.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onShortcut)
  window.removeEventListener('resize', measureClipInspector)
  workspaceResizeObserver?.disconnect()
  stopClipInspectorResize()
  pausePlayback()
  audioEngine?.dispose()
  audioEngine?.removeEventListener('ended', finishPlayback)
})
</script>

<template>
  <div class="daw" @pointerdown.capture="beginEdit" @focusin="beginEdit">
    <header class="project-header">
      <h1>Xenpaper <span>DAW</span></h1>
      <label class="project-title">
        <span class="sr-only">Project title</span>
        <input v-model="project.title" aria-label="Project title" placeholder="Untitled project" />
      </label>
      <div class="project-file-actions">
        <label class="project-file-button">
          Import project
          <input
            class="project-file-input"
            aria-label="Import Xenpaper project"
            type="file"
            accept=".xenpaper.json,application/json"
            @change="importProject"
          />
        </label>
        <button type="button" class="project-file-button" @click="exportProject">
          Export project
        </button>
        <label class="render-tail">
          Tail
          <input
            v-model.number="renderTailSeconds"
            aria-label="WAV render tail in seconds"
            type="number"
            min="0"
            step="0.5"
          />
          s
        </label>
        <button
          type="button"
          class="project-file-button"
          :disabled="rendering"
          @click="renderProject"
        >
          {{ rendering ? 'Rendering…' : 'Render WAV' }}
        </button>
      </div>
    </header>
    <div class="workspace-toolbar">
      <TransportControls
        :playhead="playhead"
        :playing="playing"
        @play="togglePlayback"
        @stop="stopPlayback"
      />
      <div class="history-controls" aria-label="Edit history">
        <button
          type="button"
          aria-label="Undo"
          title="Undo (Ctrl/⌘ Z)"
          :disabled="!history.canUndo"
          @click="restoreHistory()"
        >
          ↶
        </button>
        <button
          type="button"
          aria-label="Redo"
          title="Redo (Ctrl/⌘ Shift Z)"
          :disabled="!history.canRedo"
          @click="restoreHistory(true)"
        >
          ↷
        </button>
      </div>
      <label
        >Snap
        <select v-model.number="gridDenominator" aria-label="Clip snap grid">
          <option :value="1">1 beat</option>
          <option :value="2">½ beat</option>
          <option :value="3">⅓ beat</option>
          <option :value="4">¼ beat</option>
          <option :value="8">⅛ beat</option>
          <option :value="16">¹⁄₁₆ beat</option>
        </select>
      </label>
      <label
        >View
        <select v-model="displayMode" aria-label="Clip display">
          <option value="piano-roll">Piano roll</option>
          <option value="source">Source</option>
        </select>
      </label>
      <label class="zoom-control"
        >Zoom
        <input
          v-model.number="pixelsPerBeat"
          aria-label="Timeline zoom"
          type="range"
          :min="Math.min(8, pixelsPerBeat)"
          max="160"
        />
      </label>
      <button type="button" @click="timeline?.fit()">Fit project</button>
      <button
        type="button"
        :aria-pressed="followPlayhead"
        title="Keep the playing position visible. Panning turns this off."
        @click="followPlayhead = !followPlayhead"
      >
        Follow
      </button>
    </div>
    <p v-if="projectLoadError" class="playback-error" role="alert">{{ projectLoadError }}</p>
    <p v-if="playbackError" class="playback-error" role="alert">{{ playbackError }}</p>
    <div
      ref="workspace"
      class="workspace"
      :style="
        clipInspectorWidth === undefined
          ? undefined
          : { '--clip-inspector-width': `${clipInspectorWidth}px` }
      "
    >
      <section class="arranger" aria-label="Arrangement">
        <details class="project-settings">
          <summary>
            <strong>{{ project.globalTrack.tempoChanges[0]!.bpm }} BPM</strong>
            <span
              >{{ project.globalTrack.timeSignatureChanges[0]!.numerator }}/{{
                project.globalTrack.timeSignatureChanges[0]!.denominator
              }}</span
            >
            <span>Global tuning &amp; defaults</span>
          </summary>
          <GlobalLane
            :track="project.globalTrack"
            @update-source="project.globalTrack.source = $event"
            @update-tempo="project.globalTrack.tempoChanges[0]!.bpm = $event"
            @update-time-signature="
              (numerator, denominator) => {
                project.globalTrack.timeSignatureChanges[0]!.numerator = numerator
                project.globalTrack.timeSignatureChanges[0]!.denominator = denominator
              }
            "
          />
        </details>
        <ArrangementTimeline
          ref="timeline"
          v-model:scroll-left="scrollLeft"
          v-model:pixels-per-beat="pixelsPerBeat"
          v-model:follow="followPlayhead"
          :end-beat="projectEndBeat"
          :playhead="playhead"
          :playing="playing"
          @seek="seekPlayback"
        >
          <section v-for="lane in project.instrumentLanes" :key="lane.id" class="instrument-lane">
            <DrumLane
              v-if="lane.kind === 'drum'"
              :lane="lane"
              :global-source="project.globalTrack.source"
              :selected-clip-id="selectedLaneId === lane.id ? selectedClipId : undefined"
              :pixels-per-beat="pixelsPerBeat"
              :scroll-left="scrollLeft"
              :display-mode="displayMode"
              :collapsed="collapsedLaneIds.has(lane.id)"
              :playing-ranges-by-clip="playingRangesByLane.get(lane.id)"
              :settings-open="settingsLaneId === lane.id"
              :settings-target="laneSettingsInspector"
              @insert="insertClip(lane, $event)"
              @select="selectClip(lane, $event)"
              @place-playhead="seekPlayback"
              @move="moveClip"
              @delete="deleteClip(lane, $event)"
              @update-source="lane.source = $event"
              @update-drumkit="lane.drumkit = $event"
              @update-name="lane.name = $event"
              @update-gain="lane.gain = $event"
              @delete-lane="deleteInstrumentLane(lane)"
              @toggle-collapse="toggleLaneCollapse(lane.id)"
              @edit-settings="editLaneSettings(lane)"
            />
            <template v-else>
              <PitchedLane
                :collapsed="collapsedLaneIds.has(lane.id)"
                :lane="lane"
                :global-source="project.globalTrack.source"
                :selected-clip-id="selectedLaneId === lane.id ? selectedClipId : undefined"
                :pixels-per-beat="pixelsPerBeat"
                :scroll-left="scrollLeft"
                :display-mode="displayMode"
                :playing-ranges-by-clip="playingRangesByLane.get(lane.id)"
                :settings-open="settingsLaneId === lane.id"
                :settings-target="laneSettingsInspector"
                @insert="insertClip(lane, $event)"
                @select="selectClip(lane, $event)"
                @place-playhead="seekPlayback"
                @move="moveClip"
                @delete="deleteClip(lane, $event)"
                @update-name="lane.name = $event"
                @update-source="lane.source = $event"
                @update-instrument="lane.instrument = $event"
                @update-gain="lane.gain = $event"
                @delete-lane="deleteInstrumentLane(lane)"
                @toggle-collapse="toggleLaneCollapse(lane.id)"
                @edit-settings="editLaneSettings(lane)"
              />
            </template>
          </section>
        </ArrangementTimeline>
        <div class="add-lanes">
          <button type="button" class="add-lane" @click="addInstrumentLane">
            Add instrument lane
          </button>
          <button type="button" class="add-lane add-drum-lane" @click="addDrumLane">
            Add drum lane
          </button>
        </div>
      </section>
      <div
        class="clip-inspector-divider"
        role="separator"
        aria-label="Resize clip editor"
        aria-orientation="vertical"
        :aria-valuemin="inspectorMinWidth"
        :aria-valuemax="inspectorMaxWidth"
        :aria-valuenow="inspectorCurrentWidth"
        tabindex="0"
        @pointerdown="startClipInspectorResize"
        @keydown="resizeClipInspectorWithKeyboard"
      />
      <aside
        ref="clipInspector"
        class="clip-inspector"
        :aria-label="settingsLaneId ? 'Lane editor' : 'Clip editor'"
      >
        <div id="lane-settings-inspector" ref="laneSettingsInspector" />
        <ClipSourceEditor
          v-if="!settingsLaneId"
          ref="editor"
          :clip="selectedClip"
          :lane-name="selectedLane?.name"
          :source-key="
            selectedLane && selectedClip
              ? clipSourceKey(selectedLane.id, selectedClip.id)
              : undefined
          "
          :drum-samples="selectedLane ? drumSamplesForLane(selectedLane) : undefined"
          :diagnostics="selectedClipDiagnostics"
          :playing-ranges="selectedClipPlayingRanges"
          :line-carets="selectedClipLineCarets"
          :solo="soloSelectedClip"
          @update-source="updateClipSourceById"
          @delete="deleteSelectedClip"
          @duplicate="duplicateSelectedClip"
          @play="playSelectedClip()"
          @play-from="playSelectedClip"
          @update:solo="updateSoloSelectedClip"
          @stop="stopPlayback"
        />
      </aside>
    </div>
    <footer class="workspace-status">
      <span v-if="selectedClip && selectedLane"
        >{{ selectedLane.name }} · Beat {{ beatToNumber(selectedClip.start) }} ·
        {{ beatToNumber(selectedClip.length) }} beats</span
      >
      <span v-else>Double-click a lane to create a clip, or use + Clip.</span>
      <button type="button" :aria-expanded="shortcutsOpen" @click="shortcutsOpen = !shortcutsOpen">
        Keyboard shortcuts
      </button>
    </footer>
    <p v-if="shortcutsOpen" class="shortcut-help">
      Space: play / pause · Escape: stop · Home: start · Delete: delete clip · Enter on a clip: edit
      · Ctrl/⌘ D: duplicate · Ctrl/⌘ Z: undo · Ctrl/⌘ Shift Z: redo · Ctrl/⌘ S: export · Ctrl/⌘
      Enter: play from clip. The Solo toggle also applies to line wedges. Text fields keep their
      normal editing keys.
    </p>
  </div>
</template>

<style scoped>
.daw {
  --daw-track-width: 14rem;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 0;
  height: calc(100dvh - 1rem);
  min-height: 32rem;
  padding: 0.5rem;
  color: var(--xenpaper-slate-100);
  background: var(--xenpaper-slate-950);
  font-size: 0.875rem;
}
.daw :deep(button:not(.clip):not(.line-caret)),
.daw :deep(select),
.daw :deep(input:not([type='range']):not([type='file'])) {
  box-sizing: border-box;
  min-height: 2rem;
  border: 1px solid var(--xenpaper-slate-500);
  border-radius: 0.3rem;
  padding: 0.35rem 0.55rem;
  font: inherit;
  color: inherit;
  background: var(--xenpaper-slate-850);
}
.daw :deep(button),
.daw :deep(summary),
.project-file-button {
  cursor: pointer;
}
.daw :deep(button:not(.clip):not(.line-caret):hover:not(:disabled)),
.project-file-button:hover {
  border-color: var(--xenpaper-slate-400);
}
.daw :deep(button:disabled) {
  opacity: 0.4;
  cursor: not-allowed;
}
.daw :deep(button[aria-pressed='true']) {
  border-color: var(--xenpaper-cyan);
  color: var(--xenpaper-cyan);
}
.daw :deep(:focus-visible),
.project-file-button:focus-within {
  outline: 2px solid var(--xenpaper-cyan);
  outline-offset: 2px;
}
.daw :deep(input[type='range']) {
  accent-color: var(--xenpaper-cyan);
}
.project-header,
.workspace-toolbar,
.project-file-actions,
.workspace-status {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}
.project-header {
  flex-wrap: wrap;
  padding: 0.5rem 0.5rem 0.9rem;
}
.project-header h1 {
  margin: 0 0.5rem 0 0;
  font-size: 1.2rem;
  white-space: nowrap;
}
.project-header h1 span {
  color: var(--xenpaper-slate-400);
  font-size: 0.7rem;
  letter-spacing: 0.12em;
}
.project-title {
  flex: 1;
  min-width: 10rem;
}
.project-title input {
  width: 100%;
  max-width: 28rem;
}
.project-file-actions {
  flex-wrap: wrap;
  margin-left: auto;
}
.project-file-button {
  border: 1px solid var(--xenpaper-slate-500);
  border-radius: 0.3rem;
  padding: 0.35rem 0.55rem;
  background: var(--xenpaper-slate-850);
}
.project-file-input,
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
.render-tail,
.workspace-toolbar label {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  white-space: nowrap;
}
.render-tail input {
  width: 3.5rem;
}
.workspace-toolbar {
  flex-wrap: wrap;
  padding: 0.55rem;
  border-block: 1px solid var(--xenpaper-slate-500);
  background: var(--xenpaper-slate-875);
}
.history-controls {
  display: flex;
  gap: 0.25rem;
  margin-right: 0.5rem;
}
.zoom-control {
  margin-left: auto;
}
.zoom-control input {
  width: 7rem;
}
.workspace {
  --clip-inspector-width: 26%;
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 0.5rem minmax(20rem, var(--clip-inspector-width));
}
.arranger {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.arranger > .arrangement-timeline {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-gutter: stable;
}
.project-settings {
  border-bottom: 1px solid var(--xenpaper-slate-500);
  background: var(--xenpaper-slate-925);
}
.project-settings summary {
  padding: 0.7rem;
}
.project-settings summary span {
  margin-left: 1rem;
  color: var(--xenpaper-slate-400);
}
.project-settings :deep(.global-lane) {
  flex-wrap: wrap;
  gap: 0.75rem;
}
.project-settings :deep(.source-control) {
  min-width: 0;
  flex-basis: 100%;
}
.project-settings :deep(.xenpaper-source-editor) {
  min-width: 0;
}
.clip-inspector {
  min-width: 0;
  overflow-y: auto;
  padding: 1rem;
  background: var(--xenpaper-slate-925);
}
.clip-inspector-divider {
  position: relative;
  z-index: 1;
  cursor: col-resize;
  touch-action: none;
  background: var(--xenpaper-slate-500);
}
.clip-inspector-divider::after {
  position: absolute;
  inset: 0 0 0 50%;
  width: 1px;
  content: '';
  background: var(--xenpaper-slate-400);
}
.clip-inspector-divider:hover,
.clip-inspector-divider:focus-visible {
  outline: none;
  background: color-mix(in srgb, var(--xenpaper-cyan) 45%, var(--xenpaper-slate-700));
}
.add-lanes {
  display: flex;
  gap: 0.5rem;
  padding: 0.6rem;
}
.add-lanes .add-lane {
  flex: 1;
  border-style: dashed;
  background: transparent;
}
.workspace-status {
  justify-content: space-between;
  gap: 1rem;
  padding: 0.5rem;
  border-top: 1px solid var(--xenpaper-slate-500);
  color: var(--xenpaper-slate-400);
  font-size: 0.75rem;
}
.workspace-status > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.workspace-status button {
  flex: none;
}
.shortcut-help {
  margin: 0;
  padding: 0.5rem;
  line-height: 1.6;
  color: var(--xenpaper-slate-400);
}
.playback-error {
  margin: 0;
  padding: 0.5rem 0.75rem;
  color: var(--xenpaper-light-red);
}
@media (max-width: 1000px) {
  .daw {
    --daw-track-width: 11rem;
  }
  .workspace {
    --clip-inspector-width: 18rem;
    grid-template-columns: minmax(0, 1fr) 0.5rem minmax(18rem, var(--clip-inspector-width));
  }
  .zoom-control {
    margin-left: 0;
  }
}
@media (max-width: 760px) {
  .daw {
    --daw-track-width: 9rem;
    height: auto;
    min-height: calc(100dvh - 1rem);
  }
  .project-header {
    gap: 0.4rem;
  }
  .project-file-actions {
    margin: 0;
    width: 100%;
  }
  .workspace {
    grid-template-columns: minmax(0, 1fr);
  }
  .clip-inspector-divider {
    display: none;
  }
  .arranger > .arrangement-timeline {
    flex: none;
    min-height: 12rem;
    max-height: 50dvh;
  }
  .clip-inspector {
    border-left: 0;
    border-top: 1px solid var(--xenpaper-slate-500);
    max-height: 45dvh;
  }
  .workspace-toolbar {
    gap: 0.45rem;
  }
  .workspace-status {
    flex-wrap: wrap;
  }
}
</style>
