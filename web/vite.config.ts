import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev: proxy API + WS to the Node server (AURIO_SERVER_PORT, default :8080).
// Build: output to ../pwa so the existing Express static server serves it as-is.
const serverPort = process.env.AURIO_SERVER_PORT || '8080';

export default defineConfig({
  plugins: [react()],
  build: { outDir: '../pwa', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      '/api': `http://localhost:${serverPort}`,
      '/tts': `http://localhost:${serverPort}`,
      '/imaging': `http://localhost:${serverPort}`,
      '/stream': { target: `ws://localhost:${serverPort}`, ws: true },
    },
  },
});
