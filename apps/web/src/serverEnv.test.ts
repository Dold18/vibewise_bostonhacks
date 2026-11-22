import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadLocalEnv, localEnvFiles } from '../server/env';

afterEach(() => { vi.unstubAllEnvs(); });

const path = (f: string | URL) => resolve(typeof f === 'string' ? f : fileURLToPath(f));

describe('API environment loading', () => {
  it('reads the repo-root .env and apps/web/.env, with no machine-specific path', () => {
    vi.stubEnv('VIBENTA_ENV_FILE', undefined);
    expect(localEnvFiles().map(path)).toEqual([resolve('../../.env'), resolve('.env')]);
  });
  it('VIBENTA_ENV_FILE is read first and no longer replaces the repo-root .env', () => {
    vi.stubEnv('VIBENTA_ENV_FILE', '/elsewhere/extra.env');
    expect(localEnvFiles().map(path)).toEqual(['/elsewhere/extra.env', resolve('../../.env'), resolve('.env')]);
  });
  it('first file wins, values already in the environment win over files, and missing files are skipped', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vibenta-api-env-'));
    const first = join(dir, 'first.env'), second = join(dir, 'second.env');
    writeFileSync(first, 'VIBENTA_T_A=first\nVIBENTA_T_B=first\n');
    writeFileSync(second, 'VIBENTA_T_A=second\nVIBENTA_T_C=second\nVIBENTA_T_D=second\n');
    vi.stubEnv('VIBENTA_T_A', undefined); vi.stubEnv('VIBENTA_T_B', undefined); vi.stubEnv('VIBENTA_T_C', undefined);
    vi.stubEnv('VIBENTA_T_D', 'shell');
    loadLocalEnv([join(dir, 'missing.env'), first, second]);
    expect([process.env.VIBENTA_T_A, process.env.VIBENTA_T_B, process.env.VIBENTA_T_C, process.env.VIBENTA_T_D])
      .toEqual(['first', 'first', 'second', 'shell']);
  });
});
