import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';

// Discover the API port by reading server/.port (written by the server on startup).
// Falls back to KAYENTA_API_PORT env var, then 3001.
function resolveApiPort() {
  const envPort = process.env.KAYENTA_API_PORT;
  if (envPort) return Number(envPort);
  try {
    const p = path.resolve(__dirname, '..', 'server', '.port');
    if (fs.existsSync(p)) return Number(fs.readFileSync(p, 'utf8').trim());
  } catch {}
  return 3001;
}

const apiPort = resolveApiPort();

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.KAYENTA_WEB_PORT) || 3000,
    // strictPort: false → Vite auto-picks the next free port if the preferred one is taken
    strictPort: false,
    proxy: {
      '/api': `http://localhost:${apiPort}`,
    },
  },
});
