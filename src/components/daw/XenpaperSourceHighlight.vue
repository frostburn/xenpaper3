<script setup lang="ts">
import { computed } from 'vue'
import { parse } from '../../../xenpaper-lang'
import {
  highlightXenpaper,
  type XenpaperHighlightToken,
} from '../../xenpaperSyntaxHighlight'

const props = defineProps<{ source: string }>()
const tokens = computed<XenpaperHighlightToken[]>(() => {
  if (!props.source) return []
  try {
    return highlightXenpaper(parse(props.source))
  } catch {
    return [{ kind: 'unparsed', text: props.source, start: 0, end: props.source.length }]
  }
})
</script>

<template>
  <code class="xenpaper-source-highlight"><span
    v-for="token in tokens"
    :key="`${token.start}-${token.end}`"
    :class="`syntax-${token.kind}`"
    :data-highlight="token.kind"
  >{{ token.text }}</span></code>
</template>

<style scoped>
.xenpaper-source-highlight { color: #e6e9ef; }
.syntax-comment { color: #8b949e; font-style: italic; }
.syntax-directive, .syntax-mos-hardness { color: #ff9e64; }
.syntax-keyword, .syntax-mos-declaration { color: #bb9af7; font-weight: 600; }
.syntax-pitch, .syntax-pitch-latin { color: #7dcfff; }
.syntax-pitch-greek { color: #2ac3de; }
.syntax-pitch-mos { color: #89ddff; }
.syntax-number { color: #9ece6a; }
.syntax-ratio { color: #73daca; }
.syntax-rest { color: #c0caf5; font-weight: 600; }
.syntax-mos-pattern, .syntax-identifier { color: #e0af68; }
.syntax-mos-udp, .syntax-operator { color: #f7768e; }
.syntax-punctuation { color: #a9b1d6; }
.syntax-unparsed { color: #e6e9ef; }
</style>
