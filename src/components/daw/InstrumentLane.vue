<script setup lang="ts">
import { ref } from 'vue'
import type { SourceRange } from '../../daw/score'
import {
  beatToNumber,
  pointerXToBeat,
  type ClipDisplayMode,
  type InstrumentLane as InstrumentLaneModel,
  type SourceClip,
} from '../../daw/project'
import XenpaperSourceEditor from './XenpaperSourceEditor.vue'
import ClipSourcePreview from './ClipSourcePreview.vue'

const props = withDefaults(
  defineProps<{
    lane: InstrumentLaneModel
    selectedClipId?: string
    pixelsPerBeat: number
    scrollLeft: number
    displayMode: ClipDisplayMode
    collapsed?: boolean
    laneLabel: string
    timelineLabel: string
    editorLabel: string
    drumSamples?: string[]
    playingRangesByClip?: Readonly<Record<string, readonly SourceRange[]>>
  }>(),
  { collapsed: false, selectedClipId: undefined, drumSamples: undefined },
)
const emit = defineEmits<{
  insert: [beat: number]
  select: [clip: SourceClip]
  'place-playhead': [beat: number]
  move: [clip: SourceClip, beat: number]
  delete: [clip: SourceClip]
  'update-source': [source: string]
  'update-name': [name: string]
  'update-gain': [gain: number]
  'delete-lane': []
  'toggle-collapse': []
}>()

const laneElement = ref<HTMLElement>()
const viewportWidth = window.innerWidth
const dragging = ref<{
  clip: SourceClip
  pointerOffset: number
  startX: number
  pointerId: number
  active: boolean
}>()

const appendClip = () =>
  emit(
    'insert',
    Math.max(
      0,
      ...props.lane.clips.map((clip) => beatToNumber(clip.start) + beatToNumber(clip.length)),
    ),
  )
const clipCaption = (clip: SourceClip) =>
  clip.source
    .split('\n')
    .find((line) => line.trim())
    ?.replace(/^#\s*/, '')
    .slice(0, 80) || 'Empty clip'

const pointerBeat = (event: MouseEvent) =>
  pointerXToBeat(
    event.clientX - (laneElement.value?.getBoundingClientRect().left ?? 0),
    props.scrollLeft,
    props.pixelsPerBeat,
  )

const clipVisibleStart = (clip: SourceClip) =>
  Math.max(0, props.scrollLeft - beatToNumber(clip.start) * props.pixelsPerBeat)

const onClick = (event: MouseEvent) => {
  if ((event.target as HTMLElement).closest('.clip')) return
  emit('place-playhead', pointerBeat(event))
}

const onDoubleClick = (event: MouseEvent) => {
  if ((event.target as HTMLElement).closest('.clip')) return
  emit('insert', pointerBeat(event))
}

const startDrag = (event: PointerEvent, clip: SourceClip) => {
  if (event.button !== 0 || event.isPrimary === false) return
  emit('select', clip)
  dragging.value = {
    clip,
    pointerOffset: pointerBeat(event) - beatToNumber(clip.start),
    startX: event.clientX,
    pointerId: event.pointerId,
    active: false,
  }
  const clipElement = event.currentTarget as HTMLElement
  clipElement.focus({ preventScroll: true })
  clipElement.setPointerCapture?.(event.pointerId)
}

const moveDrag = (event: PointerEvent) => {
  if (!dragging.value || event.pointerId !== dragging.value.pointerId) return
  if (!dragging.value.active && Math.abs(event.clientX - dragging.value.startX) < 4) return
  dragging.value.active = true
  emit('move', dragging.value.clip, Math.max(0, pointerBeat(event) - dragging.value.pointerOffset))
}

const onKeyDown = (event: KeyboardEvent) => {
  if (event.key !== 'Delete' || !props.selectedClipId) return
  const clip = props.lane.clips.find(({ id }) => id === props.selectedClipId)
  if (!clip) return
  event.preventDefault()
  emit('delete', clip)
}
</script>

<template>
  <section
    class="instrument-lane-component"
    :class="{ collapsed, selected: !!selectedClipId }"
    tabindex="-1"
    @click.self="onClick"
    @dblclick.self="onDoubleClick"
    @pointermove.self="moveDrag"
    @pointerup.self="dragging = undefined"
    @pointercancel.self="dragging = undefined"
    @keydown.self="onKeyDown"
  >
    <header class="instrument-header" :class="{ collapsed }">
      <div class="track-title">
        <button
          type="button"
          class="collapse-lane"
          :aria-label="`${collapsed ? 'Expand' : 'Collapse'} ${lane.name}`"
          :aria-expanded="!collapsed"
          :title="collapsed ? 'Expand track' : 'Collapse track'"
          @click="emit('toggle-collapse')"
        >
          {{ collapsed ? '▸' : '▾' }}
        </button>
        <input
          class="lane-name"
          :aria-label="`${laneLabel} name`"
          :value="lane.name"
          @input="emit('update-name', ($event.target as HTMLInputElement).value)"
        />
        <button
          v-if="collapsed"
          type="button"
          class="delete-lane compact-delete"
          :aria-label="`Delete ${lane.name}`"
          title="Delete lane (Undo restores it)"
          @click="emit('delete-lane')"
        >
          ×
        </button>
      </div>
      <label v-if="!collapsed" class="gain-control">
        Gain
        <input
          :aria-label="`${laneLabel.replace(' lane', '')} gain`"
          type="range"
          min="0"
          max="1"
          step="0.01"
          :value="lane.gain"
          @input="emit('update-gain', Number(($event.target as HTMLInputElement).value))"
        />
        <output>{{ Math.round(lane.gain * 100) }}%</output>
      </label>
      <button
        v-if="!collapsed"
        type="button"
        class="append-clip"
        :aria-label="`Add clip to ${lane.name}`"
        title="Create a clip after the last clip on this track"
        @click="appendClip"
      >
        + Clip
      </button>
      <details v-if="!collapsed" class="lane-settings">
        <summary>Sound &amp; source</summary>
        <slot name="settings" />
        <div class="source-control">
          <span>Lane source</span>
          <XenpaperSourceEditor
            :editor-label="editorLabel"
            :source="lane.source"
            :drum-samples="drumSamples"
            :rows="3"
            @update:source="emit('update-source', $event)"
          />
        </div>
        <button
          type="button"
          class="delete-lane"
          :aria-label="`Delete ${lane.name}`"
          @click="emit('delete-lane')"
        >
          Delete lane
        </button>
      </details>
    </header>
    <div
      v-show="!collapsed"
      ref="laneElement"
      class="lane"
      :aria-label="timelineLabel"
      tabindex="0"
      :style="{ '--beat-width': `${pixelsPerBeat}px`, '--grid-offset': `${-scrollLeft}px` }"
      @click="onClick"
      @dblclick="onDoubleClick"
      @pointermove="moveDrag"
      @pointerup="dragging = undefined"
      @pointercancel="dragging = undefined"
      @lostpointercapture="dragging = undefined"
      @keydown="onKeyDown"
    >
      <button
        v-for="clip in lane.clips"
        :key="clip.id"
        type="button"
        class="clip"
        :class="{ selected: selectedClipId === clip.id }"
        :aria-pressed="selectedClipId === clip.id"
        :aria-label="`${lane.name}: ${clipCaption(clip)}, beat ${beatToNumber(clip.start)}, ${beatToNumber(clip.length)} beats`"
        :title="`${clipCaption(clip)} — drag to move; Delete to remove`"
        :style="{
          left: `${beatToNumber(clip.start) * pixelsPerBeat - scrollLeft}px`,
          width: `${beatToNumber(clip.length) * pixelsPerBeat}px`,
        }"
        @click.stop="emit('select', clip)"
        @dblclick.stop
        @pointerdown.prevent="startDrag($event, clip)"
      >
        <span class="clip-caption">{{ clipCaption(clip) }}</span>
        <pre v-if="displayMode === 'source'"><ClipSourcePreview
          :source="clip.source"
          :width="beatToNumber(clip.length) * pixelsPerBeat"
          :visible-start="clipVisibleStart(clip)"
          :visible-width="viewportWidth"
          :drum-samples="drumSamples"
          :playing-ranges="playingRangesByClip?.[clip.id]"
        /></pre>
        <div v-else class="clip-preview"><slot name="preview" :clip="clip" /></div>
      </button>
      <span v-if="!lane.clips.length" class="hint"
        >Double-click to create a clip<br />or choose + Clip</span
      >
    </div>
  </section>
</template>

<style scoped>
.instrument-lane-component {
  display: grid;
  grid-template-columns: var(--daw-track-width, 14rem) minmax(0, 1fr);
  border-bottom: 1px solid var(--xenpaper-slate-500);
}
.instrument-header {
  min-width: 0;
  padding: 0.55rem;
  background: var(--xenpaper-slate-875);
  border-left: 3px solid transparent;
}
.selected > .instrument-header {
  border-left-color: var(--xenpaper-cyan);
}
.track-title {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  margin-bottom: 0.5rem;
}
.lane-name {
  min-width: 0;
  width: 100%;
  font: inherit;
  font-weight: bold;
}
.collapse-lane {
  flex: none;
}
.collapsed .track-title {
  margin-bottom: 0;
}
.gain-control {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.7rem;
  margin-bottom: 0.4rem;
}
.gain-control input {
  flex: 1;
  min-width: 0;
  width: 4rem;
}
.gain-control output {
  width: 2.5rem;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.append-clip {
  width: 100%;
  margin-bottom: 0.45rem;
}
.lane-settings {
  font-size: 0.75rem;
  min-width: 0;
}
.lane-settings summary {
  padding: 0.2rem 0;
  cursor: pointer;
  color: var(--xenpaper-slate-400);
}
.lane-settings[open] summary {
  margin-bottom: 0.5rem;
}
.lane-settings :deep(fieldset) {
  min-width: 0;
  margin: 0.5rem 0;
  padding: 0.4rem;
}
.lane-settings :deep(label) {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem;
}
.lane-settings :deep(input:not([type='radio'])),
.lane-settings :deep(select) {
  min-width: 0;
  max-width: 100%;
}
.lane-settings :deep(.instrument-source),
.lane-settings :deep(.instrument-import),
.lane-settings :deep(.drumkit-source) {
  min-width: 0;
  flex-wrap: wrap;
}
.source-control {
  display: grid;
  gap: 0.4rem;
  margin: 0.75rem 0;
}
.delete-lane {
  color: var(--xenpaper-light-red);
  width: 100%;
}
.compact-delete {
  width: auto;
  flex: none;
}
.lane {
  position: relative;
  min-width: 0;
  overflow: hidden;
  min-height: 9rem;
  cursor: crosshair;
  background-color: var(--xenpaper-slate-925);
  background-image: linear-gradient(90deg, var(--xenpaper-slate-500) 1px, transparent 1px);
  background-position-x: var(--grid-offset);
  background-size: var(--beat-width) 100%;
  user-select: none;
  touch-action: pan-y;
}
.clip {
  position: absolute;
  top: 0.65rem;
  height: 7.5rem;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--xenpaper-slate-450);
  border-radius: 0.3rem;
  background: var(--xenpaper-teal-950);
  color: white;
  text-align: left;
  user-select: none;
  touch-action: none;
  cursor: grab;
}
.clip:active {
  cursor: grabbing;
}
.clip-caption {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  padding: 0.2rem 0.45rem;
  font: 0.7rem/1.2 sans-serif;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: var(--xenpaper-slate-875);
  pointer-events: none;
  z-index: 1;
}
.clip pre,
.clip-preview {
  position: absolute;
  inset: 1.5rem 0.25rem 0.25rem;
  margin: 0;
  overflow: hidden;
  white-space: pre-wrap;
  pointer-events: none;
}
.clip.selected {
  border: 2px solid var(--xenpaper-cyan);
}
.hint {
  position: absolute;
  inset: 3rem 0 auto;
  text-align: center;
  color: var(--xenpaper-slate-400);
  font-size: 0.75rem;
  line-height: 1.7;
  pointer-events: none;
}
</style>
