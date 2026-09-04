<script setup lang="ts">
import { computed, ref } from 'vue'
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
import { highlightXenpaper, type XenpaperHighlightToken } from '../xenpaperSyntaxHighlight'

const source = ref('C D E F G')
const notation = ref<StaffNotationShape>()
const pianoRoll = ref<BeatTimedScore>()
const pianoRollInspection = ref<PianoRollInspection>({ selected: [] })
const highlightedSource = ref<XenpaperHighlightToken[]>([])
const highlightError = ref<string>()
const updateHighlight = () => {
  try {
    const program = parse(source.value)
    highlightedSource.value = highlightXenpaper(program)
    highlightError.value = undefined
    return program
  } catch (error) {
    highlightedSource.value = source.value
      ? [{ kind: 'unparsed', text: source.value, start: 0, end: source.value.length }]
      : []
    highlightError.value = error instanceof Error ? error.message : String(error)
  }
}
const visibleHighlightTokens = computed(() =>
  highlightedSource.value.filter((token) => token.kind !== 'whitespace'),
)

const logAst = () => {
  const program = updateHighlight()
  if (program) console.log(program)
}

const logScoreShape = () => {
  const program = updateHighlight()
  if (!program) return
  console.log(evaluateProgramShape(program))
}

const populateStaff = () => {
  const program = updateHighlight()
  if (!program) return
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
        <button type="button" @click="logAst">Parse and log AST</button>
        <button type="button" @click="logScoreShape">Evaluate and log score shape</button>
        <button type="button" @click="populateStaff">Populate visualisers</button>
        <button type="button" @click="logStaffNotation">Log staff notation</button>
      </div>
      <section class="highlight-preview" aria-labelledby="highlight-preview-title">
        <h2 id="highlight-preview-title">Highlighted source</h2>
        <pre aria-label="Syntax-highlighted Xenpaper source"><code><span
          v-for="token in highlightedSource"
          :key="`${token.start}-${token.end}`"
          :class="`syntax-${token.kind}`"
          :data-highlight="token.kind"
        >{{ token.text }}</span></code></pre>
        <p v-if="highlightError" class="highlight-error" role="status">{{ highlightError }}</p>
      </section>
      <details class="highlight-debugger">
        <summary>Highlight debugger ({{ visibleHighlightTokens.length }} tokens)</summary>
        <table>
          <thead>
            <tr>
              <th>Range</th>
              <th>Kind</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="token in visibleHighlightTokens" :key="`${token.start}-${token.end}`">
              <td>{{ token.start }}–{{ token.end }}</td>
              <td>
                <span :class="['token-swatch', `syntax-${token.kind}`]">{{ token.kind }}</span>
              </td>
              <td>
                <code>{{ token.text }}</code>
              </td>
            </tr>
          </tbody>
        </table>
      </details>
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
  min-height: 100vh;
  grid-template-columns: minmax(16rem, 24rem) minmax(0, 1fr);
  grid-template-areas:
    'tutorial editor'
    'tutorial visualisers';
  gap: 1rem;
  align-items: start;
  padding: 1rem;
  color: var(--xenpaper-bg-light);
  background: var(--xenpaper-surface);
  font-family: var(--xenpaper-font-copy);
}

.testing-layout :deep(a) {
  color: var(--xenpaper-purple);
}

.testing-layout :deep(a:hover) {
  color: var(--xenpaper-purple);
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
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  font-family: var(--xenpaper-font-mono);
}

.highlight-preview,
.highlight-debugger {
  box-sizing: border-box;
  width: 100%;
}

.highlight-preview h2 {
  margin: 0 0 0.35rem;
  font-size: 1rem;
}

.highlight-preview pre {
  min-height: 5rem;
  max-height: 18rem;
  margin: 0;
  padding: 0.75rem;
  overflow: auto;
  border: 1px solid var(--xenpaper-border);
  border-radius: 0.25rem;
  background: var(--xenpaper-bg-editor);
  color: var(--xenpaper-text-soft);
  font-family: var(--xenpaper-font-mono);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  tab-size: 2;
}

.highlight-error {
  margin: 0.35rem 0 0;
  color: var(--xenpaper-red);
  font-size: 0.8rem;
}

.highlight-debugger summary {
  cursor: pointer;
  font-weight: 600;
}

.highlight-debugger table {
  width: 100%;
  margin-top: 0.5rem;
  border-collapse: collapse;
  font-size: 0.8rem;
}

.highlight-debugger th,
.highlight-debugger td {
  padding: 0.25rem 0.4rem;
  border-bottom: 1px solid var(--xenpaper-border);
  text-align: left;
  vertical-align: top;
}

.highlight-debugger td:first-child {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.token-swatch {
  display: inline-block;
  padding: 0.1rem 0.3rem;
  border-radius: 0.2rem;
  background: var(--xenpaper-bg-editor);
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

<style scoped src="../assets/syntax-highlight.css"></style>
