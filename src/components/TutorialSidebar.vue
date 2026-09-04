<script setup lang="ts">
import { ref } from 'vue'
import { tutorialChapters } from '../tutorial'

const emit = defineEmits<{
  selectTune: [source: string]
}>()

const activeChapter = ref(0)
</script>

<template>
  <aside class="tutorial-sidebar" aria-label="Xenpaper tutorial">
    <h2>Tutorial</h2>
    <nav class="chapter-tabs" aria-label="Tutorial sections">
      <button
        v-for="(chapter, chapterIndex) in tutorialChapters"
        :key="chapter.title"
        type="button"
        :class="{ active: activeChapter === chapterIndex }"
        :aria-expanded="activeChapter === chapterIndex"
        @click="activeChapter = chapterIndex"
      >
        {{ chapter.title }}
      </button>
    </nav>

    <div class="chapter-content">
      <section
        v-for="section in tutorialChapters[activeChapter]!.sections"
        :key="section.title"
        class="tutorial-section"
      >
        <h3>{{ section.title }}</h3>
        <div v-for="(demo, demoIndex) in section.demos" :key="demoIndex" class="tutorial-demo">
          <p v-if="demo.description">{{ demo.description }}</p>
          <!-- Tutorial HTML is trusted, repository-owned content rather than user input. -->
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div v-if="demo.html" class="html-description" v-html="demo.html" />
          <button
            v-if="demo.tune"
            type="button"
            class="tune"
            :aria-label="`Load ${section.title} demo ${demoIndex + 1}`"
            @click="emit('selectTune', demo.tune)"
          >
            <pre>{{ demo.tune }}</pre>
          </button>
        </div>
      </section>
    </div>
  </aside>
</template>

<style scoped>
.tutorial-sidebar {
  display: flex;
  min-width: 0;
  max-height: calc(100vh - 2rem);
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem;
  border: 1px solid var(--xenpaper-border);
  border-radius: 0.5rem;
  background: var(--xenpaper-surface);
}

h2,
h3,
p {
  margin: 0;
}

.chapter-tabs {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.chapter-tabs button {
  padding: 0.5rem 0.75rem;
  border: 0;
  border-radius: 0.25rem;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.chapter-tabs button:hover,
.chapter-tabs button.active {
  background: var(--xenpaper-text-soft);
}

.chapter-tabs button.active {
  font-weight: 700;
}

.chapter-content {
  min-height: 0;
  overflow-y: auto;
}

.tutorial-section {
  display: grid;
  gap: 0.5rem;
  padding: 0.75rem 0;
  border-top: 1px solid var(--xenpaper-border);
}

.tutorial-demo {
  display: grid;
  gap: 0.4rem;
}

.tutorial-demo p,
.html-description :deep(p) {
  margin: 0;
  line-height: 1.4;
  white-space: pre-line;
}

.html-description :deep(p + p) {
  margin-top: 0.6rem;
}

.tune {
  width: 100%;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--xenpaper-border-strong);
  border-radius: 0.25rem;
  background: var(--xenpaper-text);
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.tune:hover {
  border-color: var(--xenpaper-blue);
  background: var(--xenpaper-text-soft);
}

pre {
  margin: 0;
  padding: 0.65rem;
  overflow-x: auto;
  font: 0.8rem/1.35 monospace;
  white-space: pre;
}
</style>
