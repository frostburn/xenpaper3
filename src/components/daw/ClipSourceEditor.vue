<script setup lang="ts">
import { ref } from 'vue'
import type { SourceClip } from '../../daw/project'
import type { Diagnostic } from '../../../xenpaper-lang'
import XenpaperSourceEditor from './XenpaperSourceEditor.vue'

defineProps<{
  clip?: SourceClip
  drumSamples?: readonly string[]
  diagnostics?: readonly Diagnostic[]
}>()
const emit = defineEmits<{
  'update-source': [source: string, clipId?: string]
  delete: []
  play: []
  'play-solo': []
  stop: []
}>()
const editor = ref<InstanceType<typeof XenpaperSourceEditor>>()
defineExpose({ focus: () => editor.value?.focus() })
</script>

<template>
  <section class="source-editor">
    <header>
      <h2>Clip source</h2>
      <div v-if="clip" class="clip-actions">
        <button type="button" aria-label="Play from clip start" @click="emit('play')">
          ▶ Play
        </button>
        <button
          type="button"
          aria-label="Play clip solo from clip start"
          @click="emit('play-solo')"
        >
          ▶ Solo
        </button>
        <button type="button" aria-label="Stop clip playback" @click="emit('stop')">■ Stop</button>
        <button type="button" aria-label="Delete clip" @click="emit('delete')">Delete</button>
      </div>
    </header>
    <XenpaperSourceEditor
      v-if="clip"
      ref="editor"
      editor-label="Xenpaper clip source"
      :source="clip.source"
      :source-key="clip.id"
      :drum-samples="drumSamples"
      :diagnostics="diagnostics"
      :rows="8"
      @update:source="(source, clipId) => emit('update-source', source, clipId)"
    />
    <p v-else>Select or create a clip to edit its Xenpaper source.</p>
  </section>
</template>

<style scoped>
.source-editor header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.clip-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.source-editor .xenpaper-source-editor {
  box-sizing: border-box;
  width: 100%;
  font-family: monospace;
}
</style>
