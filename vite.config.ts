import { defineConfig } from 'vite';

// Relative base so the build works when hosted under a sub-path (e.g. GitHub Pages).
export default defineConfig({
  base: './',
  build: {
    // Phaser alone is ~1.2 MB minified; that's expected for a game bundle.
    chunkSizeWarningLimit: 2000,
  },
});
