<script setup lang="ts">
import { ref } from 'vue'
import type { SourceClip } from '../../daw/project'

defineProps<{ clip?: SourceClip }>()
const emit = defineEmits<{ 'update-source': [source: string]; delete: [] }>()
const editor = ref<HTMLTextAreaElement>()
defineExpose({ focus: () => editor.value?.focus() })
</script>

<template>
  <section class="source-editor">
    <header>
      <h2>Clip source</h2>
      <button v-if="clip" type="button" aria-label="Delete clip" @click="emit('delete')">
        Delete
      </button>
    </header>
    <textarea
      v-if="clip"
      ref="editor"
      aria-label="Xenpaper clip source"
      :value="clip.source"
      rows="8"
      @input="emit('update-source', ($event.target as HTMLTextAreaElement).value)"
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
.source-editor textarea {
  box-sizing: border-box;
  width: 100%;
  font-family: monospace;
}
</style>
