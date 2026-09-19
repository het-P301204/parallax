import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // Includes src/ui/tokens.test.ts, which asserts the palette's contrast
    // arithmetically, and src/views/filter.test.ts, which tests the filter
    // predicate as the pure function it is. Neither needs a browser, and
    // therefore neither has an excuse.
    include: ['src/**/*.test.ts'],
  },
})
