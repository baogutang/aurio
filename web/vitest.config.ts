import { defineConfig } from 'vitest/config';

// Vitest prefers this file over vite.config.ts, so the React plugin and the
// dev-server proxy never load for unit tests. `vite build` keeps reading
// vite.config.ts and is unaffected.
export default defineConfig({
  test: {
    // Pure lib modules run in node; DOM-dependent test files opt in with a
    // `// @vitest-environment happy-dom` docblock.
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Pin the timezone so date-formatting tests never depend on the host.
    env: { TZ: 'UTC' },
  },
});
