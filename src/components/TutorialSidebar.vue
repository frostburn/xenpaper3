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
          <button
            v-if="demo.tune"
            type="button"
            class="tune"
            :aria-label="`Load ${section.title} demo ${demoIndex + 1}`"
            @click="emit('selectTune', demo.tune)"
          >
            <pre>{{ demo.tune }}</pre>
          </button>
          <a v-if="demo.link && demo.href" :href="demo.href" target="_blank" rel="noreferrer">
            {{ demo.link }}
          </a>
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
  border: 1px solid #c8ccd0;
  border-radius: 0.5rem;
  background: #f7f8fa;
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
  background: #dfe8f5;
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
  border-top: 1px solid #d9dde2;
}

.tutorial-demo {
  display: grid;
  gap: 0.4rem;
}

.tutorial-demo p {
  line-height: 1.4;
  white-space: pre-line;
}

.tune {
  width: 100%;
  padding: 0;
  overflow: hidden;
  border: 1px solid #b8bec6;
  border-radius: 0.25rem;
  background: #fff;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.tune:hover {
  border-color: #4d78aa;
  background: #f0f6ff;
}

pre {
  margin: 0;
  padding: 0.65rem;
  overflow-x: auto;
  font: 0.8rem/1.35 monospace;
  white-space: pre;
}
</style>
