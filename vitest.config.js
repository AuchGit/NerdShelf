// Standalone Vitest config (deliberately NOT the app vite.config.js — the tests
// are pure-node unit tests over geometry/markdown helpers and need neither the
// React plugin nor the PWA plugin).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.js'],
  },
});
