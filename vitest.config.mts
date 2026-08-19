import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: {
      NODE_ENV: 'test',
    },
    // Load .env file for DB credentials
    setupFiles: ['./src/tests/setup.ts'],
    // Run integration tests sequentially to avoid DB race conditions
    pool: 'forks',
    singleFork: true,
  },
});
