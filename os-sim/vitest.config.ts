import { defineConfig } from 'vitest/config';

/**
 * The probes in .probe/ proved the engine works; this suite keeps them working.
 * Node environment on purpose: v86 runs headless there, and the browser-only pieces
 * (IndexedDB, Capacitor) are faked per test.
 */
export default defineConfig({
  test: {
    environment: 'node',
    // .tsx as well: a component test is the only thing that can prove a card is really
    // rendered. Every honesty check before this read the source text instead, which is
    // how "the code looks right" kept passing while nothing was drawn.
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
