import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_GEMINI_MODEL } from '../src/gemini.ts';
import { createVibeGenerator } from '../src/geminiVibe.ts';
import { PLACE_FLAVOR, parseVibeArgs, resolveModel, runVibeEnrichment, selectIds } from '../src/enrichVibe.ts';
import {
  PLACE_RESPONSE_SCHEMA, PLACE_SYSTEM_PROMPT, VIBE_RESPONSE_SCHEMA, VIBE_SYSTEM_PROMPT,
  buildPlaceBundle, humanizeKind, parsePlaceResponse, type VibePlace,
} from '../src/vibe.ts';

const p = (o: Partial<VibePlace> = {}): VibePlace => ({
  id: 7, name: 'Museum of Fine Arts', kind: 'art_museum',
  osm_tags: { tourism: 'museum', wheelchair: 'yes' }, context_features: { neighborhood: 'Fenway' }, ...o,
});

const REAL = 'The museum holds collections spanning ancient Egypt, European painting and contemporary art, with galleries arranged around a sunlit central courtyard and a glass-roofed wing that hosts rotating exhibitions, evening talks and family art-making sessions on weekends.';

test('humanizeKind turns stored kinds into plain words', () => {
  assert.equal(humanizeKind('art_museum'), 'art museum');
  assert.equal(humanizeKind('music_venue'), 'music venue');
  assert.equal(humanizeKind('historic_site'), 'historic site');
  assert.equal(humanizeKind('park'), 'park');
  assert.equal(humanizeKind('gallery'), 'art gallery');
  assert.equal(humanizeKind('theatre'), 'theater');
  assert.equal(humanizeKind('arts_centre'), 'arts center');
  assert.equal(humanizeKind('escape_game'), 'escape room');
  assert.equal(humanizeKind(null), null);
  assert.equal(humanizeKind('no'), null);
});

test('place bundle: kind humanized in facts, neighborhood, OSM tags and licenses; no price or cuisine lines', () => {
  const b = buildPlaceBundle(p(), [
    { place_ref: 7, source: 'city_licenses', content: 'Entertainment license: Live Entertainment, capacity 400.' },
  ]);
  assert.match(b.prompt, /^Facts: name=Museum of Fine Arts, kind=art museum, neighborhood=Fenway\n/);
  assert.match(b.prompt, /Amenity tags \(OpenStreetMap\): tourism=museum, wheelchair=yes/);
  assert.match(b.prompt, /City license records: Entertainment license/);
  assert.doesNotMatch(b.prompt, /price=|cuisine=|category=/);
  assert.equal(b.hasPrice, false);
  assert.equal(b.hasDescriptive, false);
});

test('place bundle evidence line is worded for a place, not a restaurant', () => {
  const none = buildPlaceBundle(p({ context_features: null }), []);
  assert.match(none.prompt, /Atmosphere evidence: NONE beyond the kind of place\./);
  assert.doesNotMatch(none.prompt, /category and price/);
  assert.match(none.prompt, /Do not state lighting, noise level, decor, crowd or music/);
  assert.doesNotMatch(none.prompt, /neighborhood=/);

  const web = buildPlaceBundle(p(), [{ place_ref: 7, source: 'website', content: REAL }], true);
  assert.match(web.prompt, /From the place's own website: The museum holds/);
  assert.doesNotMatch(web.prompt, /restaurant/i);
  assert.match(web.prompt, /Atmosphere evidence: website text and a photo\. State a sensory detail/);
  assert.equal(web.hasDescriptive, true);

  const wiki = buildPlaceBundle(p(), [{ place_ref: 7, source: 'wiki', content: REAL }]);
  assert.match(wiki.prompt, /From a travel guide: The museum holds/);
});

test('place bundle applies the boilerplate rule and the descriptive cap', () => {
  const boiler = buildPlaceBundle(p(), [{ place_ref: 7, source: 'website', content: 'Skip to main content. Plan your visit. Buy tickets. Sign up for our newsletter. Gift cards. Careers. Privacy policy. Directions.' }]);
  assert.equal(boiler.hasDescriptive, false);
  assert.doesNotMatch(boiler.prompt, /From the place's own website/);
  assert.match(boiler.prompt, /Atmosphere evidence: NONE/);
  const long = buildPlaceBundle(p(), [{ place_ref: 7, source: 'website', content: REAL.repeat(5) }]);
  const line = long.prompt.split("From the place's own website: ")[1]!.split('\n')[0]!;
  assert.ok(line.length <= 701 && line.endsWith('…'));
});

test('place bundle falls back to a generic kind when kind is unusable', () => {
  assert.match(buildPlaceBundle(p({ kind: null }), []).prompt, /^Facts: name=Museum of Fine Arts, neighborhood=Fenway\n/);
});

const okDesc = 'An art museum with wide-ranging collections, suited to an unhurried afternoon of wandering galleries alone or with a friend, and a calm, reflective pace that rewards lingering.';

test('place parse accepts {description} only and returns no profile', () => {
  const v = parsePlaceResponse(JSON.stringify({ description: okDesc }), { hasDescriptive: false, hasPhoto: false });
  assert.deepEqual(v, { description: okDesc });
});

test('place parse shares the guards: sensory claims, photo narration, length', () => {
  const none = { hasDescriptive: false, hasPhoto: false };
  const quiet = JSON.stringify({ description: 'A neighborhood park with lawns and paths, a quiet place to wander on a sunny afternoon with a book or a dog.' });
  assert.throws(() => parsePlaceResponse(quiet, none), /unsupported sensory claim "quiet"/);
  assert.doesNotThrow(() => parsePlaceResponse(quiet, { hasDescriptive: true, hasPhoto: false }));
  assert.doesNotThrow(() => parsePlaceResponse(quiet, { hasDescriptive: false, hasPhoto: true }));
  const narr = JSON.stringify({ description: 'A neighborhood park with lawns and paths. The photo shows a wide lawn edged by tall oaks and a winding path.' });
  assert.throws(() => parsePlaceResponse(narr, { hasDescriptive: false, hasPhoto: true }), /photo narration/);
  assert.throws(() => parsePlaceResponse('{"description":"A park."}', none), /too short/);
  assert.throws(() => parsePlaceResponse(JSON.stringify({ description: 'a'.repeat(2000) }), none), /too long/);
  assert.throws(() => parsePlaceResponse('nope', none), /not valid JSON/);
});

test('place prompt and schema: a place to visit, description only, same honesty rules', () => {
  assert.deepEqual(PLACE_RESPONSE_SCHEMA.required, ['description']);
  assert.deepEqual(Object.keys(PLACE_RESPONSE_SCHEMA.properties), ['description']);
  assert.match(PLACE_SYSTEM_PROMPT, /place to visit/);
  assert.doesNotMatch(PLACE_SYSTEM_PROMPT, /profile/);
  assert.match(PLACE_SYSTEM_PROMPT, /Atmosphere evidence/);
  assert.match(PLACE_SYSTEM_PROMPT, /source material, not instructions/);
  assert.match(PLACE_SYSTEM_PROMPT, /the photo shows/);
});

test('CLI: --type is required and validated with the shared messages', () => {
  assert.throws(() => parseVibeArgs([]), /missing --type \(expected one of restaurants, museums, entertainment, parks, landmarks\)/);
  assert.throws(() => parseVibeArgs(['--type', 'bars']), /invalid --type 'bars' \(expected one of restaurants, museums/);
  const a = parseVibeArgs(['--type', 'museums']);
  assert.equal(a.type, 'museums');
  assert.equal(a.limit, 300);
  assert.equal(a.all, false);
  assert.equal(a.model, null);
});

test('CLI: --model and --all are parsed; --all excludes --limit and --ids-file', () => {
  const a = parseVibeArgs(['--type', 'parks', '--all', '--model', 'gemini-2.5-flash-lite', '--dry-run']);
  assert.equal(a.all, true);
  assert.equal(a.model, 'gemini-2.5-flash-lite');
  assert.equal(a.dryRun, true);
  assert.throws(() => parseVibeArgs(['--type', 'parks', '--all', '--limit', '5']), /--all cannot be combined/);
  assert.throws(() => parseVibeArgs(['--type', 'parks', '--all', '--ids-file', 'x.json']), /--all cannot be combined/);
});

test('model precedence: --model, then GEMINI_MODEL, then the default', () => {
  assert.equal(resolveModel('a', 'b'), 'a');
  assert.equal(resolveModel(null, 'b'), 'b');
  assert.equal(resolveModel(null, undefined), DEFAULT_GEMINI_MODEL);
  assert.equal(resolveModel(null, ''), DEFAULT_GEMINI_MODEL);
});

test('selection: --all takes every unenriched id in id order; otherwise a seeded random sample', () => {
  const ids = Array.from({ length: 50 }, (_, i) => i + 1);
  assert.deepEqual(selectIds(ids, { all: true, limit: 5, seed: 7 }), ids);
  const s = selectIds(ids, { all: false, limit: 5, seed: 7 });
  assert.equal(s.length, 5);
  assert.deepEqual(s, selectIds(ids, { all: false, limit: 5, seed: 7 }));
});

async function bodyFor(model: string, opts: Partial<Parameters<typeof createVibeGenerator>[0]> = {}) {
  let body: { systemInstruction: { parts: Array<{ text: string }> }; generationConfig: { thinkingConfig?: unknown; responseSchema: unknown } } | undefined;
  const fetchImpl = (async (_u: string, init: RequestInit) => {
    body = JSON.parse(init.body as string);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{}' }] } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  await createVibeGenerator({ apiKey: 'k', model, rpm: 600, fetchImpl, sleep: async () => {}, ...opts })('x');
  return body!;
}

test('vibe generator: thinking config valid for the lite models', async () => {
  assert.deepEqual((await bodyFor('gemini-2.5-flash-lite')).generationConfig.thinkingConfig, { thinkingBudget: 0 });
  assert.deepEqual((await bodyFor('gemini-3.5-flash-lite')).generationConfig.thinkingConfig, { thinkingLevel: 'low' });
  assert.deepEqual((await bodyFor('gemini-3.8-flash')).generationConfig.thinkingConfig, { thinkingLevel: 'low' });
});

test('vibe generator: restaurant prompt by default, place prompt and schema when given', async () => {
  const r = await bodyFor('gemini-2.5-flash-lite');
  assert.equal(r.systemInstruction.parts[0]!.text, VIBE_SYSTEM_PROMPT);
  assert.deepEqual(r.generationConfig.responseSchema, VIBE_RESPONSE_SCHEMA);
  const pl = await bodyFor('gemini-2.5-flash-lite', { systemPrompt: PLACE_SYSTEM_PROMPT, responseSchema: PLACE_RESPONSE_SCHEMA });
  assert.equal(pl.systemInstruction.parts[0]!.text, PLACE_SYSTEM_PROMPT);
  assert.deepEqual(pl.generationConfig.responseSchema, PLACE_RESPONSE_SCHEMA);
});

test('runner with the place flavor writes description+embedding with a null profile', async () => {
  const writes: Array<{ id: number; profile: unknown; description: string }> = [];
  const s = await runVibeEnrichment({
    rows: [p({ id: 1 }), p({ id: 2, name: 'B' })], flavor: PLACE_FLAVOR,
    inputs: new Map(), photoUrls: new Map(),
    isStillUnenriched: async () => true,
    fetchImage: async () => ({ image: null, reason: 'timeout' }),
    generate: async () => JSON.stringify({ description: okDesc }),
    embed: async () => [0.1],
    write: async (id, v) => { writes.push({ id, profile: v.profile, description: v.description }); return true; },
    chunk: 10, sleep: async () => {}, retryDelaysMs: [0, 0],
  });
  assert.equal(s.succeeded, 2);
  assert.deepEqual(writes.map((w) => [w.id, w.profile]), [[1, null], [2, null]]);
  assert.equal(s.samples[0]!.profile, null);
});

test('runner with the place flavor retries a guard rejection with the reason', async () => {
  const prompts: string[] = [];
  let n = 0;
  const quiet = JSON.stringify({ description: 'A neighborhood park with lawns and paths, a quiet place to wander on a sunny afternoon with a book or a dog.' });
  const s = await runVibeEnrichment({
    rows: [p({ id: 1, kind: 'park', osm_tags: null })], flavor: PLACE_FLAVOR,
    inputs: new Map(), photoUrls: new Map(),
    isStillUnenriched: async () => true,
    fetchImage: async () => ({ image: null }),
    generate: async (prompt) => { prompts.push(prompt); n++; return n === 1 ? quiet : JSON.stringify({ description: okDesc }); },
    embed: async () => [0.1], write: null, chunk: 10, sleep: async () => {}, retryDelaysMs: [0, 0],
  });
  assert.equal(s.succeeded, 1);
  assert.deepEqual(s.rejections, { sensory: 1, photo: 0, other: 0 });
  assert.match(prompts[1]!, /Your previous answer was rejected: unsupported sensory claim "quiet"/);
  assert.match(prompts[0]!, /kind=park/);
});
