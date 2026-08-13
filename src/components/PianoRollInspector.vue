<script setup lang="ts">
import type { PianoRollInspection } from './PianoRoll.vue'

defineProps<{ inspection: PianoRollInspection }>()
</script>

<template>
  <aside class="inspector" aria-live="polite" aria-label="Piano roll inspector">
    <h2>Inspector</h2>
    <p v-if="inspection.inspected">
      Inspecting <strong>{{ inspection.inspected.label }}</strong>
    </p>
    <p v-else-if="inspection.selected.length">
      {{ inspection.selected.length }} note{{ inspection.selected.length === 1 ? '' : 's' }}
      selected
    </p>
    <p v-else class="empty">Hover over, click, or drag around notes to inspect them.</p>
    <details>
      <summary>Element details</summary>
      <p v-if="!inspection.inspected && !inspection.selected.length" class="details-placeholder">
        Select or hover over an element to see its details here.
      </p>
      <dl v-if="inspection.inspected" class="element-details">
        <dt>Type</dt>
        <dd>{{ inspection.inspected.kind }}</dd>
        <dt>Pitch type</dt>
        <dd>{{ inspection.inspected.pitchKind }}</dd>
        <dt>Pitch</dt>
        <dd>{{ inspection.inspected.cents.toFixed(2) }}¢</dd>
        <dt>Start</dt>
        <dd>{{ inspection.inspected.start }} beats</dd>
        <dt>Duration</dt>
        <dd>{{ inspection.inspected.duration }} beats</dd>
        <dt>End</dt>
        <dd>{{ inspection.inspected.end }} beats</dd>
        <dt>Dynamic</dt>
        <dd>{{ inspection.inspected.dynamic }}</dd>
        <template v-if="inspection.inspected.glissando">
          <dt>Glissando</dt>
          <dd>
            <span v-for="(segment, index) in inspection.inspected.glissando.segments" :key="index">
              {{ index ? '; ' : '' }}{{ segment.curve }}, {{ segment.fromCents.toFixed(2) }}¢ →
              {{ segment.toCents.toFixed(2) }}¢ from beat {{ segment.start }} over
              {{ segment.duration }} beats
            </span>
            <span v-if="inspection.inspected.glissando.holdDuration">
              ; hold for {{ inspection.inspected.glissando.holdDuration }} beats
            </span>
          </dd>
        </template>
      </dl>
      <ol v-if="inspection.selected.length" class="selected-elements">
        <li v-for="element in inspection.selected" :key="element.index">
          <strong>{{ element.label }}</strong>
          <span>{{ element.start }}–{{ element.end }} beats, {{ element.cents.toFixed(2) }}¢</span>
          <span>Dynamic: {{ element.dynamic }}</span>
          <span v-if="element.glissando">
            Glissando:
            <span v-for="(segment, segmentIndex) in element.glissando.segments" :key="segmentIndex">
              {{ segmentIndex ? '; ' : '' }}{{ segment.curve }}, {{ segment.fromCents.toFixed(2) }}¢
              → {{ segment.toCents.toFixed(2) }}¢ from beat {{ segment.start }} over
              {{ segment.duration }} beats
            </span>
            <template v-if="element.glissando.holdDuration">
              ; hold for {{ element.glissando.holdDuration }} beats
            </template>
          </span>
        </li>
      </ol>
    </details>
  </aside>
</template>

<style scoped>
.inspector {
  margin-top: 0.75rem;
  padding: 0.75rem 1rem;
  border: 1px solid #aaa;
  border-radius: 0.35rem;
  background: #fff;
}
h2,
p {
  margin: 0 0 0.5rem;
}
.empty {
  color: #666;
}
.details-placeholder {
  margin-top: 0.75rem;
  color: #666;
  font-style: italic;
}
summary {
  cursor: pointer;
  font-weight: 600;
}
dl {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 0.25rem 0.75rem;
}
dt {
  font-weight: 600;
}
dd {
  margin: 0;
}
.selected-elements {
  margin-bottom: 0;
}
.selected-elements li {
  margin-top: 0.35rem;
}
.selected-elements span {
  display: block;
  color: #555;
}
</style>
