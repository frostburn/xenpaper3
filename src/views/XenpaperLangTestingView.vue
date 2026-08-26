<script setup lang="ts">
import { computed, ref } from 'vue'
import { compile, parse, type Diagnostic, type MonomialGrid } from '../../xenpaper-lang/core'
import TutorialSidebar from '../components/TutorialSidebar.vue'
import MusicalStaff from '../components/MusicalStaff.vue'
import { projectGridToStaffNotation } from '../music/staff-notation-projection'
import { highlightXenpaper, type XenpaperHighlightToken } from '../xenpaperSyntaxHighlight'

const source = ref('C D E F G')
const grid = ref<MonomialGrid>()
const diagnostics = ref<readonly Diagnostic[]>([])
const highlightedSource = ref<XenpaperHighlightToken[]>([])
const highlightError = ref<string>()

const visibleHighlightTokens = computed(() =>
  highlightedSource.value.filter((token) => token.kind !== 'whitespace'),
)
const notes = computed(() => grid.value?.events.filter((event) => event.kind === 'note') ?? [])
const staffNotation = computed(() =>
  grid.value ? projectGridToStaffNotation(grid.value) : undefined,
)

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

const compileSource = () => {
  updateHighlight()
  const result = compile(source.value)
  diagnostics.value = result.diagnostics
  grid.value = 'grid' in result ? result.grid : undefined
  return result
}

const compileAndLog = () => console.log(compileSource())
const loadTutorialTune = (tune: string) => {
  source.value = tune
  compileSource()
}
const formatExact = (value: { toString(): string }) => value.toString()
const formatPitch = (pitch: (typeof notes.value)[number]['pitch']) =>
  pitch.sounding.toMonzoLiteral()
</script>

<template>
  <h1>xenpaper-lang exact-grid debugger</h1>
  <div class="testing-layout">
    <div class="source-editor">
      <label for="xenpaper-source">Xenpaper source</label>
      <textarea id="xenpaper-source" v-model="source" rows="16" cols="80" />
      <div class="actions">
        <button type="button" @click="compileSource">Compile exact grid</button>
        <button type="button" @click="compileAndLog">Compile and log result</button>
      </div>
      <section class="highlight-preview" aria-labelledby="highlight-preview-title">
        <h2 id="highlight-preview-title">Highlighted source</h2>
        <pre aria-label="Syntax-highlighted Xenpaper source"><code><span
          v-for="token in highlightedSource"
          :key="`${token.start}-${token.end}`"
          :class="`syntax-${token.kind}`"
          :data-highlight="token.kind"
        >{{ token.text }}</span></code></pre>
        <p v-if="highlightError" class="error" role="status">{{ highlightError }}</p>
      </section>
      <details class="highlight-debugger">
        <summary>Highlight tokens ({{ visibleHighlightTokens.length }})</summary>
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
    <section class="grid-debugger" aria-labelledby="grid-title">
      <h2 id="grid-title">Exact score grid</h2>
      <p v-if="grid" class="grid-summary">
        Span: {{ formatExact(grid.span) }} beats · {{ grid.events.length }} events
      </p>
      <p v-else>No grid compiled.</p>
      <table v-if="notes.length">
        <thead>
          <tr>
            <th>Start</th>
            <th>Duration</th>
            <th>Exact sounding pitch</th>
            <th>Kind</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(note, index) in notes" :key="index">
            <td>{{ formatExact(note.start) }}</td>
            <td>{{ formatExact(note.duration) }}</td>
            <td>
              <code>{{ formatPitch(note.pitch) }}</code>
            </td>
            <td>{{ note.pitch.kind }}</td>
          </tr>
        </tbody>
      </table>
      <ul v-if="diagnostics.length" class="diagnostics" aria-label="Compiler diagnostics">
        <li v-for="(diagnostic, index) in diagnostics" :key="index" :class="diagnostic.severity">
          <code>{{ diagnostic.code }}</code> {{ diagnostic.message }}
        </li>
      </ul>
      <section class="staff-debugger" aria-labelledby="staff-title">
        <h2 id="staff-title">Staff notation projection</h2>
        <MusicalStaff :notation="staffNotation" />
      </section>
    </section>
  </div>
</template>

<style scoped>
.testing-layout {
  display: grid;
  grid-template-columns: minmax(16rem, 24rem) minmax(0, 1fr);
  grid-template-areas: 'tutorial editor' 'tutorial grid';
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
.grid-debugger {
  grid-area: grid;
  min-width: 0;
}
textarea {
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.highlight-preview,
.highlight-debugger {
  box-sizing: border-box;
  width: 100%;
}
.highlight-preview h2,
.grid-debugger h2 {
  margin: 0 0 0.35rem;
  font-size: 1rem;
}
.highlight-preview pre {
  min-height: 5rem;
  max-height: 18rem;
  margin: 0;
  padding: 0.75rem;
  overflow: auto;
  border: 1px solid #667085;
  border-radius: 0.25rem;
  background: #171b24;
  color: #e6e9ef;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  tab-size: 2;
}
.syntax-comment {
  color: #8b949e;
  font-style: italic;
}
.syntax-directive {
  color: #ff9e64;
}
.syntax-keyword,
.syntax-mos-declaration {
  color: #bb9af7;
  font-weight: 600;
}
.syntax-pitch,
.syntax-pitch-latin {
  color: #7dcfff;
}
.syntax-pitch-greek {
  color: #2ac3de;
}
.syntax-pitch-mos {
  color: #89ddff;
}
.syntax-number {
  color: #9ece6a;
}
.syntax-ratio {
  color: #73daca;
}
.syntax-rest {
  color: #c0caf5;
  font-weight: 600;
}
.syntax-mos-pattern,
.syntax-identifier {
  color: #e0af68;
}
.syntax-mos-udp,
.syntax-operator {
  color: #f7768e;
}
.syntax-mos-hardness {
  color: #ff9e64;
  font-weight: 600;
}
.syntax-punctuation {
  color: #a9b1d6;
}
.syntax-unparsed {
  color: #e6e9ef;
}
.error,
.diagnostics .error {
  color: #b42318;
}
.highlight-debugger summary {
  cursor: pointer;
  font-weight: 600;
}
table {
  width: 100%;
  margin-top: 0.5rem;
  border-collapse: collapse;
  font-size: 0.8rem;
}
th,
td {
  padding: 0.25rem 0.4rem;
  border-bottom: 1px solid #d0d5dd;
  text-align: left;
  vertical-align: top;
}
.highlight-debugger td:first-child,
.grid-debugger td:first-child {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.token-swatch {
  display: inline-block;
  padding: 0.1rem 0.3rem;
  border-radius: 0.2rem;
  background: #171b24;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.grid-summary {
  font-variant-numeric: tabular-nums;
}
@media (max-width: 800px) {
  .testing-layout {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: 'tutorial' 'editor' 'grid';
  }
  .testing-layout :deep(.tutorial-sidebar) {
    position: static;
    max-height: 32rem;
  }
}
</style>
