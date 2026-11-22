import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';

/**
 * Serve MapLibre's self-contained web worker byte-for-byte.
 *
 * MapLibre finds its worker relative to its own module, which breaks once
 * Vite pre-bundles it, and Vite's dev transforms inject browser-only client
 * code that a worker can't run. So we expose the untouched file at a fixed
 * path (dev middleware + emitted build asset) and point MapLibre at it.
 */
function maplibreWorker(): Plugin {
  const fileName = 'maplibre-gl-worker.mjs';
  const source = fileURLToPath(new URL(`./node_modules/maplibre-gl/dist/${fileName}`, import.meta.url));
  return {
    name: 'maplibre-worker',
    configureServer(server) {
      server.middlewares.use(`/${fileName}`, (_req, res) => {
        res.setHeader('Content-Type', 'text/javascript');
        res.end(readFileSync(source));
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName, source: readFileSync(source) });
    },
  };
}

// Explicit files may have any name. Values remain in Node's environment;
// Vite only forwards its default VITE_ prefix to browser code.
if (process.env.VIBENTA_ENV_FILE) process.loadEnvFile(process.env.VIBENTA_ENV_FILE);
// Browser settings (VITE_SUPABASE_*, VITE_CATALOG_EMBEDDING_MODEL_KEY) live in
// apps/web/.env. Server keys stay in the root .env or VIBENTA_ENV_FILE, which the
// API process loads itself; VITE_ values already in the environment win.
const webEnvDir = fileURLToPath(new URL('./', import.meta.url));
export default defineConfig(({ mode }) => {
  const envDir = webEnvDir;
  const env = loadEnv(mode, envDir, '');
  return {
    plugins: [maplibreWorker()],
    // Standalone scene galleries use import maps/CDN Three.js, outside the app scan.
    optimizeDeps: { entries: ['index.html'] },
    envDir,
    // Browser calls share Vite's origin; provider keys stay in the API process.
    server: {
      port: Number(process.env.VITE_PORT ?? env.VITE_PORT ?? 5173),
      proxy: { '/api': `http://127.0.0.1:${process.env.TRANSIT_API_PORT ?? env.TRANSIT_API_PORT ?? 8787}` },
    },
  };
});
