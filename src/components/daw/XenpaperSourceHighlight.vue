<script setup lang="ts">
import { computed } from 'vue'
import { parse, type Diagnostic } from '../../../xenpaper-lang'
import { highlightXenpaper, type XenpaperHighlightToken } from '../../xenpaperSyntaxHighlight'

const props = defineProps<{
  source: string
  stableSource?: string
  drumSamples?: readonly string[]
  diagnostics?: readonly Diagnostic[]
}>()
let cachedSource: string | undefined
let cachedDrumSamples: readonly string[] | undefined
let cachedDiagnostics: readonly Diagnostic[] | undefined
let cachedTokens: XenpaperHighlightToken[] | undefined

const tokens = computed<XenpaperHighlightToken[]>(() => {
  if (!props.source) return []
  try {
    const parsedSource = props.stableSource ?? props.source
    let warnedTokens = cachedTokens
    if (
      parsedSource !== cachedSource ||
      props.drumSamples !== cachedDrumSamples ||
      props.diagnostics !== cachedDiagnostics ||
      !warnedTokens
    ) {
      const highlighted = highlightXenpaper(parse(parsedSource, { drumSamples: props.drumSamples }))
      const warningRanges = (props.diagnostics ?? [])
        .filter(({ code, severity }) => code === 'XP_BARLINE_OFF_CYCLE' && severity === 'warning')
        .flatMap(({ locations }) => locations)
      warnedTokens = warningRanges.length
        ? highlighted.flatMap((token) => {
            const boundaries = warningRanges
              .flatMap(({ start, end }) => [start.offset, end.offset])
              .filter((offset) => offset > token.start && offset < token.end)
            const offsets = [...new Set([token.start, ...boundaries, token.end])].sort(
              (left, right) => left - right,
            )
            return offsets.slice(0, -1).map((start, index) => {
              const end = offsets[index + 1]!
              const warning = warningRanges.some(
                (range) => start >= range.start.offset && end <= range.end.offset,
              )
              return {
                ...token,
                kind: warning ? ('warning' as const) : token.kind,
                text: parsedSource.slice(start, end),
                start,
                end,
              }
            })
          })
        : highlighted
      cachedSource = parsedSource
      cachedDrumSamples = props.drumSamples
      cachedDiagnostics = props.diagnostics
      cachedTokens = warnedTokens
    }
    if (parsedSource === props.source) return warnedTokens

    let prefixLength = 0
    while (
      prefixLength < parsedSource.length &&
      prefixLength < props.source.length &&
      parsedSource[prefixLength] === props.source[prefixLength]
    )
      prefixLength++
    let suffixLength = 0
    while (
      suffixLength < parsedSource.length - prefixLength &&
      suffixLength < props.source.length - prefixLength &&
      parsedSource[parsedSource.length - 1 - suffixLength] ===
        props.source[props.source.length - 1 - suffixLength]
    )
      suffixLength++

    const oldSuffixStart = parsedSource.length - suffixLength
    const newSuffixStart = props.source.length - suffixLength
    const preserved = warnedTokens.flatMap((token) => {
      const fragments: XenpaperHighlightToken[] = []
      const prefixEnd = Math.min(token.end, prefixLength)
      if (token.start < prefixEnd)
        fragments.push({
          ...token,
          text: props.source.slice(token.start, prefixEnd),
          end: prefixEnd,
        })
      const suffixStart = Math.max(token.start, oldSuffixStart)
      if (suffixStart < token.end) {
        const start = newSuffixStart + suffixStart - oldSuffixStart
        const end = newSuffixStart + token.end - oldSuffixStart
        fragments.push({ ...token, text: props.source.slice(start, end), start, end })
      }
      return fragments
    })
    if (prefixLength < newSuffixStart)
      preserved.push({
        kind: 'unparsed',
        text: props.source.slice(prefixLength, newSuffixStart),
        start: prefixLength,
        end: newSuffixStart,
      })
    return preserved.sort((left, right) => left.start - right.start)
  } catch {
    return [{ kind: 'unparsed', text: props.source, start: 0, end: props.source.length }]
  }
})
</script>

<template>
  <code class="xenpaper-source-highlight"
    ><span
      v-for="token in tokens"
      :key="`${token.start}-${token.end}`"
      :class="`syntax-${token.kind}`"
      :data-highlight="token.kind"
      >{{ token.text }}</span
    ></code
  >
</template>

<style scoped src="../../assets/syntax-highlight.css"></style>
