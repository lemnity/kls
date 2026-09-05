import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    // Integration suites seed a fixed synthetic tenant inside separate transactions.
    // Running files in parallel makes PostgreSQL wait on the same unique keys.
    fileParallelism: false,
    coverage: {
      reporter: ['text', 'html'],
      include: ['packages/**/*.ts', 'apps/**/*.ts'],
      exclude: ['**/*.test.ts'],
    },
  },
});
