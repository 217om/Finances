import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts on purpose: the production build (used by the
// GitHub Pages deploy) only ever runs `tsc && vite build`, so this file has
// zero effect on it either way — but keeping them apart means there's no risk
// of a test-only setting ever leaking into the real build config.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
