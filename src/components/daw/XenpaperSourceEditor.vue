<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import type { Diagnostic } from '../../../xenpaper-lang'
import XenpaperSourceHighlight from './XenpaperSourceHighlight.vue'

const props = withDefaults(
  defineProps<{
    source: string
    sourceKey?: string
    editorLabel: string
    rows?: number
    drumSamples?: readonly string[]
    diagnostics?: readonly Diagnostic[]
  }>(),
  { rows: 3 },
)
const emit = defineEmits<{ 'update:source': [source: string, sourceKey?: string] }>()
const textarea = ref<HTMLTextAreaElement>()
const scroll = ref({ left: 0, top: 0 })
const draft = ref(props.source)
let updateTimer: ReturnType<typeof setTimeout> | undefined
let pendingSourceKey: string | undefined

const LARGE_SOURCE_THRESHOLD = 20
const EDIT_DEBOUNCE_MS = 200

watch(
  () => props.source,
  (source) => {
    commitDraft()
    draft.value = source
  },
)

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
  if (draft.value.length <= LARGE_SOURCE_THRESHOLD) {
    emit('update:source', draft.value, props.sourceKey)
    return
  }
  // Parsing drives highlighting, diagnostics, clip sizing, and the piano roll. Keep
  // the textarea responsive and let that work happen once after a burst of typing.
  pendingSourceKey = props.sourceKey
  updateTimer = setTimeout(commitDraft, EDIT_DEBOUNCE_MS)
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
    <pre
      aria-hidden="true"
    ><XenpaperSourceHighlight :source="draft" :unparsed="Boolean(updateTimer)" :drum-samples="drumSamples" :diagnostics="diagnostics" :style="{
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
  padding: 0.35rem;
  border: 1px solid #667085;
  border-radius: 0.2rem;
  font: inherit;
  line-height: 1.2;
  tab-size: 2;
  white-space: pre;
}
.xenpaper-source-editor pre {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  background: #171b24;
  color: #e6e9ef;
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
  caret-color: #fff;
}
.xenpaper-source-editor textarea::selection {
  background: #526d9b;
  color: transparent;
}
</style>
