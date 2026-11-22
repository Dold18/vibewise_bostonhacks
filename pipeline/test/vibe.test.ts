import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GeminiQuotaError } from '../src/gemini.ts';
import { runVibeEnrichment, type VibeDeps } from '../src/enrichVibe.ts';
import {
  DESCRIPTIVE_CAP, buildBundle, descriptiveLength, capText, cleanText, parseVibeResponse, sample, seededRandom, type VibeRestaurant,
} from '../src/vibe.ts';

const r = (o: Partial<VibeRestaurant> = {}): VibeRestaurant => ({
  id: 1, name: 'Taiwan Cafe', category: 'restaurant', cuisines: ['taiwanese'], price_band: '$',
  osm_tags: { outdoor_seating: 'yes', cuisine: 'taiwanese' }, context_features: null, ...o,
});

test('cleanText strips markup and collapses whitespace', () => {
  assert.equal(cleanText('<p>Hello   <b>world</b></p>\n<p>again &amp; more</p>'), 'Hello world again & more');
});

test('capText cuts at a word boundary and marks truncation', () => {
  const t = 'word '.repeat(300).trim();
  const c = capText(t, 50);
  assert.ok(c.length <= 51 && c.endsWith('…') && !c.includes('wor…'));
  assert.equal(capText('short', 50), 'short');
});

test('bundle: facts always, descriptive sources labeled and capped, licenses folded into facts', () => {
  const b = buildBundle(r(), [
    { place_ref: 1, source: 'website', content: `<p>${'Great noodles. '.repeat(200)}</p>` },
    { place_ref: 1, source: 'wiki', content: 'Wikivoyage: cozy spot.' },
    { place_ref: 1, source: 'city_licenses', content: 'Entertainment license: Non-Live Entertainment, capacity 30.' },
  ]);
  assert.match(b.prompt, /^Facts: name=Taiwan Cafe, cuisine=taiwanese, price=\$, category=restaurant/);
  assert.match(b.prompt, /Amenity tags \(OpenStreetMap\): outdoor_seating=yes/);
  assert.doesNotMatch(b.prompt, /cuisine=taiwanese, .*cuisine=taiwanese/);
  assert.match(b.prompt, /City license records: Entertainment license/);
  assert.match(b.prompt, /From the restaurant's own website: Great noodles\./);
  assert.match(b.prompt, /From a travel guide: Wikivoyage: cozy spot\./);
  const web = b.prompt.split("From the restaurant's own website: ")[1]!.split('\n')[0]!;
  assert.ok(web.length <= DESCRIPTIVE_CAP + 1);
  assert.ok(b.hasDescriptive && b.hasPrice);
  assert.doesNotMatch(b.prompt.split('City license records:')[1]!.split('\n')[0]!, /From the/);
});

test('bundle: facts only when there is nothing else', () => {
  const b = buildBundle(r({ price_band: 'unknown', osm_tags: null, cuisines: [] }), []);
  assert.match(b.prompt, /^Facts: name=Taiwan Cafe, price=unknown, category=restaurant\n/);
  assert.match(b.prompt, /Atmosphere evidence: NONE beyond category and price/);
  assert.match(b.prompt, /Do not state lighting, noise level, decor, crowd or music/);
  assert.equal(b.hasDescriptive, false);
  assert.equal(b.hasPrice, false);
});

const good = JSON.stringify({
  description: 'Casual Taiwanese spot serving rice platters and fried pork chop at low prices, with a casual, quick-service feel suited to a weeknight bite.',
  profile: { cuisines: ['Taiwanese'], signature_dishes: ['fried pork chop'], dietary_options: [], price_feel: 'cheap', median_entree_price: 14 },
});

test('bundle names the atmosphere evidence that exists', () => {
  const web = [{ place_ref: 1, source: 'website', content: 'We serve hand-pulled noodles in a small family-run dining room with long communal tables and a loud open kitchen. Grandma started the place in 1982 and the recipes have not changed since; expect steaming bowls, crisp dumplings and strong tea.' }];
  assert.match(buildBundle(r(), web).prompt, /Atmosphere evidence: website text\. State a sensory detail/);
  assert.match(buildBundle(r(), [], true).prompt, /Atmosphere evidence: a photo\./);
  assert.match(buildBundle(r(), web, true).prompt, /website text and a photo/);
});

test('parse rejects sensory claims when there is no atmosphere evidence', () => {
  const dim = JSON.stringify({
    description: 'This neighborhood pub offers casual drinks at moderate prices, with dim lighting and an unpretentious feel for friends.',
    profile: { cuisines: ['pub'], signature_dishes: [], dietary_options: [], price_feel: 'moderate', median_entree_price: null },
  });
  assert.throws(() => parseVibeResponse(dim, { hasDescriptive: false, hasPhoto: false, hasPrice: true }), /unsupported sensory claim "dim"/);
  // The same words are fine when the input supports them.
  assert.doesNotThrow(() => parseVibeResponse(dim, { hasDescriptive: true, hasPhoto: false, hasPrice: true }));
  assert.doesNotThrow(() => parseVibeResponse(dim, { hasDescriptive: false, hasPhoto: true, hasPrice: true }));
  const vague = JSON.stringify({
    description: 'A casual, unpretentious neighborhood pub serving drinks and tavern fare at moderate prices, suited to relaxed evenings with friends.',
    profile: { cuisines: ['pub'], signature_dishes: [], dietary_options: [], price_feel: 'moderate', median_entree_price: null },
  });
  assert.doesNotThrow(() => parseVibeResponse(vague, { hasDescriptive: false, hasPhoto: false, hasPrice: true }));
});

test('parse accepts a valid answer', () => {
  const v = parseVibeResponse(good, { hasDescriptive: true, hasPhoto: false, hasPrice: true });
  assert.equal(v.profile.median_entree_price, 14);
  assert.deepEqual(v.profile.signature_dishes, ['fried pork chop']);
});

test('parse clears unevidenced dishes and prices, and price_feel without a price signal', () => {
  const v = parseVibeResponse(good, { hasDescriptive: false, hasPhoto: false, hasPrice: false });
  assert.deepEqual(v.profile.signature_dishes, []);
  assert.equal(v.profile.median_entree_price, null);
  assert.equal(v.profile.price_feel, null);
  assert.deepEqual(v.profile.cuisines, ['Taiwanese']);
});

test('parse rejects bad output', () => {
  const ctx = { hasDescriptive: true, hasPhoto: false, hasPrice: true };
  assert.throws(() => parseVibeResponse('nope', ctx), /not valid JSON/);
  assert.throws(() => parseVibeResponse('{"description":"short","profile":{}}', ctx), /too short/);
  assert.throws(() => parseVibeResponse(JSON.stringify({ description: 'x'.repeat(2000), profile: {} }), ctx), /too long/);
  const bad = JSON.parse(good); bad.profile.price_feel = 'pricey'; bad.profile.median_entree_price = -3;
  const v = parseVibeResponse(JSON.stringify(bad), ctx);
  assert.equal(v.profile.price_feel, null);
  assert.equal(v.profile.median_entree_price, null);
});

test('sample is uniform-size, unique, reproducible with a seed, and does not mutate the input', () => {
  const ids = Array.from({ length: 100 }, (_, i) => i);
  const a = sample(ids, 10, seededRandom(7));
  assert.equal(a.length, 10);
  assert.equal(new Set(a).size, 10);
  assert.deepEqual(a, sample(ids, 10, seededRandom(7)));
  assert.equal(ids[0], 0);
  assert.equal(sample(ids, 500).length, 100);
});

function deps(over: Partial<VibeDeps> = {}): VibeDeps & { written: number[]; calls: number } {
  const state = { written: [] as number[], calls: 0 };
  const d: VibeDeps = {
    rows: [r({ id: 1 }), r({ id: 2, name: 'B' }), r({ id: 3, name: 'C' })],
    inputs: new Map(), photoUrls: new Map(),
    isStillUnenriched: async () => true,
    fetchImage: async () => ({ image: null, reason: 'timeout' }),
    generate: async () => { state.calls++; return good; },
    embed: async () => [0.1, 0.2],
    write: async (id) => { state.written.push(id); return true; },
    chunk: 2, sleep: async () => {}, retryDelaysMs: [0, 0],
    ...over,
  };
  Object.defineProperties(d, { written: { get: () => state.written }, calls: { get: () => state.calls } });
  return d as VibeDeps & { written: number[]; calls: number };
}

test('runner enriches every row and writes only selected ids', async () => {
  const d = deps();
  const s = await runVibeEnrichment(d);
  assert.equal(s.succeeded, 3);
  assert.deepEqual(d.written, [1, 2, 3]);
  assert.equal(s.failed.length, 0);
});

test('runner skips rows enriched since selection without calling Gemini', async () => {
  const d = deps({ isStillUnenriched: async (id) => id !== 2 });
  const s = await runVibeEnrichment(d);
  assert.equal(s.skippedAlreadyDone, 1);
  assert.equal(d.calls, 2);
  assert.deepEqual(d.written, [1, 3]);
});

test('runner retries a malformed answer, then records the failure without crashing the batch', async () => {
  let n = 0;
  const d = deps({ generate: async () => { n++; return n <= 3 ? 'garbage' : good; } });
  const s = await runVibeEnrichment(d);
  assert.equal(s.failed.length, 1);
  assert.equal(s.failed[0]!.id, 1);
  assert.equal(s.succeeded, 2);
  assert.equal(n, 5);
});

test('runner stops early after repeated quota failures', async () => {
  const d = deps({
    rows: Array.from({ length: 6 }, (_, i) => r({ id: i + 1 })),
    generate: async () => { throw new GeminiQuotaError('429'); },
  });
  const s = await runVibeEnrichment(d);
  assert.match(s.stoppedEarly ?? '', /3 rows in a row/);
  assert.equal(s.failed.length, 3);
  assert.equal(d.written.length, 0);
});

test('dry run writes nothing', async () => {
  const s = await runVibeEnrichment(deps({ write: null }));
  assert.equal(s.succeeded, 3);
});

test('runner counts guard rejections and retried rows', async () => {
  const dim = JSON.stringify({
    description: 'This neighborhood pub offers casual drinks at moderate prices, with dim lighting and an unpretentious feel for friends.',
    profile: { cuisines: ['pub'], signature_dishes: [], dietary_options: [], price_feel: 'moderate', median_entree_price: null },
  });
  let n = 0;
  // Row 1: guard rejects once, then passes. Rows 2 and 3: pass first time.
  const d = deps({ generate: async () => { n++; return n === 1 ? dim : good; } });
  const s = await runVibeEnrichment(d);
  assert.equal(s.succeeded, 3);
  assert.equal(s.retriedRows, 1);
  assert.deepEqual(s.rejections, { sensory: 1, photo: 0, other: 0 });
});

test('descriptiveLength ignores chain boilerplate and counts real content', () => {
  const dunkin = "Find your nearest Dunkin' at 806 Providence Hwy in Dedham and enjoy Dunkin's signature drinks, coffee, espresso, breakfast sandwiches and more! skip to main content 806 Providence Hwy";
  const bk = 'Explore the Burger King menu, find a location near you, and order your favorite flame-grilled burgers for pickup or delivery.';
  const kfc = "Visit your local KFC® at 625 American Legion Hwy in MA for our delicious fried chicken buckets! Skip to content Link to main website Menu Careers About Find a KFC Start order Link to account Link to cart";
  const real = 'Noir is a chic, cozy bar serving craft cocktails and a menu of delectable bites in the heart of Harvard Square, mixing the nostalgic past with a contemporary style for a timeless and fresh experience.';
  assert.ok(descriptiveLength(dunkin) < 200, String(descriptiveLength(dunkin)));
  assert.ok(descriptiveLength(bk) < 200, String(descriptiveLength(bk)));
  assert.ok(descriptiveLength(kfc) < 200, String(descriptiveLength(kfc)));
  assert.ok(descriptiveLength(real) >= 150, String(descriptiveLength(real)));
});

test('bundle demotes boilerplate text to facts-only and keeps real descriptive text', () => {
  const boiler = [{ place_ref: 1, source: 'website', content: "Find your nearest Dunkin' at 806 Providence Hwy in Dedham and enjoy Dunkin's signature drinks, coffee, espresso, breakfast sandwiches and more! skip to main content 806 Providence Hwy" }];
  const b = buildBundle(r({ name: "Dunkin'" }), boiler);
  assert.equal(b.hasDescriptive, false);
  assert.doesNotMatch(b.prompt, /From the restaurant's own website/);
  assert.match(b.prompt, /Atmosphere evidence: NONE/);
  const real = [{ place_ref: 1, source: 'website', content: 'Noir is a chic, cozy bar serving craft cocktails and a menu of delectable bites in the heart of Harvard Square, mixing the nostalgic past with a contemporary style for a timeless and fresh experience, with a hidden back room and a fireplace.' }];
  const g = buildBundle(r({ name: 'Noir' }), real);
  assert.equal(g.hasDescriptive, true);
  assert.match(g.prompt, /From the restaurant's own website: Noir is a chic/);
});

test('parse rejects photo narration but keeps photo-derived detail', () => {
  const ctx = { hasDescriptive: false, hasPhoto: true, hasPrice: true };
  const mk = (description: string) => JSON.stringify({ description, profile: { cuisines: ['pizza'], signature_dishes: [], dietary_options: [], price_feel: 'cheap', median_entree_price: null } });
  for (const bad of [
    'A cheap pizza counter for takeout. The photo displays a crisp-crusted pizza with pepperoni and green peppers on top.',
    'A cheap pizza counter for takeout and delivery, pictured with a wood-fired oven and a long marble counter inside.',
    'A cheap pizza counter for takeout; in the image, a bright counter and glass cases are visible behind the register.',
  ]) assert.throws(() => parseVibeResponse(mk(bad), ctx), /photo narration/);
  // Same detail stated as a fact about the place passes.
  assert.doesNotThrow(() => parseVibeResponse(mk('A cheap pizza counter for takeout, with a wood-fired oven, a long marble counter and glass cases behind the register, serving crisp-crusted pies topped with pepperoni and peppers.'), ctx));
  // The word "photo" in other roles is not narration.
  assert.doesNotThrow(() => parseVibeResponse(mk('A cheap pizza counter for takeout and delivery, popular for photo-friendly slices and quick dinners with friends around town.'), ctx));
});
