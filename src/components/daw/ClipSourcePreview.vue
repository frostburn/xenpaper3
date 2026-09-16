<script setup lang="ts">
import { computed } from 'vue'
import { parse } from '../../../xenpaper-lang'
import type { SourceRange } from '../../daw/score'
import { highlightXenpaper, type XenpaperHighlightToken } from '../../xenpaperSyntaxHighlight'

const COLUMNS_PER_PAGE = 24
const CHARACTER_WIDTH_PX = 8
const PAGE_HORIZONTAL_PADDING_PX = 12
const MIN_PAGE_WIDTH_PX = 128

const props = defineProps<{
  source: string
  width: number
  visibleStart?: number
  visibleWidth?: number
  drumSamples?: readonly string[]
  playingRanges?: readonly SourceRange[]
}>()

const tokens = computed<XenpaperHighlightToken[]>(() => {
  if (!props.source) return []
  try {
    return highlightXenpaper(parse(props.source, { drumSamples: props.drumSamples }))
  } catch {
    return [{ kind: 'unparsed', text: props.source, start: 0, end: props.source.length }]
  }
})

const lines = computed(() => {
  let start = 0
  return props.source.split('\n').map((text) => {
    const line = { start, length: text.length }
    start += text.length + 1
    return line
  })
})

const sourcePages = computed(() => {
  const count = Math.max(
    1,
    Math.ceil(Math.max(...lines.value.map(({ length }) => length)) / COLUMNS_PER_PAGE),
  )
  return Array.from({ length: count }, (_, pageIndex) => {
    const pageLines = lines.value.map((line) => ({
      start: line.start + Math.min(line.length, pageIndex * COLUMNS_PER_PAGE),
      end: line.start + Math.min(line.length, (pageIndex + 1) * COLUMNS_PER_PAGE),
    }))
    const columns = Math.max(...pageLines.map(({ start, end }) => end - start))
    return {
      pageIndex,
      lines: pageLines,
      width: Math.max(MIN_PAGE_WIDTH_PX, columns * CHARACTER_WIDTH_PX + PAGE_HORIZONTAL_PADDING_PX),
    }
  })
})

const fragments = (range: SourceRange) =>
  tokens.value.flatMap((token) => {
    const start = Math.max(token.start, range.start)
    const end = Math.min(token.end, range.end)
    if (start >= end) return []
    return [
      {
        ...token,
        text: props.source.slice(start, end),
        start,
        end,
        playing: (props.playingRanges ?? []).some(
          (playingRange) => start >= playingRange.start && end <= playingRange.end,
        ),
      },
    ]
  })

const renderedPages = computed(() => {
  const cycleWidth = sourcePages.value.reduce((total, page) => total + page.width, 0)
  const visibleStart = props.visibleStart ?? 0
  const visibleWidth = props.visibleWidth ?? props.width
  const visibleEnd = Math.min(props.width, visibleStart + visibleWidth)
  let cycle = Math.floor(visibleStart / cycleWidth)
  let left = cycle * cycleWidth
  let pageIndex = 0
  while (left + sourcePages.value[pageIndex]!.width <= visibleStart) {
    left += sourcePages.value[pageIndex]!.width
    if (++pageIndex === sourcePages.value.length) {
      pageIndex = 0
      cycle++
    }
  }

  const result = []
  while (left < visibleEnd) {
    const sourcePage = sourcePages.value[pageIndex]!
    result.push({
      ...sourcePage,
      key: `${cycle}-${pageIndex}`,
      left,
      cycleEnd: pageIndex === sourcePages.value.length - 1,
    })
    left += sourcePage.width
    if (++pageIndex === sourcePages.value.length) {
      pageIndex = 0
      cycle++
    }
  }
  return result
})
</script>

<template>
  <span class="clip-source-preview">
    <span class="source-full-text">{{ source }}</span>
    <span
      v-for="page in renderedPages"
      :key="page.key"
      class="source-page"
      :class="{ 'cycle-end': page.cycleEnd }"
      :style="{ left: `${page.left}px`, width: `${page.width}px` }"
      aria-hidden="true"
      ><span v-for="(line, lineIndex) in page.lines" :key="lineIndex" class="source-line"
        ><span
          v-for="token in fragments(line)"
          :key="`${token.start}-${token.end}`"
          :class="[`syntax-${token.kind}`, { 'source-playing': token.playing }]"
          :data-highlight="token.kind"
          :data-playing="token.playing || undefined"
          >{{ token.text }}</span
        ></span
      ></span
    >
  </span>
</template>

<style scoped src="../../assets/syntax-highlight.css"></style>
<style scoped>
.clip-source-preview {
  position: relative;
  display: block;
  height: 100%;
}
.source-full-text {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: pre;
  border: 0;
}
.source-page {
  position: absolute;
  top: 0;
  bottom: 0;
  box-sizing: border-box;
  padding: 0 0.35rem;
  overflow: hidden;
  border-right: 1px dashed var(--xenpaper-slate-450);
}
.source-page.cycle-end {
  border-right-style: solid;
}
.source-line {
  display: block;
  height: 1.2em;
  overflow: hidden;
  white-space: pre;
}
.source-playing {
  color: var(--xenpaper-slate-950);
  background: var(--xenpaper-cyan);
  border-radius: 0.12em;
}
</style>
