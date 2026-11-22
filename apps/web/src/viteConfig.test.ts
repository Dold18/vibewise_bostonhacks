import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

async function config() {
  const exported = (await import('../vite.config')).default;
  if (typeof exported !== 'function') throw Error('Expected a mode-aware Vite config');
  return exported({ command: 'serve', mode: 'test' });
}

describe('integrated development configuration', () => {
  it('keeps worker serving, gallery scan safeguards and the API proxy with configurable ports', async () => {
    vi.stubEnv('VIBENTA_ENV_FILE', undefined);
    vi.stubEnv('VITE_PORT', '5510');
    vi.stubEnv('TRANSIT_API_PORT', '8810');
    const c = await config();
    if (typeof c.envDir !== 'string') throw Error('Expected a root environment directory');
    expect(resolve(c.envDir)).toBe(resolve('../..'));
    expect(c.optimizeDeps?.entries).toEqual(['index.html']);
    expect(c.server?.port).toBe(5510);
    expect(c.server?.proxy?.['/api']).toBe('http://127.0.0.1:8810');
    expect(c.plugins).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'maplibre-worker' })]));
    expect(c.define).toBeUndefined();
    expect(c.envPrefix).toBeUndefined(); // Vite's safe VITE_ default, no server-key prefix
  });

  it('loads an explicitly named external file without placing server keys in client configuration', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'vibenta-env-regression-'));
    const file = join(folder, 'custom-qa.env');
    writeFileSync(file, 'VITE_PORT=5511\nTRANSIT_API_PORT=8811\nGEMINI_API_KEY=TEST_FIXTURE_ONLY\n');
    vi.stubEnv('VIBENTA_ENV_FILE', file);
    vi.stubEnv('VITE_PORT', undefined);
    vi.stubEnv('TRANSIT_API_PORT', undefined);
    vi.stubEnv('GEMINI_API_KEY', undefined);
    const c = await config();
    expect(c.envDir).toBe(folder);
    expect(c.server?.port).toBe(5511);
    expect(c.server?.proxy?.['/api']).toBe('http://127.0.0.1:8811');
    expect(process.env.GEMINI_API_KEY).toBe('TEST_FIXTURE_ONLY');
    expect(JSON.stringify(c)).not.toContain('TEST_FIXTURE_ONLY');
    expect(c.envPrefix).toBeUndefined();
  });
});
