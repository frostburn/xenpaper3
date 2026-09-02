import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'xenpaper-lang',
              test: /[\\/]xenpaper-lang[\\/]/,
              includeDependenciesRecursively: false,
            },
            {
              name: 'sw-patch',
              test: /[\\/]sw-patch[\\/]/,
              includeDependenciesRecursively: false,
            },
            {
              name: 'sw-seq',
              test: /[\\/]sw-seq[\\/]/,
              includeDependenciesRecursively: false,
            },
          ],
        },
      },
    },
  },
})
