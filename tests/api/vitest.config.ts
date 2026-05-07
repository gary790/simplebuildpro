// ============================================================
// SimpleBuild Pro — Vitest Configuration for API Tests
// ============================================================

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 30_000,
    hookTimeout: 15_000,
    include: ['**/*.test.ts'],
    reporters: ['verbose'],
    env: {
      API_URL: 'http://localhost:8080',
    },
  },
});
