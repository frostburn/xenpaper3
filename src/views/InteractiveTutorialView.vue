<script setup lang="ts">
import { ref } from 'vue'
import type { InstrumentSource } from '../daw/project'
import SnippetEditor from '../components/SnippetEditor.vue'

const melody = ref('0 2 4 5 7')
const chord = ref('[0,4,7]===')
const intervals = ref('1/1 5/4 3/2 2/1')
const melodyInstrument = ref<InstrumentSource>({
  type: 'patch',
  patchPreset: 'default',
  oscillatorType: 'triangle',
})
const chordInstrument = ref<InstrumentSource>({
  type: 'patch',
  patchPreset: 'unison',
  oscillatorType: 'sawtooth',
  numberOfVoices: 5,
})
const intervalsInstrument = ref<InstrumentSource>({
  type: 'patch',
  patchPreset: 'default',
  oscillatorType: 'sine',
})
const melodyGain = ref(0.5)
const chordGain = ref(0.35)
const intervalsGain = ref(0.5)
</script>

<template>
  <div class="tutorial">
    <h1>Interactive tutorial</h1>
    <section aria-labelledby="melody-heading">
      <h2 id="melody-heading">Melody</h2>
      <SnippetEditor
        simplified
        :rows="3"
        editor-label="Melody source"
        v-model:source="melody"
        v-model:instrument="melodyInstrument"
        v-model:gain="melodyGain"
        lane-source="{12edo} @adsr(10ms, 100ms, 70%, 100ms)"
      />
    </section>
    <section aria-labelledby="chord-heading">
      <h2 id="chord-heading">Chord</h2>
      <SnippetEditor
        simplified
        :rows="3"
        editor-label="Chord source"
        v-model:source="chord"
        v-model:instrument="chordInstrument"
        v-model:gain="chordGain"
        lane-source="{12edo} @adsr(100ms, 200ms, 70%, 300ms) @spread(12c)"
      />
    </section>
    <section aria-labelledby="intervals-heading">
      <h2 id="intervals-heading">Intervals</h2>
      <SnippetEditor
        simplified
        :rows="3"
        editor-label="Intervals source"
        v-model:source="intervals"
        v-model:instrument="intervalsInstrument"
        v-model:gain="intervalsGain"
        lane-source="@adsr(10ms, 100ms, 70%, 100ms)"
      />
    </section>
  </div>
</template>

<style scoped>
.tutorial {
  max-width: 54rem;
  margin: auto;
  padding: 1.5rem;
}
h1 {
  margin: 0 0 1.5rem;
  font-size: 1.6rem;
}
h2 {
  margin: 0 0 1rem;
  font-size: 1.15rem;
}
.tutorial > section {
  min-width: 0;
  margin-bottom: 1.5rem;
  padding-bottom: 1.5rem;
  border-bottom: 1px solid var(--xenpaper-slate-500);
}
@media (max-width: 760px) {
  .tutorial {
    padding: 1rem;
  }
}
</style>
