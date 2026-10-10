<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { createDefaultSnippet, decodeSnippet, encodeSnippet } from '../snippet'
import SnippetEditor from '../components/SnippetEditor.vue'
const route = useRoute()
const router = useRouter()
const snippet = ref(createDefaultSnippet())
const editor = ref<InstanceType<typeof SnippetEditor>>()
const urlError = ref('')
const copyStatus = ref('')
const shareFormat = ref<'url' | 'wiki' | 'discord'>('url')
const shareField = ref<HTMLInputElement>()
watch(
  () => route.hash,
  (hash) => {
    if (hash === encodeSnippet(snippet.value)) {
      urlError.value = ''
      return
    }
    editor.value?.stop()
    try {
      snippet.value = decodeSnippet(hash)
      urlError.value = ''
    } catch (error) {
      urlError.value = error instanceof Error ? error.message : String(error)
    }
  },
  { immediate: true },
)
const encoded = computed(() => encodeSnippet(snippet.value))
watch(encoded, (hash) => {
  urlError.value = ''
  copyStatus.value = ''
  if (route.hash !== hash)
    void router.replace({ path: route.path, hash }).catch((error) => {
      urlError.value = error instanceof Error ? error.message : String(error)
    })
})
const shareUrl = computed(() => {
  const resolved = router.resolve({ path: '/snippet', hash: encoded.value })
  return new URL(resolved.href, window.location.href).href
})
const shareText = computed(() =>
  shareFormat.value === 'wiki'
    ? `[${shareUrl.value} Xenpaper snippet]`
    : shareFormat.value === 'discord'
      ? `<${shareUrl.value}>`
      : shareUrl.value,
)
watch(shareFormat, () => {
  copyStatus.value = ''
})

const copy = async () => {
  try {
    await navigator.clipboard.writeText(shareText.value)
    copyStatus.value = 'Copied!'
  } catch {
    shareField.value?.focus()
    shareField.value?.select()
    copyStatus.value = 'Select and copy the link with Ctrl/⌘ C.'
  }
}
</script>
<template>
  <div class="snippet">
    <h1>Xenpaper snippet</h1>
    <p v-if="urlError" role="alert" class="error">
      {{ urlError }} Edit the snippet to create a new link.
    </p>
    <SnippetEditor
      ref="editor"
      v-model:source="snippet.source"
      v-model:instrument="snippet.lane.instrument"
      v-model:gain="snippet.lane.gain"
      :lane-source="snippet.lane.source"
    />
    <section class="share" aria-label="Share snippet">
      <h2>Share snippet</h2>
      <div class="share-controls">
        <select v-model="shareFormat" aria-label="Share format">
          <option value="url">URL</option>
          <option value="wiki">MediaWiki</option>
          <option value="discord">Discord</option>
        </select>
        <input
          ref="shareField"
          :value="shareText"
          aria-label="Shareable snippet link"
          readonly
          @focus="shareField?.select()"
        />
        <button type="button" @click="copy">Copy link</button>
      </div>
      <p v-if="copyStatus" role="status" class="help">{{ copyStatus }}</p>
    </section>
  </div>
</template>

<style scoped>
.snippet {
  max-width: 80rem;
  margin: auto;
  padding: 1.5rem;
  color: var(--xenpaper-slate-100);
  font-size: 0.875rem;
}
h1 {
  margin: 0 0 1rem;
  font-size: 1.6rem;
}
h2 {
  margin: 0 0 0.75rem;
  font-size: 1.15rem;
}
.help {
  color: var(--xenpaper-slate-400);
  font-size: 0.75rem;
}
.error {
  color: var(--xenpaper-light-red);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.share {
  padding-block: 1rem;
  border-top: 1px solid var(--xenpaper-slate-500);
}
.share-controls {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}
.share-controls input {
  flex: 1;
  min-width: 8rem;
}
.share-controls button,
.share-controls select,
.share-controls input {
  min-height: 2rem;
  border: 1px solid var(--xenpaper-slate-500);
  border-radius: 0.3rem;
  padding: 0.35rem 0.55rem;
  color: inherit;
  background: var(--xenpaper-slate-850);
  font: inherit;
}
.share-controls button {
  cursor: pointer;
}
@media (max-width: 760px) {
  .snippet {
    padding: 1rem;
  }
  .share-controls input {
    flex-basis: 100%;
    order: 3;
  }
}
</style>
