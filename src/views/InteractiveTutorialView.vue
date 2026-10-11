<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import SnippetEditor from '../components/SnippetEditor.vue'
import { interactiveTutorialPages } from '../tutorial/interactive'

// Each mounted tutorial owns its editable state, including pages that are hidden.
const pages = ref(structuredClone(interactiveTutorialPages))
const currentPage = ref(0)
const demos = computed(() => pages.value[currentPage.value]!)
const heading = ref<HTMLHeadingElement>()

async function changePage(page: number) {
  if (page < 0 || page >= pages.value.length) return
  currentPage.value = page
  await nextTick()
  heading.value?.focus()
  heading.value?.scrollIntoView?.({ block: 'start' })
}
</script>

<template>
  <div class="tutorial">
    <h1 ref="heading" tabindex="-1">Interactive tutorial</h1>
    <section v-for="demo in demos" :key="demo.id" :aria-labelledby="`${demo.id}-heading`">
      <h2 :id="`${demo.id}-heading`">{{ demo.title }}</h2>
      <p v-if="demo.description">{{ demo.description }}</p>
      <div v-if="demo.html" v-html="demo.html" />
      <SnippetEditor
        v-bind="demo.props"
        v-model:source="demo.props.source"
        v-model:instrument="demo.props.instrument"
        v-model:gain="demo.props.gain"
      />
    </section>
    <nav class="pagination" aria-label="Tutorial pagination">
      <button type="button" :disabled="currentPage === 0" @click="changePage(currentPage - 1)">
        Previous
      </button>
      <span role="status">Page {{ currentPage + 1 }} of {{ pages.length }}</span>
      <button
        type="button"
        :disabled="currentPage === pages.length - 1"
        @click="changePage(currentPage + 1)"
      >
        Next
      </button>
    </nav>
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
.pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
.pagination button {
  border: 1px solid var(--xenpaper-slate-500);
  border-radius: 0.3rem;
  padding: 0.5rem 0.75rem;
  color: inherit;
  background: var(--xenpaper-slate-850);
  font: inherit;
  cursor: pointer;
}
.pagination button:disabled {
  opacity: 0.5;
  cursor: default;
}
@media (max-width: 760px) {
  .tutorial {
    padding: 1rem;
  }
}
</style>
