import { describe, it, expect, vi } from 'vitest';
import { presentationSessionError, presentationShapeError, libraryForPrompt, usedMedia, presentationOf } from '../media/presentation';
import { localMediaQuestion, voiceFor, moodFor } from '../media/localDirector';
import { IMAGES, TRACKS, IMAGE_BY_ID } from '../media/registry';
import { REFERENCES } from '../media/references';
import { evidenceFrom } from '../evidence';
import { validateGeneration, validContext } from '../validation';
import { createLiveVibeSession } from '../liveEngine';
import { createProfilePublisher } from '../publisher';
import { createGeminiGenerator, withPresentationMeta } from '../../../../server/vibeGemini';
import { MODEL_KEY, type Answer, type GenerationContext, type Question, type Response } from '../profile';

const ctx = (text: string, history: Answer[] = []): GenerationContext => ({ sessionId: 'MEDIA-FIXTURE', version: history.length + 1, originalInput: { text, imageCount: 0, imageProcessing: 'not_sent' }, vibe_so_far: text, history, evidence: evidenceFrom(text, history), qualifiers: [] });
const answer = (question: Question, response: Response): Answer => ({ id: `a-${question.id}`, question, response });
const firstChoice = (q: Question): Response => ({ kind: 'choice', optionId: q.options[0].id });
const track = TRACKS[0];
const listening = (over: Record<string, unknown> = {}): Question => ({
  id: 'listen-1', family: 'soundtrack', topic: 'sound', prompt: 'Press play: what should tonight do with this feeling?', cultural: true,
  options: [{ id: 'a', label: 'Let it take over', description: 'A loud, moving night with music you can feel everywhere.', preference: 'want' }, { id: 'b', label: 'Keep it low', description: 'Music in the background, quiet enough to talk at a small table.', preference: 'want' }],
  presentation: { schema: 'vibenta-media/1', source: 'gemini', format: 'listening', voice: 'hype', mood: 'electric_party', trackId: track.id, design: { known: 'They want a fun night.', uncertainty: 'How loud and physical.', whyThisMedium: 'A song conveys energy fast.', branches: [{ optionId: 'a', leadsTo: 'Dance-forward places next.' }, { optionId: 'b', leadsTo: 'Conversation-friendly places next.' }] } },
  ...over,
} as Question);

describe('verified media registry', () => {
  it('has a varied library and every asset carries rights/verification metadata', () => {
    expect(TRACKS.length).toBeGreaterThanOrEqual(30);
    expect(REFERENCES.length).toBeGreaterThanOrEqual(60);
    expect(new Set(REFERENCES.map((r) => r.kind)).size).toBeGreaterThanOrEqual(6);
    for (const t of TRACKS) { expect(t.videoId).toMatch(/^[\w-]{11}$/); expect(t.verification).toMatch(/playableInEmbed/); expect(t.channel).toBeTruthy(); }
    for (const i of IMAGES) { expect(i.rights.license).toBeTruthy(); expect(i.rights.sourceUrl).toBeTruthy(); if (/sa/i.test(i.rights.license)) expect(i.rights.adaptation).toBe(false); }
    for (const r of REFERENCES) expect(r.source).toMatch(/^https:\/\/en\.wikipedia\.org\/wiki\//);
  });
  it('gives Gemini IDs and descriptions only, never URLs or embeds', () => {
    const lib = libraryForPrompt(ctx('x'));
    expect(JSON.stringify(lib)).not.toMatch(/https?:|youtube\.com|upload\.wikimedia|<iframe/i);
    expect(lib.tracks.length).toBe(TRACKS.length);
  });
});

describe('presentation validation', () => {
  it('accepts a complete listening question and rejects unknown media or missing design branches', () => {
    expect(presentationShapeError(listening())).toBeUndefined();
    expect(presentationShapeError(listening({ presentation: { ...presentationOf(listening())!, trackId: 'aud-made-up' } }))).toMatch(/trackId/);
    expect(presentationShapeError(listening({ presentation: { ...presentationOf(listening())!, design: { ...presentationOf(listening())!.design, branches: [] } } }))).toMatch(/branch/);
    expect(presentationShapeError(listening({ cultural: false }))).toMatch(/cultural=true/);
    expect(presentationShapeError(listening({ presentation: { ...presentationOf(listening())!, referenceIds: ['ref-not-real'] } }))).toMatch(/reference/);
  });
  it('enforces session variety: no repeated format, no reused media, media opener when required', () => {
    const h = [answer(listening(), firstChoice(listening()))];
    expect(presentationSessionError(listening({ id: 'listen-2' }), h)).toMatch(/twice in a row|already played/);
    const free = (id: string): Question => ({ ...listening({ id, cultural: false }), presentation: { ...presentationOf(listening())!, format: 'free_text', trackId: undefined, placeholder: 'a detail' } } as Question);
    const two = [answer(free('f1'), { kind: 'text', text: 'rooftop' }), answer(listening(), firstChoice(listening())), answer(free('f2'), { kind: 'text', text: 'snacks' }), answer(listening({ id: 'l2', presentation: { ...presentationOf(listening())!, trackId: TRACKS[1].id } }), firstChoice(listening()))];
    expect(presentationSessionError(free('f3'), two)).toMatch(/two free-text/);
    const plain = { ...listening(), presentation: undefined } as Question;
    expect(presentationSessionError(plain, [], true)).toMatch(/presentation/);
    expect(presentationSessionError(plain, [])).toBeUndefined();
    expect(usedMedia(two).tracks.size).toBe(2);
  });
  it('rejects a listening follow-up right after "I don’t know these"', () => {
    const h = [answer({ ...listening(), presentation: { ...presentationOf(listening())!, format: 'image_reveal', trackId: undefined, stageImageId: IMAGES[0].id } } as Question, { kind: 'unfamiliar' })];
    expect(presentationSessionError(listening({ presentation: { ...presentationOf(listening())!, trackId: TRACKS[2].id } }), h)).toMatch(/unfamiliar|recognizable/);
  });
});

describe('free-text answers', () => {
  it('become explicit evidence without retracting earlier answers, and survive context validation', () => {
    const q = listening();
    const h = [answer(q, firstChoice(q)), answer({ ...q, id: 'free', topic: 'occasion' }, { kind: 'text', text: 'a rooftop where I can see the harbor' })];
    const ev = evidenceFrom('need a fun night', h);
    expect(ev.some((e) => e.source === 'answer' && /rooftop/.test(e.text))).toBe(true);
    expect(ev.some((e) => /take over/i.test(e.text))).toBe(true);
    expect(validContext({ ...ctx('need a fun night', h) })).toBe(true);
  });
  it('reaches the next Gemini request in the user’s own words', async () => {
    const q = listening();
    const h = [answer(q, { kind: 'text', text: 'TEST somewhere with pinball and bad karaoke' })];
    const next = localMediaQuestion(ctx('need a fun night', h))!;
    const f = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ vibe_so_far: 'A chaotic, playful night with pinball and karaoke.', qualifiers: [], continuation: 'refine', reason: 'more', nextQuestion: next }) }] } }] })));
    await createGeminiGenerator({ apiKey: 'TEST-FIXTURE', fetchImpl: f as typeof fetch }).generate(ctx('need a fun night', h), new AbortController().signal);
    const sent = JSON.parse(JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body)).contents[0].parts[0].text);
    expect(sent.context.history[0].answer.ownWords).toContain('pinball and bad karaoke');
  });
});

describe('Gemini director contract (mocked transport)', () => {
  const reply = (nextQuestion: unknown) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ vibe_so_far: 'A loud, joyful night out with friends and dancing.', qualifiers: [], continuation: 'refine', reason: 'more', nextQuestion }) }] } }] }));
  it('requires a presentation, feeds the validation error back, and stamps source=gemini', async () => {
    const plain = { ...listening(), presentation: undefined };
    const f = vi.fn().mockResolvedValueOnce(reply(plain)).mockResolvedValueOnce(reply({ ...listening(), presentation: { ...presentationOf(listening())!, source: undefined, schema: undefined } }));
    const result = await createGeminiGenerator({ apiKey: 'TEST-FIXTURE', fetchImpl: f as typeof fetch }).generate(ctx('Need a fun night.'), new AbortController().signal);
    expect(f).toHaveBeenCalledTimes(2);
    const second = JSON.parse(JSON.parse(String((f.mock.calls[1] as unknown as [string, RequestInit])[1].body)).contents[0].parts[0].text);
    expect(second.validationFeedback).toMatch(/presentation/);
    expect(presentationOf(result.nextQuestion!)).toMatchObject({ source: 'gemini', schema: 'vibenta-media/1', format: 'listening' });
  });
  it('strips fields that do not belong to the chosen format', () => {
    const q = withPresentationMeta({ ...listening(), presentation: { ...presentationOf(listening())!, stageImageId: '', optionImages: [], blend: { from: 'fog', to: 'neon', fromLabel: 'x', toLabel: 'y' } } })!;
    expect(presentationOf(q)).not.toHaveProperty('blend');
    expect(presentationOf(q)).not.toHaveProperty('stageImageId');
  });
  it('rejects an option set that reuses an already-played track even if the JSON is well formed', () => {
    const h = [answer(listening(), firstChoice(listening()))];
    expect(() => validateGeneration({ vibe_so_far: 'A loud joyful night out.', qualifiers: [], continuation: 'refine', reason: 'x', nextQuestion: listening({ id: 'again', topic: 'pace' }) }, ctx('Need a fun night.', h))).toThrow();
  });
});

describe('offline local director (labeled, not Gemini)', () => {
  const inputs = ['Need a fun night.', 'Haunted but somehow romantic.', "Coffee. Brain's fried.", 'I want something like a 2000s house party.', "I want to feel like I'm in Blade Runner."];
  it('chooses a different voice and palette per input', () => {
    expect(new Set(inputs.map(voiceFor)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(inputs.map(moodFor)).size).toBeGreaterThanOrEqual(4);
  });
  it('opens with real media and never repeats media or format back-to-back across a session', () => {
    for (const text of inputs) {
      const h: Answer[] = [];
      for (let i = 0; i < 8; i++) {
        const q = localMediaQuestion(ctx(text, h));
        if (!q) break;
        const p = presentationOf(q)!;
        expect(p.source).toBe('local');
        if (i === 0) expect(['image_choice', 'image_reveal', 'image_blend', 'listening']).toContain(p.format);
        expect(presentationShapeError(q)).toBeUndefined();
        expect(presentationSessionError(q, h)).toBeUndefined();
        h.push(answer(q, p.format === 'free_text' ? { kind: 'text', text: 'a window seat when it rains' } : firstChoice(q)));
      }
      const used = h.flatMap((a) => { const p = presentationOf(a.question)!; return [...(p.optionImages?.map((o) => o.imageId) ?? []), p.stageImageId, p.trackId].filter(Boolean); });
      expect(new Set(used).size).toBe(used.length);
      expect(h.length).toBeGreaterThanOrEqual(4);
    }
  });
  it('drives the live engine with media questions when Gemini is unavailable', async () => {
    const offline = { generate: async () => { throw Error('TEST FIXTURE Gemini unavailable'); } };
    const s = createLiveVibeSession(offline, { embed: async () => ({ modelKey: MODEL_KEY, vector: Array.from({ length: 384 }, (_, i) => i === 0 ? 1 : 0) }) }, createProfilePublisher());
    s.start('Haunted but somehow romantic.');
    await vi.waitFor(() => expect(s.getSnapshot()?.phase).toBe('question'));
    const q = s.getSnapshot()!.question!;
    expect(presentationOf(q)?.source).toBe('local');
    expect(s.getSnapshot()!.generation).toBe('fallback');
    s.answer(firstChoice(q));
    await vi.waitFor(() => expect(s.getSnapshot()?.history.length).toBe(1));
    await vi.waitFor(() => expect(s.getSnapshot()?.question?.id).not.toBe(q.id));
    expect(presentationOf(s.getSnapshot()!.question!)?.format).not.toBe(presentationOf(q)!.format);
    s.destroy();
  });
  it('only transforms images whose license permits adaptation', () => {
    for (const text of inputs) for (let i = 0; i < 10; i++) {
      const q = localMediaQuestion(ctx(text));
      const p = q && presentationOf(q);
      if (p?.format === 'image_blend') expect(IMAGE_BY_ID.get(p.stageImageId!)!.rights.adaptation).toBe(true);
    }
  });
});

describe('scene bridge (map atmosphere through the Composer’s existing sceneIntent input)', async () => {
  const { sceneIntentFor, MOOD_PRESETS, acceptedMood } = await import('../media/sceneBridge');
  const { intentFromProfile } = await import('../../scene/profiles');
  const { PRESET_IDS } = await import('../../scene/presets');
  it('sends nothing before an answer, then valid presets that follow the accepted mood', async () => {
    const offline = { generate: async () => { throw Error('TEST FIXTURE Gemini unavailable'); } };
    const s = createLiveVibeSession(offline, { embed: async () => ({ modelKey: MODEL_KEY, vector: Array.from({ length: 384 }, (_, i) => i === 0 ? 1 : 0) }) }, createProfilePublisher());
    s.start('Haunted but somehow romantic.');
    await vi.waitFor(() => expect(s.getSnapshot()?.phase).toBe('question'));
    expect(s.getSnapshot()!.sceneIntent).toBeUndefined();
    s.answer(firstChoice(s.getSnapshot()!.question!));
    await vi.waitFor(() => expect(s.getSnapshot()?.phase).toBe('question'));
    const p = s.getSnapshot()!; const intent = p.sceneIntent as ReturnType<typeof sceneIntentFor>;
    expect(intent!.sessionVersion).toBe(p.version);
    expect(intent!.presets.every((x) => (PRESET_IDS as readonly string[]).includes(x.id) && x.weight > 0)).toBe(true);
    expect(intent!.presets.reduce((a, x) => a + x.weight, 0)).toBeLessThanOrEqual(1.0001);
    expect(MOOD_PRESETS[acceptedMood(p)!].map(([id]) => id)).toContain(intent!.presets[0].id);
    // Atmosphere only: ranking still depends solely on embeddings + real catalog vectors.
    expect(intentFromProfile(p).descriptors).toEqual(intent!.descriptors);
    s.destroy();
  });
  it('maps every mood to known Composer presets', () => {
    for (const mix of Object.values(MOOD_PRESETS)) for (const [id] of mix) expect(PRESET_IDS as readonly string[]).toContain(id);
  });
});

describe('local director varies by input and branches on answers', () => {
  const inputs = ['Need a fun night.', 'Haunted but somehow romantic.', 'I want something like a 2000s house party.', "I want to feel like I'm in Blade Runner.", 'Somewhere I can think.'];
  it('does not open every vibe with the same format', () => {
    const openers = inputs.map((t) => presentationOf(localMediaQuestion(ctx(t))!)!.format);
    expect(new Set(openers).size).toBeGreaterThanOrEqual(3);
  });
  it('a calm answer and a loud answer lead to different next questions and palettes', () => {
    const first = localMediaQuestion(ctx('Need a fun night.'))!;
    const calm: Answer = answer(first, { kind: 'text', text: 'a candle on the table, quiet, nobody in a hurry' });
    const loud: Answer = answer(first, { kind: 'text', text: 'loud music, a packed dance floor and a disco ball' });
    const a = localMediaQuestion(ctx('Need a fun night.', [calm]))!, b = localMediaQuestion(ctx('Need a fun night.', [loud]))!;
    // One answer already changes what is asked next…
    expect(JSON.stringify([presentationOf(a)!.format, a.options])).not.toBe(JSON.stringify([presentationOf(b)!.format, b.options]));
    // …and consistent answers move the palette, while a single answer cannot flip the whole session.
    const calm2 = localMediaQuestion(ctx('Need a fun night.', [calm, answer(a, { kind: 'text', text: 'somewhere calm and quiet by the water, candles on the table' })]))!;
    const loud2 = localMediaQuestion(ctx('Need a fun night.', [loud, answer(b, { kind: 'text', text: 'more dancing, a disco ball and a festive crowd' })]))!;
    expect(presentationOf(calm2)!.mood).not.toBe(presentationOf(loud2)!.mood);
  });
  it('treats “without loud music” as calm, not loud', () => {
    expect(moodFor('a calmer place without loud music')).not.toBe('electric_party');
  });
});

describe('coffee input is adaptive (authored opener retired)', () => {
  it('"Coffee. Brain\'s fried." gets no authored scene and a low-friction media question offline', async () => {
    const { sessionBQuestion } = await import('../sessionB');
    expect(sessionBQuestion(ctx("Coffee. Brain's fried."))).toBeUndefined();
    const q = localMediaQuestion(ctx("Coffee. Brain's fried."))!;
    expect(q.id.startsWith('session-b/')).toBe(false);
    expect(presentationOf(q)!.voice).toBe('deadpan');
    expect(q.options.length).toBeLessThanOrEqual(3);
  });
});

describe('no format dominates a session', () => {
  it('no format appears more than twice in six local questions for any test input', () => {
    for (const text of ['Haunted but somehow romantic.', 'Need a fun night.', "Coffee. Brain's fried.", "I don't know what I want.", 'I want something that feels nostalgic but exciting.']) {
      const h: Answer[] = [];
      for (let i = 0; i < 6; i++) { const q = localMediaQuestion(ctx(text, h)); if (!q) break; const p = presentationOf(q)!; h.push(answer(q, p.format === 'free_text' ? { kind: 'text', text: 'a window seat' } : firstChoice(q))); }
      const counts = h.reduce<Record<string, number>>((m, a) => { const f = presentationOf(a.question)!.format; m[f] = (m[f] ?? 0) + 1; return m; }, {});
      expect(Math.max(...Object.values(counts)), `${text}: ${JSON.stringify(counts)}`).toBeLessThanOrEqual(2);
    }
  });
});
