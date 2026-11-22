// Live Gemini evaluation (REAL authenticated requests only). Reads GEMINI_API_KEY from the root .env
// (or VIBENTA_ENV_FILE) server-side; never prints it. Without a key it reports BLOCKED and exits 2:
// it never substitutes fixtures or the local director.
// Usage: node scripts/gemini-live-eval.mjs   → /private/tmp/vibenta-gemini-eval/report.json
import { mkdirSync, writeFileSync } from 'node:fs';
import { createGeminiGenerator } from '../server/vibeGemini.ts';
import { evidenceFrom } from '../src/features/vibe/evidence.ts';
import { presentationOf } from '../src/features/vibe/media/presentation.ts';

try { process.loadEnvFile(process.env.VIBENTA_ENV_FILE ?? new URL('../../../.env', import.meta.url)); } catch { /* reported below */ }
if (!process.env.GEMINI_API_KEY) { console.log('BLOCKED: GEMINI_API_KEY is not configured in the root .env (server-side only). No Gemini request was made.'); process.exit(2); }
const OUT = process.env.VIBENTA_EVAL_OUTPUT ?? '/private/tmp/vibenta-gemini-eval'; mkdirSync(OUT, { recursive: true });
const gen = createGeminiGenerator({ apiKey: process.env.GEMINI_API_KEY, model: process.env.VIBE_GEMINI_MODEL });

// Scripted answer policies. "contradict" picks the first option, then writes the opposite in free text / a correction.
const SESSIONS = [
  ['Haunted but somehow romantic', 'first'], ['Haunted but somehow romantic', 'last'], ["Coffee. Brain's fried.", 'first'],
  ['Need a fun night', 'first'], ['Need a fun night', 'contradict'], ['I want something that feels nostalgic but exciting', 'first'],
  ["I don't know what I want", 'first'], ['Something for tonight.', 'last'], ['Make me forget this week.', 'contradict'],
];
const BANNED = /\b(embark|tapestry|symphony|whispers?|elevate|curated|vibe check|journey of)\b/i;
const ctxFor = (text, history, summary, qualifiers, version, sessionId) => ({ sessionId, version, originalInput: { text, imageCount: 0, imageProcessing: 'not_sent' }, vibe_so_far: summary, history, evidence: evidenceFrom(text, history), qualifiers });

const report = { generatedAt: new Date().toISOString(), model: process.env.VIBE_GEMINI_MODEL ?? 'gemini-3.5-flash-lite', sessions: [] };
for (const [index, [text, policy]] of SESSIONS.entries()) {
  const sessionId = `LIVE-EVAL-${Date.now().toString(36)}-${index}`;
  const session = { input: text, policy, turns: [], errors: [] };
  let history = [], summary = text, qualifiers = [];
  for (let turn = 0; turn < 5; turn++) {
    const started = Date.now();
    let result;
    try { result = await gen.generate(ctxFor(text, history, summary, qualifiers, turn + 1, sessionId), AbortSignal.timeout(40000)); } catch (e) { session.errors.push(`turn ${turn + 1}: ${e.message}`); break; }
    const q = result.nextQuestion, p = q && presentationOf(q);
    session.turns.push({ ms: Date.now() - started, summary: result.vibe_so_far, qualifiers: result.qualifiers, continuation: result.continuation, question: q && { prompt: q.prompt, cultural: q.cultural, options: q.options.map((o) => `${o.label} — ${o.description}`), format: p?.format, voice: p?.voice, mood: p?.mood, media: p && [...(p.optionImages?.map((o) => o.imageId) ?? []), p.stageImageId, p.trackId].filter(Boolean), referenceIds: p?.referenceIds ?? [], referenceNote: p?.referenceNote, design: p?.design } });
    summary = result.vibe_so_far; qualifiers = result.qualifiers;
    if (!q) break;
    let response;
    if (policy === 'contradict' && turn === 1) response = { kind: 'correction', text: 'Actually, somewhere quiet where we can talk. Not loud.' };
    else if (p?.format === 'free_text') response = { kind: 'text', text: policy === 'contradict' ? 'Honestly I want to dance, but only for an hour' : 'a window seat and something warm to eat' };
    else response = { kind: 'choice', optionId: q.options[policy === 'last' ? q.options.length - 1 : 0].id };
    session.turns.at(-1).answered = response;
    history = [...history, { id: `a${turn}`, question: q, response }];
  }
  const qs = session.turns.map((t) => t.question).filter(Boolean);
  // Heuristic quality signals for human review; they do not replace reading the questions.
  session.signals = {
    formats: qs.map((q) => q.format), distinctFormats: new Set(qs.map((q) => q.format)).size,
    referencesIntroduced: [...new Set(qs.flatMap((q) => q.referenceIds))], tracks: qs.flatMap((q) => q.media ?? []).filter((m) => m.startsWith('aud-')),
    voices: [...new Set(qs.map((q) => q.voice))], moods: qs.map((q) => q.mood),
    bannedPhrases: qs.filter((q) => BANNED.test(`${q.prompt} ${q.options.join(' ')}`)).map((q) => q.prompt),
    respondsToPrevious: qs.slice(1).map((q, i) => { const a = session.turns[i].answered; const said = a?.kind === 'choice' ? session.turns[i].question.options.find((o) => o.startsWith(session.turns[i].question.options[0]?.split(' — ')[0]))?.split(' — ')[0] : a?.text; return !!said && (q.prompt + q.design?.known).toLowerCase().includes(String(said).toLowerCase().split(/\W+/).filter((w) => w.length > 4)[0] ?? '\u0000'); }),
    meanLatencyMs: Math.round(session.turns.reduce((s, t) => s + t.ms, 0) / Math.max(1, session.turns.length)),
  };
  report.sessions.push(session);
  console.log(`${text} [${policy}] formats=${session.signals.formats.join('→')} refs=${session.signals.referencesIntroduced.join(',') || '—'} voices=${session.signals.voices.join(',')} errors=${session.errors.length}`);
}
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
console.log(`REAL Gemini report: ${OUT}/report.json — read the questions themselves before judging quality.`);
