import { defineConfig } from 'vitest/config';

/**
 * The probes in .probe/ proved the engine works; this suite keeps them working.
 * Node environment on purpose: v86 runs headless there, and the browser-only pieces
 * (IndexedDB, Capacitor) are faked per test.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
