<script setup lang="ts">
import type { DawProject, EffectLane, InstrumentLane } from '../../daw/project'

defineProps<{ project: DawProject }>()
const emit = defineEmits<{
  'add-effect': []
  'delete-effect': [effect: EffectLane]
  'update-route': [lane: InstrumentLane, effectBusId: string | undefined]
}>()
</script>

<template>
  <section class="mixer" aria-label="Mixer">
    <div class="channel-bank">
      <article v-for="lane in project.instrumentLanes" :key="lane.id" class="channel-strip">
        <span class="channel-kind">{{ lane.kind === 'drum' ? 'DRUMS' : 'INSTRUMENT' }}</span>
        <h2>{{ lane.name }}</h2>
        <label>
          Level
          <input
            v-model.number="lane.gain"
            :aria-label="`${lane.name} mixer level`"
            type="range"
            min="0"
            max="1.5"
            step="0.01"
          />
          <output>{{ Math.round(lane.gain * 100) }}%</output>
        </label>
        <label>
          Output
          <select
            :aria-label="`${lane.name} output route`"
            :value="lane.effectBusId ?? ''"
            @change="
              emit('update-route', lane, ($event.target as HTMLSelectElement).value || undefined)
            "
          >
            <option value="">Master</option>
            <option v-for="effect in project.effectLanes" :key="effect.id" :value="effect.id">
              {{ effect.name }}
            </option>
          </select>
        </label>
      </article>
    </div>
    <div class="effect-bank">
      <header>
        <div>
          <span class="channel-kind">EFFECT BUSES</span>
          <h2>Effects</h2>
        </div>
        <button type="button" @click="emit('add-effect')">Add ping-pong delay</button>
      </header>
      <p v-if="!project.effectLanes.length" class="empty-effects">
        Add an effect bus, then route an instrument or drum channel to it.
      </p>
      <article v-for="effect in project.effectLanes" :key="effect.id" class="effect-strip">
        <div class="effect-heading">
          <input v-model="effect.name" :aria-label="`${effect.name} name`" />
          <button
            type="button"
            :aria-label="`Delete ${effect.name}`"
            @click="emit('delete-effect', effect)"
          >
            Delete
          </button>
        </div>
        <label>
          Return
          <input
            v-model.number="effect.gain"
            :aria-label="`${effect.name} return level`"
            type="range"
            min="0"
            max="1.5"
            step="0.01"
          />
          <output>{{ Math.round(effect.gain * 100) }}%</output>
        </label>
        <label class="effect-source">
          Config directives
          <textarea
            v-model="effect.source"
            :aria-label="`${effect.name} config directives`"
            spellcheck="false"
          />
        </label>
      </article>
    </div>
  </section>
</template>

<style scoped>
.mixer {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 1rem;
  background: var(--xenpaper-slate-925);
}
.channel-bank,
.effect-bank {
  display: flex;
  align-items: stretch;
  gap: 0.75rem;
}
.effect-bank {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--xenpaper-slate-500);
}
.channel-strip,
.effect-strip,
.effect-bank > header {
  box-sizing: border-box;
  width: 13rem;
  flex: 0 0 13rem;
  padding: 0.8rem;
  border: 1px solid var(--xenpaper-slate-500);
  border-radius: 0.4rem;
  background: var(--xenpaper-slate-875);
}
.channel-kind {
  color: var(--xenpaper-cyan);
  font-size: 0.65rem;
  letter-spacing: 0.12em;
}
h2 {
  margin: 0.3rem 0 0.9rem;
  font-size: 1rem;
}
label {
  display: grid;
  gap: 0.35rem;
  margin-top: 0.8rem;
  color: var(--xenpaper-slate-300);
}
output {
  color: var(--xenpaper-slate-100);
}
.effect-heading {
  display: flex;
  gap: 0.4rem;
}
.effect-heading input {
  min-width: 0;
  width: 100%;
}
.effect-source textarea {
  box-sizing: border-box;
  width: 100%;
  min-height: 8rem;
  resize: vertical;
  border: 1px solid var(--xenpaper-slate-500);
  padding: 0.5rem;
  color: inherit;
  background: var(--xenpaper-slate-950);
  font: 0.75rem/1.5 monospace;
}
.empty-effects {
  color: var(--xenpaper-slate-400);
}
@media (max-width: 760px) {
  .channel-bank,
  .effect-bank {
    flex-wrap: wrap;
  }
}
</style>
