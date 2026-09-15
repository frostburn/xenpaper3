<script setup lang="ts">
import { ref } from 'vue'
import { beatToNumber, type SourceClip } from '../../daw/project'
import type { Diagnostic } from '../../../xenpaper-lang'
import type { SourceLineCaret } from '../../daw/score'
import XenpaperSourceEditor from './XenpaperSourceEditor.vue'

defineProps<{
  clip?: SourceClip
  laneName?: string
  sourceKey?: string
  drumSamples?: readonly string[]
  diagnostics?: readonly Diagnostic[]
  playingRanges?: readonly { readonly start: number; readonly end: number }[]
  lineCarets?: readonly SourceLineCaret[]
  solo?: boolean
}>()
const emit = defineEmits<{
  'update-source': [source: string, sourceKey?: string]
  delete: []
  duplicate: []
  play: []
  'play-from': [beat: number]
  'update:solo': [solo: boolean]
  stop: []
}>()
const editor = ref<InstanceType<typeof XenpaperSourceEditor>>()
defineExpose({ focus: () => editor.value?.focus() })
</script>

<template>
  <section class="source-editor">
    <header>
      <div>
        <p class="eyebrow">{{ laneName || 'CLIP EDITOR' }}</p>
        <h2>Clip source</h2>
        <p v-if="clip" class="clip-position">
          Beat {{ beatToNumber(clip.start) }} · {{ beatToNumber(clip.length) }} beats
        </p>
      </div>
      <div v-if="clip" class="clip-actions">
        <button type="button" aria-label="Play from clip start" @click="emit('play')">
          ▶ Play
        </button>
        <button
          type="button"
          class="solo-toggle"
          aria-label="Solo clip playback"
          :aria-pressed="solo || false"
          @click="emit('update:solo', !solo)"
        >
          Solo
        </button>
        <button type="button" aria-label="Stop clip playback" @click="emit('stop')">■ Stop</button>
        <button
          type="button"
          aria-label="Duplicate clip"
          title="Duplicate after this clip (Ctrl/⌘ D)"
          @click="emit('duplicate')"
        >
          Duplicate
        </button>
        <button type="button" aria-label="Delete clip" @click="emit('delete')">Delete</button>
      </div>
    </header>
    <XenpaperSourceEditor
      v-if="clip"
      ref="editor"
      editor-label="Xenpaper clip source"
      :source="clip.source"
      :source-key="sourceKey"
      :drum-samples="drumSamples"
      :diagnostics="diagnostics"
      :playing-ranges="playingRanges"
      :line-carets="lineCarets"
      :rows="14"
      @update:source="(source, sourceKey) => emit('update-source', source, sourceKey)"
      @play-from="emit('play-from', $event)"
    />
    <p v-if="clip" class="source-help">
      The source determines this clip’s length. Use a line wedge to play from its notes. Ctrl/⌘
      Enter plays from the clip; Solo applies to both.
    </p>
    <div v-else class="editor-empty">
      <strong>Make room for an idea.</strong>
      <p>
        Select or create a clip to edit its source here. Double-click a track or choose + Clip to
        start a new one.
      </p>
      <p>Drag clips to arrange them. Switch View to Source to read your score on the timeline.</p>
    </div>
  </section>
</template>

<style scoped>
.source-editor {
  min-width: 0;
}
.source-editor header {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin-bottom: 1rem;
}
.source-editor h2 {
  margin: 0.15rem 0;
  font-size: 1.15rem;
}
.eyebrow {
  margin: 0;
  font-size: 0.7rem;
  color: var(--xenpaper-cyan);
  overflow-wrap: anywhere;
}
.clip-position,
.source-help {
  color: var(--xenpaper-slate-400);
  font-size: 0.75rem;
  line-height: 1.6;
}
.clip-position {
  margin: 0.3rem 0 0;
}
.clip-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.solo-toggle[aria-pressed='true'] {
  color: var(--xenpaper-slate-950);
  background: var(--xenpaper-cyan);
}
.source-editor .xenpaper-source-editor {
  box-sizing: border-box;
  width: 100%;
  font-family: monospace;
}
.editor-empty {
  padding-block: 1rem;
  color: var(--xenpaper-slate-400);
  line-height: 1.7;
}
.editor-empty strong {
  color: var(--xenpaper-slate-100);
}
</style>
