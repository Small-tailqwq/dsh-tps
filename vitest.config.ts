import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

/**
 * Vitest resolution facade: the local test project and the sibling
 * harness base jointly resolve repo-local @deepseek-ai packages from source.
 */
export default defineConfig({
  plugins: [tsconfigPaths({
    projects: [
      './tsconfig.vitest.json',
      '../deepseek-harness/tsconfig.base.json',
    ],
  })],
  test: {
    include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'],
    pool: 'forks',
  },
})
