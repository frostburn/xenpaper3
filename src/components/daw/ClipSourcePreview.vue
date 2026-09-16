<script setup lang="ts">
import { computed } from 'vue'
import type { SourceRange } from '../../daw/score'
import XenpaperSourceHighlight from './XenpaperSourceHighlight.vue'

const LINES_PER_PAGE = 6
const PAGE_WIDTH_PX = 192

const props = defineProps<{
  source: string
  width: number
  drumSamples?: readonly string[]
  playingRanges?: readonly SourceRange[]
}>()

const pages = computed(() => {
  const boundaries = [0]
  for (let offset = 0, lines = 0; offset < props.source.length; offset++) {
    if (props.source[offset] !== '\n' || ++lines % LINES_PER_PAGE) continue
    boundaries.push(offset + 1)
  }
  if (boundaries[boundaries.length - 1] !== props.source.length)
    boundaries.push(props.source.length)
  if (boundaries.length === 1) boundaries.push(0)
  return boundaries.slice(0, -1).map((start, index) => ({
    start,
    end: boundaries[index + 1]!,
  }))
})

const repeatedPages = computed(() => {
  const cycleWidth = pages.value.length * PAGE_WIDTH_PX
  const repetitions = Math.max(1, Math.ceil(props.width / cycleWidth))
  return Array.from({ length: repetitions }, (_, repetition) =>
    pages.value.map((page, pageIndex) => ({
      ...page,
      key: `${repetition}-${pageIndex}`,
      cycleEnd: pageIndex === pages.value.length - 1,
    })),
  ).flat()
})
</script>

<template>
  <span class="clip-source-preview" aria-label="Paginated clip source">
    <span
      v-for="page in repeatedPages"
      :key="page.key"
      class="source-page"
      :class="{ 'cycle-end': page.cycleEnd }"
      ><XenpaperSourceHighlight
        :source="source"
        :start-offset="page.start"
        :end-offset="page.end"
        :drum-samples="drumSamples"
        :playing-ranges="playingRanges"
    /></span>
  </span>
</template>

<style scoped>
.clip-source-preview {
  display: flex;
  min-width: max-content;
  height: 100%;
}
.source-page {
  box-sizing: border-box;
  flex: 0 0 12rem;
  width: 12rem;
  padding: 0 0.35rem;
  overflow: hidden;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  border-right: 1px dashed var(--xenpaper-slate-450);
}
.source-page.cycle-end {
  border-right-style: solid;
}
</style>
