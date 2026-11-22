// Ranking-logic check with the REAL pinned MiniLM (server-side, local inference).
// Venues are FIXTURE descriptions written for this check, never catalog records or real scores.
// It verifies that the quiz's evidence → embedding → rankCandidates path responds correctly to
// preferences, explicit dislikes, changes of mind and new evidence. Real catalog ranking still
// requires the verified Supabase vectors (see docs/VIBE_QUIZ_V2_ACCEPTANCE.md).
import { createMiniLM } from '../server/miniLM.ts';
import { embeddingText, evidenceFrom, negativeText } from '../src/features/vibe/evidence.ts';
import { rankCandidates } from '../src/features/vibe/adapters.ts';
import { MODEL_KEY } from '../src/features/vibe/profile.ts';

const FIXTURE_VENUES = {
  club: 'FIXTURE: Loud nightclub with a packed dance floor, a DJ, strobe lights and late-night crowds.',
  cafe: 'FIXTURE: Quiet neighborhood cafe with soft lighting, armchairs, good coffee and room to talk.',
  jazz: 'FIXTURE: Small candlelit jazz bar with live trio sets, low lighting and intimate tables.',
  arcade: 'FIXTURE: Retro arcade bar with pinball machines, neon signs, cheap snacks and friendly competition.',
  books: 'FIXTURE: Cozy used bookshop with a reading nook, warm lamps and an unhurried, quiet atmosphere.',
  karaoke: 'FIXTURE: Rowdy karaoke bar with private rooms, loud singalongs and a party crowd.',
};
const mini = createMiniLM(); const signal = new AbortController().signal;
const venues = await Promise.all(Object.entries(FIXTURE_VENUES).map(async ([id, text]) => ({ id, location: { lat: 42.35, lng: -71.06 }, embedding: (await mini.embed(text, signal)).vector, modelKey: MODEL_KEY, eligible: true, provenance: 'fixture' })));
const q = (id, prompt, options) => ({ id, family: 'original', topic: 'pace', prompt, cultural: false, options: options.map(([oid, label, description, preference = 'want']) => ({ id: oid, label, description, preference })) });
const night = q('night', 'What should tonight do?', [['loud', 'All in', 'A loud, packed night of dancing and singing with a big crowd.'], ['calm', 'Keep it calm', 'A quiet, cozy place with soft lighting where we can talk.']]);
const veto = q('veto', 'What would break the spell?', [['dance', 'Packed dance floor', 'A loud packed dance floor with strobe lights.', 'avoid']]);
const jazz = q('jazz', 'One more detail?', [['live', 'Live music up close', 'Live jazz played close by in a small candlelit room.']]);

async function rank(input, history) {
  const evidence = evidenceFrom(input, history);
  const vector = (await mini.embed(embeddingText(input, evidence), signal)).vector;
  const avoid = negativeText(evidence);
  const negativeVector = avoid ? (await mini.embed(avoid, signal)).vector : undefined;
  const profile = { sessionId: 'FIXTURE', version: 1, embedding: { status: 'ready', modelKey: MODEL_KEY, version: 1, vector, ...(negativeVector ? { negativeVector } : {}) } };
  return rankCandidates(profile, venues).all.map((r) => `${r.id}:${r.score.toFixed(3)}`);
}
const a = (question, optionId) => ({ id: `a-${question.id}`, question, response: { kind: 'choice', optionId } });
const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok }); console.log(ok ? 'PASS' : 'FAIL', name, '\n   ', detail.join('  ')); };
const top = (r) => r[0].split(':')[0];

const loud = await rank('Need a fun night', [a(night, 'loud')]);
check('positive preference: "all in" ranks a loud dance venue first', ['club', 'karaoke'].includes(top(loud)), loud);
const calm = await rank('Need a fun night', [a(night, 'calm')]);
check('change of mind: revising to "keep it calm" moves a quiet venue to the top', ['cafe', 'books', 'jazz'].includes(top(calm)), calm);
const fun = await rank('Need a fun night with friends', []);
const vetoed = await rank('Need a fun night with friends', [a(veto, 'dance')]);
const pos = (r, id) => r.findIndex((x) => x.startsWith(`${id}:`));
check('explicit dislike: vetoing a packed dance floor demotes the nightclub', pos(vetoed, 'club') > pos(fun, 'club') && pos(vetoed, 'club') >= 3, ['before', ...fun, '| after', ...vetoed]);
const withJazz = await rank('Need a fun night', [a(night, 'calm'), a(jazz, 'live')]);
check('new evidence: adding "live jazz up close" moves the jazz bar up', pos(withJazz, 'jazz') < pos(calm, 'jazz') || top(withJazz) === 'jazz', ['before', ...calm, '| after', ...withJazz]);
const text = await rank('Not loud, no crowds. Somewhere I can think.', []);
check('negated free text does not pull toward loud venues', !['club', 'karaoke'].includes(top(text)) && pos(text, 'club') >= 3, text);
console.log(`${checks.filter((c) => c.ok).length}/${checks.length} passed (real MiniLM ${MODEL_KEY}; FIXTURE venues)`);
process.exit(checks.every((c) => c.ok) ? 0 : 1);
