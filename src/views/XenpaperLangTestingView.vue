<script setup lang="ts">
import { ref } from 'vue'
import {
  constructStaffNotationShape,
  expandToBeatEvents,
  evaluateProgramShape,
  parse,
  type StaffNotationShape,
  type BeatTimedScore,
} from '../../xenpaper-lang'
import MusicalStaff from '../components/MusicalStaff.vue'
import PianoRoll from '../components/PianoRoll.vue'
import type { PianoRollInspection } from '../components/PianoRoll.vue'
import PianoRollInspector from '../components/PianoRollInspector.vue'
import TutorialSidebar from '../components/TutorialSidebar.vue'

const source = ref('C D E F G')
const notation = ref<StaffNotationShape>()
const pianoRoll = ref<BeatTimedScore>()
const pianoRollInspection = ref<PianoRollInspection>({ selected: [] })

const logParsedOutput = () => {
  console.log(parse(source.value))
}

const populateStaff = () => {
  const program = parse(source.value)
  const expanded = expandToBeatEvents(program)
  pianoRoll.value = 'score' in expanded ? expanded.score : undefined
  if (!('score' in expanded)) {
    notation.value = undefined
    if (expanded.diagnostics.length) console.warn(expanded.diagnostics)
    return
  }
  if (!program.body.length) {
    notation.value = undefined
    return
  }
  const result = evaluateProgramShape(program)
  notation.value = 'shape' in result ? constructStaffNotationShape(result.shape) : undefined
  if (result.diagnostics.length) console.warn(result.diagnostics)
}

const loadTutorialTune = (tune: string) => {
  source.value = tune
  populateStaff()
}

const logStaffNotation = () => {
  console.log(notation.value)
}
</script>

<template>
  <h1>xenpaper-lang testing</h1>
  <div class="testing-layout">
    <div class="source-editor">
      <label for="xenpaper-source">Xenpaper source</label>
      <textarea id="xenpaper-source" v-model="source" rows="16" cols="80" />
      <div class="actions">
        <button type="button" @click="logParsedOutput">Parse and log output</button>
        <button type="button" @click="populateStaff">Populate visualisers</button>
        <button type="button" @click="logStaffNotation">Log staff notation</button>
      </div>
    </div>
    <TutorialSidebar @select-tune="loadTutorialTune" />
    <div class="visualisers">
      <PianoRoll :score="pianoRoll" @inspection-change="pianoRollInspection = $event" />
      <PianoRollInspector :inspection="pianoRollInspection" />
      <MusicalStaff :notation="notation" />
    </div>
  </div>
</template>

<style scoped>
.testing-layout {
  display: grid;
  grid-template-columns: minmax(16rem, 24rem) minmax(0, 1fr);
  grid-template-areas:
    'tutorial editor'
    'tutorial visualisers';
  gap: 1rem;
  align-items: start;
}

.source-editor {
  grid-area: editor;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.5rem;
}

.testing-layout :deep(.tutorial-sidebar) {
  grid-area: tutorial;
  position: sticky;
  top: 1rem;
}

.visualisers {
  display: grid;
  grid-area: visualisers;
  gap: 1rem;
  min-width: 0;
}

textarea {
  max-width: 100%;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

@media (max-width: 800px) {
  .testing-layout {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: 'tutorial' 'editor' 'visualisers';
  }

  .testing-layout :deep(.tutorial-sidebar) {
    position: static;
    max-height: 32rem;
  }
}
</style>
