<script setup lang="ts">
import { ref } from 'vue'
import { parse } from '../../xenpaper-lang'

const source = ref('C D E F G')

const logParsedOutput = () => {
  console.log(parse(source.value))
}
</script>

<template>
  <h1>xenpaper-lang testing</h1>
  <label for="xenpaper-source">Xenpaper source</label>
  <textarea id="xenpaper-source" v-model="source" rows="16" cols="80" />
  <button type="button" @click="logParsedOutput">Parse and log output</button>
</template>
