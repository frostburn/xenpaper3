<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import SnippetEditor from '../components/SnippetEditor.vue'
import { useRoute, useRouter } from 'vue-router'
import {
  interactiveTutorialChapters,
  interactiveTutorialPageInfo,
  interactiveTutorialPages,
} from '../tutorial/interactive'

// Each mounted tutorial owns its editable state, including pages that are hidden.
const pages = ref(structuredClone(interactiveTutorialPages))
const route = useRoute()
const router = useRouter()
const currentPage = computed(() => {
  const page =
    typeof route.query.page === 'string' && /^\d+$/.test(route.query.page)
      ? Number(route.query.page) - 1
      : 0
  return page >= 0 && page < pages.value.length ? page : 0
})
const demos = computed(() => pages.value[currentPage.value]!)
const pageInfo = computed(() => interactiveTutorialPageInfo[currentPage.value]!)
const heading = ref<HTMLHeadingElement>()
const contents = ref<HTMLDetailsElement>()

async function focusDestination() {
  await nextTick()
  const id = route.hash.slice(1)
  const target = demos.value.some((demo) => `${demo.id}-heading` === id)
    ? document.getElementById(id)
    : heading.value
  target?.focus()
  target?.scrollIntoView?.({ block: 'start' })
}

watch([currentPage, () => route.hash], focusDestination, { flush: 'post' })
onMounted(() => {
  if (route.hash) void focusDestination()
})

async function followContents(
  event: MouseEvent,
  navigate: (event: MouseEvent) => Promise<unknown>,
) {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
  if (contents.value) contents.value.open = false
  await navigate(event)
  // Selecting the current URL does not trigger the route watcher.
  await focusDestination()
}

async function changePage(page: number) {
  if (page < 0 || page >= pages.value.length) return
  await router.push({ query: { ...route.query, page: String(page + 1) } })
}
</script>

<template>
  <div class="tutorial">
    <h1 ref="heading" tabindex="-1">Interactive tutorial</h1>
    <nav class="contents" aria-label="Table of contents">
      <details ref="contents">
        <summary>Table of contents</summary>
        <div class="contents-chapters">
          <div v-for="chapter in interactiveTutorialChapters" :key="chapter.id">
            <h2>{{ chapter.title }}</h2>
            <ol>
              <li v-for="page in chapter.pages" :key="page.index">
                <RouterLink
                  v-slot="{ href, navigate }"
                  custom
                  :to="{ query: { ...route.query, page: String(page.index + 1) } }"
                >
                  <a
                    :href="href"
                    :aria-current="currentPage === page.index ? 'page' : undefined"
                    @click="followContents($event, navigate)"
                    >Page {{ page.index + 1 }}: {{ page.title }}</a
                  >
                </RouterLink>
                <ul>
                  <li v-for="demo in page.demos" :key="demo.id">
                    <RouterLink
                      v-slot="{ href, navigate }"
                      custom
                      :to="{
                        query: { ...route.query, page: String(page.index + 1) },
                        hash: `#${demo.id}-heading`,
                      }"
                    >
                      <a
                        :href="href"
                        :aria-current="
                          route.hash === `#${demo.id}-heading` && currentPage === page.index
                            ? 'location'
                            : undefined
                        "
                        @click="followContents($event, navigate)"
                        >{{ demo.title }}</a
                      >
                    </RouterLink>
                  </li>
                </ul>
              </li>
            </ol>
          </div>
        </div>
      </details>
    </nav>
    <p class="chapter-heading">
      {{ pageInfo.chapterTitle }} · Page {{ currentPage + 1 }} of {{ pages.length }}
    </p>
    <section v-for="demo in demos" :key="demo.id" :aria-labelledby="`${demo.id}-heading`">
      <h2 :id="`${demo.id}-heading`" tabindex="-1">{{ demo.title }}</h2>
      <p v-if="demo.description">{{ demo.description }}</p>
      <!-- Tutorial HTML is trusted, repository-owned content. -->
      <!-- eslint-disable-next-line vue/no-v-html -->
      <div v-if="demo.html" class="html-description" v-html="demo.html" />
      <SnippetEditor
        v-if="demo.props"
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
      <RouterLink
        :to="{ query: { ...route.query, page: String(currentPage + 1) } }"
        aria-label="Permalink to this tutorial page"
        >Page {{ currentPage + 1 }} of {{ pages.length }}</RouterLink
      >
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
.tutorial > section h2 {
  scroll-margin-top: 1rem;
}
.contents {
  margin-bottom: 1rem;
  border: 1px solid var(--xenpaper-slate-500);
  border-radius: 0.3rem;
  padding: 0.75rem;
}
.contents summary {
  cursor: pointer;
}
.contents-chapters {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1.5rem;
  margin-top: 1rem;
  overflow-wrap: anywhere;
}
.contents ol,
.contents ul {
  padding-left: 1.5rem;
}
.contents li {
  margin-top: 0.4rem;
}
.contents [aria-current] {
  font-weight: 700;
}
.chapter-heading {
  margin: 0 0 1.5rem;
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
  .contents-chapters {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
