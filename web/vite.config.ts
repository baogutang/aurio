import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev: proxy API + WS to the Node server on :8080.
// Build: output to ../pwa so the existing Express static server serves it as-is.
export default defineConfig({
  plugins: [react()],
  build: { outDir: '../pwa', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8080',
      '/tts': 'http://localhost:8080',
      '/stream': { target: 'ws://localhost:8080', ws: true },
    },
  },
});
