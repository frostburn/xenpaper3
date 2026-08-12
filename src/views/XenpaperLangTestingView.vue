<script setup lang="ts">
import { ref } from 'vue'
import { Fraction } from 'xen-dev-utils/fraction'
import {
  constructStaffNotationShape,
  expandToBeatEvents,
  evaluateScoreShape,
  parse,
  type StaffNotationShape,
  type BeatTimedScore,
} from '../../xenpaper-lang'
import MusicalStaff from '../components/MusicalStaff.vue'
import PianoRoll from '../components/PianoRoll.vue'
import type { PianoRollInspection } from '../components/PianoRoll.vue'
import PianoRollInspector from '../components/PianoRollInspector.vue'

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
  const results = program.body.map((expression) => evaluateScoreShape(expression))
  const diagnostics = results.flatMap((result) => result.diagnostics)
  const shapes = results.flatMap((result) => ('shape' in result ? [result.shape] : []))
  const children = shapes.map((shape) => constructStaffNotationShape(shape))
  notation.value =
    children.length === results.length
      ? children.length === 1
        ? children[0]
        : {
            kind: 'sequence',
            duration: shapes.reduce(
              (duration, shape) => duration.add(shape.duration),
              new Fraction(0),
            ),
            children,
          }
      : undefined
  if (diagnostics.length) console.warn(diagnostics)
}

const logStaffNotation = () => {
  console.log(notation.value)
}
</script>

<template>
  <h1>xenpaper-lang testing</h1>
  <div class="source-editor">
    <label for="xenpaper-source">Xenpaper source</label>
    <textarea id="xenpaper-source" v-model="source" rows="16" cols="80" />
    <div class="actions">
      <button type="button" @click="logParsedOutput">Parse and log output</button>
      <button type="button" @click="populateStaff">Populate visualisers</button>
      <button type="button" @click="logStaffNotation">Log staff notation</button>
    </div>
  </div>
  <PianoRoll :score="pianoRoll" @inspection-change="pianoRollInspection = $event" />
  <PianoRollInspector :inspection="pianoRollInspection" />
  <MusicalStaff :notation="notation" />
</template>

<style scoped>
.source-editor {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.5rem;
}

textarea {
  max-width: 100%;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
</style>
