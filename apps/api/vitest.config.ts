import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./tests/globalSetup.ts'],
    setupFiles: ['./tests/setupEnv.ts'],
    // integration tests share one database; run files sequentially
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 60000,
  },
});
