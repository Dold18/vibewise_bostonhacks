import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

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

export default defineConfig({
  plugins: [maplibreWorker()],
});
