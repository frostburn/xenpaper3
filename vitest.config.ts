import { fileURLToPath } from 'node:url'
import { mergeConfig, defineConfig, configDefaults } from 'vitest/config'
import viteConfig from './vite.config.js'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      exclude: [...configDefaults.exclude, 'e2e/**'],
      pool: 'threads',
      root: fileURLToPath(new URL('./', import.meta.url)),
      projects: [
        {
          extends: true,
          test: {
            name: 'node',
            environment: 'node',
            include: [
              'xenpaper-lang/__test__/**/*.spec.ts',
              'sw-patch/__test__/**/*.spec.ts',
              'sw-seq/__test__/**/*.spec.ts',
            ],
          },
        },
        {
          extends: true,
          test: {
            name: 'ui',
            environment: 'jsdom',
            include: ['src/__tests__/**/*.spec.ts'],
            setupFiles: ['./src/__tests__/setup.ts'],
          },
        },
      ],
    },
  }),
)
