import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  // v86 spawns its CPU thread from the same module; keep it out of the
  // dependency optimiser so the wasm/worker paths resolve correctly.
  optimizeDeps: { exclude: ['v86'] },
  assetsInclude: ['**/*.bin', '**/*.img'],
  server: {
    headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' },
    watch: { ignored: ['**/android/**', '**/dist/**'] },
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    allowedHosts: true,
  },
  preview: {
    headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' },
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
