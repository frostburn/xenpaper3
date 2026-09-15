<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import type { Diagnostic } from '../../../xenpaper-lang'
import type { SourceLineCaret } from '../../daw/score'
import XenpaperSourceHighlight from './XenpaperSourceHighlight.vue'

const props = withDefaults(
  defineProps<{
    source: string
    sourceKey?: string
    editorLabel: string
    rows?: number
    drumSamples?: readonly string[]
    diagnostics?: readonly Diagnostic[]
    playingRanges?: readonly { readonly start: number; readonly end: number }[]
    lineCarets?: readonly SourceLineCaret[]
  }>(),
  { rows: 3 },
)
const emit = defineEmits<{
  'update:source': [source: string, sourceKey?: string]
  'play-from': [beat: number]
}>()
const textarea = ref<HTMLTextAreaElement>()
const scroll = ref({ left: 0, top: 0 })
const draft = ref(props.source)
let updateTimer: ReturnType<typeof setTimeout> | undefined
let pendingSourceKey: string | undefined

const EDIT_DEBOUNCE_MS = 200

watch([() => props.source, () => props.sourceKey], ([source]) => {
  commitDraft()
  draft.value = source
})

function commitDraft() {
  if (!updateTimer) return
  clearTimeout(updateTimer)
  updateTimer = undefined
  emit('update:source', draft.value, pendingSourceKey)
  pendingSourceKey = undefined
}

const updateDraft = (event: Event) => {
  draft.value = (event.target as HTMLTextAreaElement).value
  if (updateTimer) clearTimeout(updateTimer)
  // Parsing drives highlighting, diagnostics, clip sizing, and the piano roll. Keep
  // the textarea responsive and let that work happen once after a burst of typing.
  pendingSourceKey = props.sourceKey
  updateTimer = setTimeout(commitDraft, EDIT_DEBOUNCE_MS)
}

// Flush before the DAW's window-level save/play shortcut sees the event. Do not
// consume it here: the source editor also appears outside the DAW.
const commitBeforeCommand = (event: KeyboardEvent) => {
  if (event.isComposing || !(event.ctrlKey || event.metaKey)) return
  if (event.key.toLowerCase() === 's' || event.key === 'Enter') commitDraft()
}

const syncScroll = (event: Event) => {
  const editor = event.currentTarget as HTMLTextAreaElement
  scroll.value = { left: editor.scrollLeft, top: editor.scrollTop }
}

defineExpose({ focus: () => textarea.value?.focus() })
onBeforeUnmount(() => {
  commitDraft()
})
</script>

<template>
  <div class="xenpaper-source-editor">
    <div
      v-if="lineCarets?.length"
      class="line-carets"
      aria-label="Play from source line"
      :style="{ transform: `translateY(${-scroll.top}px)` }"
    >
      <button
        v-for="lineCaret in lineCarets"
        :key="lineCaret.line"
        type="button"
        class="line-caret"
        :style="{ top: `calc(0.35rem + ${lineCaret.line * 1.2}em)` }"
        :aria-label="`Play from line ${lineCaret.line + 1}`"
        :title="`Play from line ${lineCaret.line + 1}`"
        @click="emit('play-from', lineCaret.beat)"
      >
        ▶
      </button>
    </div>
    <pre
      aria-hidden="true"
    ><XenpaperSourceHighlight :source="draft" :stable-source="updateTimer ? source : undefined" :drum-samples="drumSamples" :diagnostics="diagnostics" :playing-ranges="playingRanges" :style="{
      transform: `translate(${-scroll.left}px, ${-scroll.top}px)`,
    }" /></pre>
    <textarea
      ref="textarea"
      :aria-label="editorLabel"
      :rows="rows"
      :value="draft"
      wrap="off"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      @input="updateDraft"
      @keydown="commitBeforeCommand"
      @blur="commitDraft"
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
  padding: 0.35rem 0.35rem 0.35rem 1.65rem;
  border: 1px solid var(--xenpaper-slate-500);
  border-radius: 0.2rem;
  font: inherit;
  font-family: var(--xenpaper-font-mono);
  line-height: 1.2;
  tab-size: 2;
  white-space: pre;
}
.line-carets {
  position: absolute;
  z-index: 2;
  top: 0;
  left: 0;
  width: 1.5rem;
  pointer-events: none;
}
.line-caret {
  position: absolute;
  left: 0.35rem;
  box-sizing: border-box;
  width: 0.8rem;
  height: 1.2em;
  padding: 0;
  border: 0;
  color: var(--xenpaper-cyan);
  font: inherit;
  font-size: 0.75em;
  line-height: 1.2;
  background: transparent;
  cursor: pointer;
  pointer-events: auto;
}
.line-caret:hover,
.line-caret:focus-visible {
  color: var(--xenpaper-white);
  filter: drop-shadow(0 0 0.2rem var(--xenpaper-cyan));
}
.xenpaper-source-editor pre {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  background: var(--xenpaper-slate-900);
  color: var(--xenpaper-slate-100);
}
.xenpaper-source-editor .xenpaper-source-highlight {
  display: block;
  width: max-content;
  min-width: 100%;
  transform-origin: top left;
}
.xenpaper-source-editor textarea {
  position: relative;
  display: block;
  resize: vertical;
  overflow: auto;
  background: transparent;
  color: transparent;
  caret-color: var(--xenpaper-white);
}
.xenpaper-source-editor textarea::selection {
  background: var(--xenpaper-blue);
  color: transparent;
}
</style>
