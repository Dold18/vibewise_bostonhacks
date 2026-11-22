import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EMBED_MODEL, EMBED_REVISION } from '../src/embed.ts';

// The web app only compares catalog vectors whose fingerprint matches its own pinned model
// (apps/web/src/features/vibe/profile.ts MODEL). Catalog and queries must embed with the same revision.
test('the pipeline embeds with the same pinned model revision as the web app', () => {
  const profile = fs.readFileSync(path.resolve(import.meta.dirname, '../../apps/web/src/features/vibe/profile.ts'), 'utf8');
  assert.match(profile, new RegExp(`id: '${EMBED_MODEL}', revision: '${EMBED_REVISION}'`));
});
