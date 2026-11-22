import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { EMBED_DIM, EMBED_KEY, EMBED_MODEL, EMBED_REVISION } from '../src/embed.ts';

// The catalog is indexed here and queried by apps/web/server. If these two pins ever differ, stored
// vectors and query vectors silently stop being comparable, so this test fails on any drift.
test('pipeline embedder pin matches the web server pin', () => {
  const profile = readFileSync(new URL('../../apps/web/src/features/vibe/profile.ts', import.meta.url), 'utf8');
  const model = /id:\s*'([^']+)'/.exec(profile)?.[1];
  const revision = /revision:\s*'([0-9a-f]{40})'/.exec(profile)?.[1];
  const dimensions = Number(/dimensions:\s*(\d+)/.exec(profile)?.[1]);
  assert.equal(EMBED_MODEL, model);
  assert.equal(EMBED_REVISION, revision);
  assert.equal(EMBED_DIM, dimensions);
  assert.equal(EMBED_KEY, `${model}@${revision}:fp32:mean:l2`);
});

test('revision is a full commit hash, not a moving ref', () => {
  assert.match(EMBED_REVISION, /^[0-9a-f]{40}$/);
});
