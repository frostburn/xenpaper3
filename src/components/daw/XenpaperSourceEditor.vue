<script setup lang="ts">
import { computed, ref } from 'vue'
import { parse } from '../../../xenpaper-lang'
import {
  highlightXenpaper,
  type XenpaperHighlightToken,
} from '../../xenpaperSyntaxHighlight'

const props = withDefaults(
  defineProps<{ source: string; editorLabel: string; rows?: number }>(),
  { rows: 3 },
)
const emit = defineEmits<{ 'update:source': [source: string] }>()
const textarea = ref<HTMLTextAreaElement>()
const highlight = ref<HTMLElement>()

const tokens = computed<XenpaperHighlightToken[]>(() => {
  if (!props.source) return []
  try {
    return highlightXenpaper(parse(props.source))
  } catch {
    return [{ kind: 'unparsed', text: props.source, start: 0, end: props.source.length }]
  }
})

const syncScroll = () => {
  if (!textarea.value || !highlight.value) return
  highlight.value.scrollTop = textarea.value.scrollTop
  highlight.value.scrollLeft = textarea.value.scrollLeft
}

defineExpose({ focus: () => textarea.value?.focus() })
</script>

<template>
  <div class="xenpaper-source-editor">
    <pre ref="highlight" aria-hidden="true"><code><span
      v-for="token in tokens"
      :key="`${token.start}-${token.end}`"
      :class="`syntax-${token.kind}`"
      :data-highlight="token.kind"
    >{{ token.text }}</span></code></pre>
    <textarea
      ref="textarea"
      :aria-label="editorLabel"
      :rows="rows"
      :value="source"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      @input="emit('update:source', ($event.target as HTMLTextAreaElement).value)"
      @scroll="syncScroll"
    />
  </div>
</template>

<style scoped>
.xenpaper-source-editor {
  position: relative;
  min-width: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.xenpaper-source-editor pre,
.xenpaper-source-editor textarea {
  box-sizing: border-box;
  width: 100%;
  min-height: 100%;
  margin: 0;
  padding: 0.35rem;
  overflow: auto;
  border: 1px solid #667085;
  border-radius: 0.2rem;
  font: inherit;
  line-height: 1.2;
  tab-size: 2;
  white-space: pre-wrap;
  overflow-wrap: normal;
}
.xenpaper-source-editor pre {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: #171b24;
  color: #e6e9ef;
}
.xenpaper-source-editor textarea {
  position: relative;
  display: block;
  resize: vertical;
  background: transparent;
  color: transparent;
  caret-color: #fff;
}
.xenpaper-source-editor textarea::selection {
  background: #526d9b;
  color: transparent;
}
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
