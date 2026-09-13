<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { clamp } from 'xen-dev-utils'

const props = defineProps<{
  endBeat: number
  playhead: number
  playing: boolean
  pixelsPerBeat: number
  scrollLeft: number
  follow: boolean
}>()
const emit = defineEmits<{
  'update:scrollLeft': [pixels: number]
  'update:pixelsPerBeat': [pixels: number]
  'update:follow': [follow: boolean]
  seek: [beat: number]
}>()
const ruler = ref<HTMLElement>()
const scrollbar = ref<HTMLElement>()
const viewportWidth = ref(640)
let resizeObserver: ResizeObserver | undefined

// The scrollbar's extent is content width minus viewport width, not content width itself.
const contentWidth = computed(() =>
  Math.max(
    viewportWidth.value,
    Math.ceil(Math.max(16, props.endBeat + 8, props.playhead + 4) * props.pixelsPerBeat),
  ),
)
const maxScroll = computed(() => Math.max(0, contentWidth.value - viewportWidth.value))
const playheadX = computed(() => props.playhead * props.pixelsPerBeat - props.scrollLeft)
const marks = computed(() => {
  // Display quarter-note beats (zero-based, as in the transport), not fictitious 4/4 bars.
  // This remains correct for projects with meter changes and fractional beat positions.
  const step = 2 ** Math.max(0, Math.ceil(Math.log2(48 / props.pixelsPerBeat)))
  const first = Math.ceil(props.scrollLeft / props.pixelsPerBeat / step) * step
  const count = Math.ceil(viewportWidth.value / props.pixelsPerBeat / step) + 1
  return Array.from({ length: count }, (_, index) => first + index * step)
})
const scrollTo = (pixels: number) => {
  const next = clamp(0, maxScroll.value, pixels)
  if (next !== props.scrollLeft) emit('update:scrollLeft', next)
}
const reveal = (beat: number) => {
  const x = beat * props.pixelsPerBeat - props.scrollLeft
  if (x < 0 || x > viewportWidth.value * 0.85) {
    scrollTo(beat * props.pixelsPerBeat - viewportWidth.value * 0.2)
  }
}
const fit = async () => {
  // Fit may go below the usual slider minimum for long scores.
  emit('update:pixelsPerBeat', Math.min(160, viewportWidth.value / Math.max(8, props.endBeat + 2)))
  await nextTick()
  scrollTo(0)
}
defineExpose({ fit, reveal })

const measure = () => {
  const width = ruler.value?.clientWidth
  if (width) viewportWidth.value = width
}
onMounted(() => {
  measure()
  if (typeof ResizeObserver !== 'undefined' && ruler.value) {
    resizeObserver = new ResizeObserver(measure)
    resizeObserver.observe(ruler.value)
  }
  window.addEventListener('resize', measure)
})
onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  window.removeEventListener('resize', measure)
})
watch(
  [() => props.scrollLeft, maxScroll],
  () => {
    const next = clamp(0, maxScroll.value, props.scrollLeft)
    scrollTo(next)
    if (scrollbar.value) scrollbar.value.scrollLeft = next
  },
  { flush: 'post' },
)
watch(
  () => props.pixelsPerBeat,
  (next, previous) => scrollTo((props.scrollLeft / previous) * next),
)
watch(
  () => props.playhead,
  (beat) => {
    if (props.follow && props.playing) reveal(beat)
  },
)
const onScroll = () => {
  const left = scrollbar.value?.scrollLeft ?? 0
  // Browser scrolling rounds to physical pixels; don't mistake that for a manual pan.
  if (Math.abs(left - props.scrollLeft) < 1) return
  emit('update:follow', false)
  scrollTo(left)
}
const onWheel = (event: WheelEvent) => {
  if (event.ctrlKey || event.metaKey || event.altKey) return
  if (!(event.target as Element).closest('.lane, .ruler, .native-scroll')) return
  const delta = event.shiftKey ? event.deltaY || event.deltaX : event.deltaX
  if (!delta) return // Ordinary vertical scrolling still scrolls the track list.
  const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewportWidth.value : 1
  event.preventDefault()
  emit('update:follow', false)
  scrollTo(props.scrollLeft + delta * scale)
}
const seek = (event: PointerEvent) => {
  if (event.button !== 0) return
  const left = ruler.value?.getBoundingClientRect().left ?? 0
  emit('seek', Math.max(0, (event.clientX - left + props.scrollLeft) / props.pixelsPerBeat))
  ruler.value?.focus({ preventScroll: true })
}
const onRulerKey = (event: KeyboardEvent) => {
  if (event.ctrlKey || event.metaKey || event.altKey) return
  const step = event.shiftKey ? 4 : 1
  let beat: number
  if (event.key === 'ArrowLeft') beat = Math.max(0, props.playhead - step)
  else if (event.key === 'ArrowRight') beat = props.playhead + step
  else if (event.key === 'Home') beat = 0
  else if (event.key === 'End') beat = props.endBeat
  else return
  event.preventDefault()
  event.stopPropagation()
  emit('seek', beat)
  reveal(beat)
}
</script>

<template>
  <div class="arrangement-timeline" @wheel="onWheel">
    <div class="ruler-row">
      <span class="track-heading">TRACKS <small>Quarter-note beats →</small></span>
      <div
        ref="ruler"
        class="ruler"
        role="slider"
        tabindex="0"
        aria-label="Timeline playhead"
        aria-valuemin="0"
        :aria-valuemax="Math.max(endBeat, playhead, contentWidth / pixelsPerBeat)"
        :aria-valuenow="playhead"
        :aria-valuetext="`Beat ${playhead.toFixed(2)}`"
        title="Click to seek. Arrow keys move one beat; Shift moves four. Home / End jump."
        @pointerdown="seek"
        @keydown="onRulerKey"
      >
        <span
          v-for="mark in marks"
          :key="mark"
          class="ruler-mark"
          :style="{ left: `${mark * pixelsPerBeat - scrollLeft}px` }"
          >{{ mark }}</span
        >
        <span
          v-if="playheadX >= 0 && playheadX <= viewportWidth"
          class="playhead-cap"
          :style="{ left: `${playheadX}px` }"
          aria-hidden="true"
        />
      </div>
    </div>
    <div class="track-stack">
      <slot />
      <div class="playhead-clipper" aria-hidden="true">
        <div v-if="playheadX >= 0" class="playhead" :style="{ left: `${playheadX}px` }" />
      </div>
    </div>
    <div class="scroll-row">
      <span class="scroll-hint">Shift + wheel to pan</span>
      <div
        ref="scrollbar"
        class="native-scroll"
        role="region"
        tabindex="0"
        aria-label="Timeline scroll"
        @scroll="onScroll"
      >
        <div :style="{ width: `${contentWidth}px`, height: '1px' }" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.arrangement-timeline {
  min-width: 0;
}
.ruler-row,
.scroll-row {
  display: grid;
  grid-template-columns: var(--daw-track-width, 14rem) minmax(0, 1fr);
  background: var(--xenpaper-slate-875);
}
.ruler-row {
  position: sticky;
  top: 0;
  z-index: 3;
  border-bottom: 1px solid var(--xenpaper-slate-500);
}
.track-heading,
.scroll-hint {
  padding: 0.55rem 0.75rem;
  font-size: 0.7rem;
  color: var(--xenpaper-slate-400);
}
.track-heading {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  letter-spacing: 0.08em;
}
.track-heading small {
  letter-spacing: normal;
}
.ruler {
  position: relative;
  min-width: 0;
  height: 2.75rem;
  overflow: hidden;
  cursor: crosshair;
  touch-action: none;
}
.ruler-mark {
  position: absolute;
  top: 0.8rem;
  padding-left: 0.4rem;
  border-left: 1px solid var(--xenpaper-slate-450);
  font: 0.75rem monospace;
  height: 2rem;
  pointer-events: none;
}
.track-stack {
  position: relative;
  min-height: 9rem;
}
.playhead-clipper {
  position: absolute;
  inset: 0 0 0 var(--daw-track-width, 14rem);
  overflow: hidden;
  pointer-events: none;
  z-index: 2;
}
.playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--xenpaper-cyan);
}
.playhead-cap {
  position: absolute;
  bottom: 0;
  width: 0;
  height: 0;
  border: 5px solid transparent;
  border-top-color: var(--xenpaper-cyan);
  transform: translateX(-5px);
  pointer-events: none;
}
.scroll-row {
  position: sticky;
  bottom: 0;
  z-index: 3;
  border-top: 1px solid var(--xenpaper-slate-500);
}
.native-scroll {
  min-width: 0;
  overflow-x: scroll;
  scrollbar-color: var(--xenpaper-slate-450) var(--xenpaper-slate-925);
  align-self: center;
  padding-block: 5px;
}
</style>
