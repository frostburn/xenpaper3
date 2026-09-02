<script setup lang="ts">
import { computed } from 'vue'
import { parse, type Diagnostic } from '../../../xenpaper-lang'
import { highlightXenpaper, type XenpaperHighlightToken } from '../../xenpaperSyntaxHighlight'

const props = defineProps<{
  source: string
  unparsed?: boolean
  drumSamples?: readonly string[]
  diagnostics?: readonly Diagnostic[]
}>()
const tokens = computed<XenpaperHighlightToken[]>(() => {
  if (!props.source) return []
  if (props.unparsed)
    return [{ kind: 'unparsed', text: props.source, start: 0, end: props.source.length }]
  try {
    const highlighted = highlightXenpaper(parse(props.source, { drumSamples: props.drumSamples }))
    const warningRanges = (props.diagnostics ?? [])
      .filter(({ code, severity }) => code === 'XP_BARLINE_OFF_CYCLE' && severity === 'warning')
      .flatMap(({ locations }) => locations)
    if (!warningRanges.length) return highlighted
    return highlighted.flatMap((token) => {
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
          text: props.source.slice(start, end),
          start,
          end,
        }
      })
    })
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

<style scoped>
.xenpaper-source-highlight {
  color: #e6e9ef;
}
.syntax-comment {
  color: #8b949e;
  font-style: italic;
}
.syntax-directive,
.syntax-mos-hardness {
  color: #ff9e64;
}
.syntax-keyword,
.syntax-mos-declaration {
  color: #bb9af7;
  font-weight: 600;
}
.syntax-pitch,
.syntax-pitch-latin {
  color: #7dcfff;
}
.syntax-pitch-greek {
  color: #2ac3de;
}
.syntax-pitch-mos {
  color: #89ddff;
}
.syntax-number {
  color: #9ece6a;
}
.syntax-ratio {
  color: #73daca;
}
.syntax-rest {
  color: #c0caf5;
  font-weight: 600;
}
.syntax-mos-pattern,
.syntax-identifier {
  color: #e0af68;
}
.syntax-mos-udp,
.syntax-operator {
  color: #f7768e;
}
.syntax-punctuation {
  color: #a9b1d6;
}
.syntax-unparsed {
  color: #e6e9ef;
}
.syntax-warning {
  color: #ffd166;
  background: rgb(255 92 92 / 22%);
  text-decoration: underline wavy #ff6868;
  text-underline-offset: 0.15em;
}
</style>
