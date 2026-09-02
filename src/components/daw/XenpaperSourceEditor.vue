<script setup lang="ts">
import { ref } from 'vue'
import XenpaperSourceHighlight from './XenpaperSourceHighlight.vue'

withDefaults(
  defineProps<{ source: string; editorLabel: string; rows?: number }>(),
  { rows: 3 },
)
const emit = defineEmits<{ 'update:source': [source: string] }>()
const textarea = ref<HTMLTextAreaElement>()
const scroll = ref({ left: 0, top: 0 })

const syncScroll = (event: Event) => {
  const editor = event.currentTarget as HTMLTextAreaElement
  scroll.value = { left: editor.scrollLeft, top: editor.scrollTop }
}

defineExpose({ focus: () => textarea.value?.focus() })
</script>

<template>
  <div class="xenpaper-source-editor">
    <pre aria-hidden="true"><XenpaperSourceHighlight :source="source" :style="{
      transform: `translate(${-scroll.left}px, ${-scroll.top}px)`,
    }" /></pre>
    <textarea
      ref="textarea"
      :aria-label="editorLabel"
      :rows="rows"
      :value="source"
      wrap="off"
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
