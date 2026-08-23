<script setup lang="ts">
import {
  beatToNumber,
  pointerXToBeat,
  type InstrumentLane,
  type SourceClip,
} from '../../daw/project'

const props = defineProps<{
  lane: InstrumentLane
  selectedClipId?: string
  pixelsPerBeat: number
  scrollLeft: number
}>()
const emit = defineEmits<{
  insert: [beat: number]
  select: [clip: SourceClip]
  'place-playhead': [beat: number]
}>()

const pointerBeat = (event: MouseEvent) =>
  pointerXToBeat(
    event.clientX - (event.currentTarget as HTMLElement).getBoundingClientRect().left,
    props.scrollLeft,
    props.pixelsPerBeat,
  )

const onClick = (event: MouseEvent) => {
  if ((event.target as HTMLElement).closest('.clip')) return
  emit('place-playhead', pointerBeat(event))
}
</script>

<template>
  <div
    class="lane"
    aria-label="Instrument piano roll"
    @click="onClick"
    @dblclick="emit('insert', pointerBeat($event))"
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
    >
      {{ clip.source.split('\n').find(Boolean) }}
    </button>
    <span v-if="!lane.clips.length" class="hint">Double-click to create a clip</span>
  </div>
</template>

<style scoped>
.lane {
  position: relative;
  overflow: hidden;
  height: 9rem;
  cursor: crosshair;
  background-color: #151b27;
  background-image: linear-gradient(90deg, #30394a 1px, transparent 1px);
  background-size: 64px 100%;
}
.clip {
  position: absolute;
  top: 1rem;
  height: 7rem;
  overflow: hidden;
  border: 2px solid #788aa8;
  background: #40577d;
  color: white;
  text-align: left;
}
.clip.selected {
  border-color: #8ce6ff;
  background: #486d93;
}
.hint {
  position: absolute;
  inset: 3.5rem 0 auto;
  text-align: center;
  color: #9aa5b8;
  pointer-events: none;
}
</style>
