<script setup lang="ts">
import { ref } from 'vue'
import {
  constructStaffNotationShape,
  evaluateScoreShape,
  parse,
  type StaffNotationShape,
} from '../../xenpaper-lang'
import MusicalStaff from '../components/MusicalStaff.vue'

const source = ref('C D E F G')
const notation = ref<StaffNotationShape>()

const logParsedOutput = () => {
  console.log(parse(source.value))
}

const populateStaff = () => {
  const program = parse(source.value)
  const expression = program.body[0]
  if (!expression) {
    notation.value = undefined
    return
  }
  const result = evaluateScoreShape(expression)
  notation.value = 'shape' in result ? constructStaffNotationShape(result.shape) : undefined
  if (result.diagnostics.length) console.warn(result.diagnostics)
}
</script>

<template>
  <h1>xenpaper-lang testing</h1>
  <label for="xenpaper-source">Xenpaper source</label>
  <textarea id="xenpaper-source" v-model="source" rows="16" cols="80" />
  <button type="button" @click="logParsedOutput">Parse and log output</button>
  <button type="button" @click="populateStaff">Populate staff</button>
  <MusicalStaff :notation="notation" />
</template>
