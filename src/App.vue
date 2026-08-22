<script setup lang="ts">
import TheFooter from './components/TheFooter.vue'
</script>

<template>
  <main>
    <template v-if="$route.name === 'home'">
      <h1>Xenpaper 3 test pages</h1>
      <nav>
        <RouterLink to="/xenpaper-lang-testing">Test xenpaper-lang</RouterLink>
        <RouterLink to="/patch-testing">Test sw-patch</RouterLink>
      </nav>
      <h2>About the beta release</h2>
      <p>
        Hi! It's me Lumi, the lead developer of Scale Workshop 3, Xenpaper 2 and now Xenpaper 3.
      </p>
      <p>
        Xenpaper 3 is the culmination of ideas I've developed under projects like frost-synth, HEWMP
        and SonicWeave Sheets that never really took off. Let's hope this time is different now that
        AI agents can do the grunt work and uphold good software design principles.
      </p>
      <p>
        This is an early beta release so expect it to be quite broken. I'm still in huge knowledge
        debt due to vibe-coding most of the project with OpenAI Codex.
      </p>
      <p>
        I would love to hear your feedback on <code>xenpaper-lang</code> so please visit the
        <RouterLink to="/xenpaper-lang-testing">test page</RouterLink>!
      </p>
      <h2>Project goals</h2>
      <ul>
        <li>Enable creation of through-composed microtonal music.</li>
        <li>Enable sharing of small musical ideas in chat-sized permalinks.</li>
        <li>
          Enable sharing and storage of large musical works in a versioned file format that can be
          attached to chat messages or email.
        </li>
        <li>
          Sound like the web. While <code>sw-patch</code> will enable free sound desing it's not
          trying to outsmart the Web Audio API.
        </li>
        <li>
          Mix of visual and text-based methods for organizing larger works. Xen is too
          multi-dimensional to fit inside a 2D interface but the arranger view, mixer, etc. can
          align with the modern DAW look and feel.
        </li>
      </ul>
      <h3>Secondary goals</h3>
      <ul>
        <li>
          Enable creation of algorithmic xen music without compromising through-composability.
        </li>
        <li>Interface with other apps through MIDI be it realtime or exported files.</li>
        <li>Support MusicXML exports for high-quality staff engraving.</li>
      </ul>
      <p><i>May Spoob have mercy on our tunes!</i></p>
    </template>
    <RouterView v-else />
  </main>
  <TheFooter />
</template>

<style scoped>
nav {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.5rem;
}
</style>
