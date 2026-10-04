import { defineConfig } from 'vitest/config';

// Long-running scripted playthroughs, kept out of the normal test run.
export default defineConfig({
  test: { include: ['src/**/*.playtest.ts'], testTimeout: 30 * 60 * 1000 },
});
