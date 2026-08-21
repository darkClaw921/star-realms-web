import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Property tests over full fuzzed games need room to run.
    testTimeout: 60_000,
  },
})
