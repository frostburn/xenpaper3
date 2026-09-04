<script setup lang="ts">
import { ref } from 'vue'
import {
  beatToNumber,
  pointerXToBeat,
  type ClipDisplayMode,
  type InstrumentLane as InstrumentLaneModel,
  type SourceClip,
} from '../../daw/project'
import XenpaperSourceEditor from './XenpaperSourceEditor.vue'
import XenpaperSourceHighlight from './XenpaperSourceHighlight.vue'

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
const dragging = ref<{ clip: SourceClip; pointerOffset: number }>()

const pointerBeat = (event: MouseEvent) =>
  pointerXToBeat(
    event.clientX - (laneElement.value?.getBoundingClientRect().left ?? 0),
    props.scrollLeft,
    props.pixelsPerBeat,
  )

const onClick = (event: MouseEvent) => {
  if ((event.target as HTMLElement).closest('.clip')) return
  emit('place-playhead', pointerBeat(event))
}

const onDoubleClick = (event: MouseEvent) => {
  if ((event.target as HTMLElement).closest('.clip')) return
  emit('insert', pointerBeat(event))
}

const startDrag = (event: PointerEvent, clip: SourceClip) => {
  emit('select', clip)
  dragging.value = { clip, pointerOffset: pointerBeat(event) - beatToNumber(clip.start) }
  const clipElement = event.currentTarget as HTMLElement
  clipElement.focus({ preventScroll: true })
  clipElement.setPointerCapture?.(event.pointerId)
}

const moveDrag = (event: PointerEvent) => {
  if (!dragging.value) return
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
    :class="{ collapsed }"
    tabindex="-1"
    @click.self="onClick"
    @dblclick.self="onDoubleClick"
    @pointermove.self="moveDrag"
    @pointerup.self="dragging = undefined"
    @pointercancel.self="dragging = undefined"
    @keydown.self="onKeyDown"
  >
    <header class="instrument-header" :class="{ collapsed }">
      <input
        class="lane-name"
        :aria-label="`${laneLabel} name`"
        :value="lane.name"
        @input="emit('update-name', ($event.target as HTMLInputElement).value)"
      />
      <button
        type="button"
        class="collapse-lane"
        :aria-label="`${collapsed ? 'Expand' : 'Collapse'} ${lane.name}`"
        :aria-expanded="!collapsed"
        @click="emit('toggle-collapse')"
      >
        {{ collapsed ? '▸ Expand' : '▾ Collapse' }}
      </button>
      <button
        type="button"
        class="delete-lane"
        :aria-label="`Delete ${lane.name}`"
        @click="emit('delete-lane')"
      >
        Delete lane
      </button>
      <slot v-if="!collapsed" name="settings" />
      <label v-if="!collapsed">
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
      <label v-if="!collapsed" class="source-control">
        Lane source
        <XenpaperSourceEditor
          :editor-label="editorLabel"
          :source="lane.source"
          :drum-samples="drumSamples"
          :rows="3"
          @update:source="emit('update-source', $event)"
        />
      </label>
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
      @keydown="onKeyDown"
    >
      <button
        v-for="clip in lane.clips"
        :key="clip.id"
        type="button"
        class="clip"
        :class="{ selected: selectedClipId === clip.id }"
        :style="{
          left: `${beatToNumber(clip.start) * pixelsPerBeat - scrollLeft}px`,
          width: `${beatToNumber(clip.length) * pixelsPerBeat}px`,
        }"
        @click.stop="emit('select', clip)"
        @dblclick.stop
        @pointerdown.prevent="startDrag($event, clip)"
      >
        <pre v-if="displayMode === 'source'"><XenpaperSourceHighlight
          :source="clip.source"
          :drum-samples="drumSamples"
        /></pre>
        <slot v-else name="preview" :clip="clip" />
      </button>
      <span v-if="!lane.clips.length" class="hint">Double-click to create a clip</span>
    </div>
  </section>
</template>

<style scoped>
.instrument-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  padding: 0.6rem;
  background: var(--xenpaper-bg-light);
}
.instrument-header.collapsed {
  justify-content: flex-start;
  gap: 0.5rem;
  padding: 0.25rem 0.5rem;
}
.instrument-header.collapsed .delete-lane {
  margin-left: auto;
  padding-block: 0.2rem;
}
.instrument-header :deep(label) {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.lane-name {
  min-width: 6rem;
  width: 10rem;
  font: inherit;
  font-weight: bold;
}
.collapse-lane {
  flex: none;
  white-space: nowrap;
}
.delete-lane {
  color: var(--xenpaper-light-red);
  border: 1px solid var(--xenpaper-light-red);
  border-radius: 0.25rem;
  padding: 0.35rem 0.55rem;
  background: var(--xenpaper-bg);
  cursor: pointer;
}
.source-control {
  display: flex;
  flex: 1 0 100%;
  align-items: stretch !important;
  flex-direction: column;
  gap: 0.4rem;
}
.source-control .xenpaper-source-editor {
  min-width: 0;
  font-family: monospace;
}
.lane {
  position: relative;
  overflow: hidden;
  height: 9rem;
  cursor: crosshair;
  background-color: var(--xenpaper-bg-canvas);
  background-image: linear-gradient(90deg, var(--xenpaper-border) 1px, transparent 1px);
  background-position-x: var(--grid-offset);
  background-size: var(--beat-width) 100%;
  user-select: none;
  touch-action: none;
}
.clip {
  position: absolute;
  top: 1rem;
  height: 7rem;
  overflow: hidden;
  border: 2px solid var(--xenpaper-border-strong);
  background: var(--xenpaper-focus);
  color: white;
  text-align: left;
  user-select: none;
}
.clip pre {
  height: 100%;
  margin: 0;
  overflow: hidden;
  white-space: pre-wrap;
  pointer-events: none;
}
.clip.selected {
  border-color: var(--xenpaper-cyan);
}
.hint {
  position: absolute;
  inset: 3.5rem 0 auto;
  text-align: center;
  color: var(--xenpaper-text-muted);
  pointer-events: none;
}
</style>
