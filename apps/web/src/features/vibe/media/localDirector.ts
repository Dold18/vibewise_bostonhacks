/** Offline director: used only when Gemini is unavailable. Deterministic retrieval
 * from the verified registry; always labeled source:'local'. It keeps the experience
 * multimodal but makes no claim to Gemini's cultural or creative judgment. */
import { guidanceFor, hash } from '../families.ts';
import type { Choice, GenerationContext, Question, Topic } from '../profile.ts';
import { presentationOf, presentationSessionError, usedMedia } from './presentation.ts';
import { IMAGES, TRACKS } from './registry.ts';
import { REFERENCES } from './references.ts';
import type { ImageAsset, MediaFormat, Mood, QuestionPresentation, Transform, Voice } from './types.ts';

const SYNONYMS: Record<string, string> = {
  fun: 'party joyful playful festive nightlife glowing', party: 'party dance disco nightlife festive crowd', haunted: 'eerie gothic foggy haunting candlelit misty', spooky: 'eerie gothic creepy',
  romantic: 'romantic intimate candlelit warm dreamy', coffee: 'cafe cozy warm calm', fried: 'calm cozy slow quiet', tired: 'calm cozy slow quiet',
  '2000s': 'party retro nostalgic disco fun', house: 'party festive', blade: 'neon rain night city electric moody', runner: 'neon rain futuristic',
  cyberpunk: 'neon rain futuristic', nostalgic: 'nostalgic retro vintage', chill: 'calm slow', wild: 'chaotic party crowd', weird: 'whimsical eerie curious', date: 'romantic intimate',
  outdoors: 'nature wild fresh', quiet: 'quiet calm', adventure: 'explore wild', mysterious: 'eerie foggy curious', sad: 'melancholy reflective lonely',
  think: 'quiet calm scholarly reflective', forget: 'playful escape glowing fun', surprise: 'whimsical curious playful', low: 'calm quiet cozy', key: 'calm',
  candle: 'candlelit warm intimate', hurry: 'slow calm', calmer: 'calm quiet', talk: 'intimate quiet', dancing: 'dance party', loud: 'crowd party electric', energy: 'electric party',
};
const NEGATORS = new Set(['not', 'no', 'without', 'avoid', 'never', 'nobody', 'less']);
/** Negation-aware tokens: “without loud music” does not count as asking for loud. */
export function tokens(text: string): Set<string> {
  const base = text.toLowerCase().replace(/[’']/g, '').split(/[^a-z0-9-]+/).filter(Boolean);
  return new Set(base.flatMap((w, i) => w.length < 3 && !/\d/.test(w) || base.slice(Math.max(0, i - 2), i).some((n) => NEGATORS.has(n)) ? [] : w.split('-').flatMap((part) => [part, ...(SYNONYMS[part]?.split(' ') ?? [])])));
}
/** Recency-weighted query: the latest answer counts double, so answers steer the next step. */
type Query = Map<string, number>;
function query(...parts: [string, number][]): Query { const q: Query = new Map(); for (const [t, w] of parts) for (const k of tokens(t)) q.set(k, Math.max(q.get(k) ?? 0, w)); return q; }
const score = (q: Query, words: string) => [...tokens(words)].reduce((n, w) => n + (q.get(w) ?? 0), 0);

export function voiceFor(text: string): Voice {
  const t = text.toLowerCase();
  if (/blade runner|film|movie|cinema|like i.?m in/.test(t)) return 'cinematic';
  if (/haunt|eerie|spooky|myster|ghost|strange/.test(t)) return 'mysterious';
  if (/20\d0s|19\d0s|nostalg|remember|throwback|old days/.test(t)) return 'nostalgic';
  if (/fried|tired|exhausted|burn|coffee|sleepy/.test(t)) return 'deadpan';
  if (/fun|party|wild|chaos|chaotic|crazy|dance/.test(t)) return 'irreverent';
  if (/romantic|date|love|crush/.test(t)) return 'romantic';
  return 'reflective';
}
export function moodMatch(text: string): Mood | undefined {
  const t = [...tokens(text)].join(' ');
  return /\b(neon|cyberpunk|synth|rain|futuristic)\b/.test(t) ? 'neon_noir' : /\b(haunted|gothic|ghost|eerie|candlelit|creepy)\b/.test(t) ? 'candlelit_gothic' : /\b(party|dance|disco|nightlife|festive)\b/.test(t) ? 'electric_party'
    : /\b(cozy|warm|cafe|coffee)\b/.test(t) ? 'warm_amber' : /\b(romantic|dreamy|dreamlike)\b/.test(t) ? 'dreamy_pastel' : /\b(forest|nature|green|trees)\b/.test(t) ? 'deep_forest' : /\b(stars|starry|cosmic)\b/.test(t) ? 'starlit' : /\b(misty|foggy|fog|sea|water)\b/.test(t) ? 'misty_blue' : /\b(retro|vintage|film)\b/.test(t) ? 'retro_film' : undefined;
}
export const moodFor = (text: string): Mood => moodMatch(text) ?? 'sunlit';
const MOOD_TESTS: readonly [Mood, RegExp][] = [
  ['neon_noir', /\b(neon|cyberpunk|synth|rain|futuristic)\b/], ['candlelit_gothic', /\b(haunted|gothic|ghost|eerie|candlelit|creepy)\b/],
  ['electric_party', /\b(party|dance|disco|nightlife|festive)\b/], ['warm_amber', /\b(cozy|warm|cafe|coffee)\b/], ['dreamy_pastel', /\b(romantic|dreamy|dreamlike)\b/],
  ['deep_forest', /\b(forest|nature|green|trees)\b/], ['starlit', /\b(stars|starry|cosmic)\b/], ['misty_blue', /\b(misty|foggy|fog|sea|water|calm|quiet)\b/], ['retro_film', /\b(retro|vintage|film|nostalgic)\b/],
];
/** Session mood: the original input weighs most; later answers more than earlier ones. The newest answer
 * steers but cannot single-handedly flip a whole session (avoids collapsing every vibe into one preset). */
export function sessionMood(c: GenerationContext): Mood {
  const scores = new Map<Mood, number>();
  const add = (text: string, w: number) => { const t = [...tokens(text)].join(' '); for (const [m, re] of MOOD_TESTS) if (re.test(t)) scores.set(m, (scores.get(m) ?? 0) + w); };
  add(c.originalInput.text, 1.8);
  c.history.forEach((a, i) => add(answerText(a), 0.6 + 0.6 * (i + 1) / c.history.length));
  const best = [...scores].sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : 'sunlit';
}
const FAMILY: Record<MediaFormat, readonly string[]> = { image_choice: ['photograph', 'opening_scene'], listening: ['soundtrack', 'emotion'], image_blend: ['weather', 'cinematic_world'], image_reveal: ['doorway', 'unexpected'], free_text: ['original', 'objects'], text_choice: ['dealbreaker'] };
const TOPICS: Record<MediaFormat, readonly Topic[]> = { image_choice: ['setting', 'design', 'lighting'], listening: ['sound', 'pace', 'emotion'], image_blend: ['lighting', 'emotion', 'texture'], image_reveal: ['discovery', 'social', 'setting'], free_text: ['occasion', 'clarification', 'comfort'], text_choice: ['crowding', 'comfort'] };
const CALM = /\b(calm|quiet|slow|cozy|intimate|candlelit|serene|still|soft|reflective)\b/, LOUD = /\b(party|dance|crowd|electric|loud|chaotic|nightlife|festive)\b/;
const KNOWN = {
  setting: /\b(bar|cafe|outdoor|indoor|water|park|street|rooftop|room|bookshop|arcade|club|diner|nook|counter|museum|beach|garden|forest|city)\b/,
  sound: /\b(music|loud|quiet|song|band|dance|dancing|sing|singalong|talk|volume|playing)\b/,
  light: /\b(light|lights|neon|candle|candlelit|dim|bright|glow|golden|fog|foggy|lamp|lamps)\b/,
  involvement: /\b(join|watch|edge|middle|hands-on|play|game|explore|stops|involved|settle)\b/,
};
type Pick = { format: MediaFormat; score: number; why: string };
/** Choose the format that best resolves what is still unknown, not a fixed order. */
export function rankFormats(c: GenerationContext, voice: Voice, lean?: 'calm' | 'loud'): Pick[] {
  const said = [...tokens([c.originalInput.text, ...c.evidence.map((e) => e.text)].join(' '))].join(' ');
  const vague = /don.?t know|not sure|whatever|anything|no idea/i.test(c.originalInput.text) || tokens(c.originalInput.text).size <= 2;
  // A tension stays "open" only until a blend has explored it; afterwards other uncertainties take over.
  const blendAsked = c.history.some((a) => presentationOf(a.question)?.format === 'image_blend');
  const contradiction = !blendAsked && ((CALM.test(said) && LOUD.test(said)) || /\bbut\b/i.test(c.originalInput.text));
  const last = c.history.at(-1), lastFormat = last ? presentationOf(last.question)?.format : undefined;
  const neutralLast = last && ['skip', 'neither'].includes(last.response.kind);
  const uses = (f: MediaFormat) => c.history.filter((a) => presentationOf(a.question)?.format === f).length;
  const picks: Pick[] = [
    { format: 'image_choice', score: (KNOWN.setting.test(said) ? 0.5 : 2) + (vague ? 1 : 0), why: KNOWN.setting.test(said) ? 'Which kind of place, among the ones that fit so far.' : 'What kind of place this is: nothing about the setting is settled yet.' },
    { format: 'listening', score: last?.response.kind === 'unfamiliar' ? -10 : (KNOWN.sound.test(said) ? 0.5 : 2) + (['irreverent', 'hype', 'nostalgic'].includes(voice) ? 1 : 0) + (lean === 'loud' ? 1 : lean === 'calm' ? -1 : 0), why: KNOWN.sound.test(said) ? 'Whether the sound you described should lead the night or sit in the background.' : 'How much sound and energy belongs in the outing: nothing about it is settled yet.' },
    { format: 'image_blend', score: (contradiction ? 2.5 : 0) + (KNOWN.light.test(said) ? 0.3 : 1.5) + (['romantic', 'cinematic'].includes(voice) ? 0.5 : 0), why: contradiction ? 'Your answers pull in two directions; this checks whether to choose one or keep both.' : 'What the light and atmosphere should feel like.' },
    { format: 'image_reveal', score: (KNOWN.involvement.test(said) ? 0.3 : 1.5) + (['mysterious', 'cinematic'].includes(voice) ? 1 : 0), why: 'How involved you want to be once you get there.' },
    { format: 'free_text', score: c.history.length === 0 ? -10 : (vague ? 2.5 : 0) + (neutralLast ? 2 : 0) + (c.history.length >= 3 && c.qualifiers.length ? 1.5 : 0.5), why: neutralLast ? 'None of the last options fit, so your own words are the quickest way forward.' : vague ? 'You weren’t sure where to start; one concrete detail in your words narrows it fastest.' : 'A specific detail that pictures cannot capture.' },
  ];
  return picks.map((p) => ({ ...p, score: p.score - uses(p.format) * 1.5 - (p.format === lastFormat ? 5 : 0) + (hash(c.originalInput.text + p.format + c.history.length) % 100) / 500 })).sort((a, b) => b.score - a.score);
}
const PAIRS: Record<Mood, [Transform, Transform]> = { neon_noir: ['neon', 'blue_hour'], candlelit_gothic: ['candlelight', 'fog'], warm_amber: ['golden_hour', 'fog'], sunlit: ['golden_hour', 'storm'], electric_party: ['neon', 'golden_hour'], misty_blue: ['fog', 'golden_hour'], dreamy_pastel: ['dreamlike', 'noir'], deep_forest: ['fog', 'golden_hour'], retro_film: ['noir', 'golden_hour'], starlit: ['blue_hour', 'candlelight'] };
const LABEL: Record<Transform, string> = { golden_hour: 'Golden hour', blue_hour: 'Blue hour', neon: 'Neon', candlelight: 'Candlelight', fog: 'Fog', noir: 'Black-and-white', dreamlike: 'Dreamlike', storm: 'Storm coming' };
const FEEL: Record<Transform, string> = { golden_hour: 'warm, low golden light and an easy, nostalgic glow', blue_hour: 'cool blue dusk light, calm and a little cinematic', neon: 'saturated neon color, reflections and electric city energy', candlelight: 'dim candlelit warmth with deep shadows', fog: 'soft, foggy light where things feel mysterious and hushed', noir: 'high-contrast moody shadows, like an old film', dreamlike: 'soft pastel haze, gentle and a little unreal', storm: 'dramatic sky, wind and a sense that something is about to happen' };

function splitEvokes(image: ImageAsset): [string, string] {
  const [label, description] = image.evokes.includes('|') ? image.evokes.split('|') : [image.tags.slice(0, 2).map((t) => t[0].toUpperCase() + t.slice(1)).join(', '), `An outing that feels like this: ${image.subject}`];
  return [label.trim().slice(0, 60), description.trim().slice(0, 300)];
}
function pickImages(q: Query, used: Set<string>, count: number, seed: number, filter: (i: ImageAsset) => boolean = () => true): ImageAsset[] {
  const scored = IMAGES.filter((i) => !used.has(i.id) && filter(i))
    .map((i) => ({ i, s: score(q, `${i.tags.join(' ')} ${i.evokes}`) + ((hash(i.id + seed) % 100) / 1000) })).sort((a, b) => b.s - a.s);
  // Only fall back to unrelated images when too few relevant ones remain.
  const relevant = scored.filter((x) => x.s >= 1);
  const pool = relevant.length >= count ? relevant : scored;
  const picked: ImageAsset[] = [];
  // Diversify: each next image should differ in tags from those already picked.
  while (picked.length < count && pool.length) {
    pool.sort((a, b) => (b.s - overlap(b.i, picked)) - (a.s - overlap(a.i, picked)));
    picked.push(pool.shift()!.i);
  }
  return picked;
}
const overlap = (i: ImageAsset, picked: ImageAsset[]) => picked.reduce((n, p) => n + i.tags.filter((t) => p.tags.includes(t)).length * 0.6, 0);
const refsFor = (q: Query, used: Set<string>, n = 1) => REFERENCES.filter((r) => !used.has(r.id)).map((r) => ({ r, s: score(q, `${r.tags.join(' ')} ${r.evokes}`) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, n).map((x) => x.r);

const short = (s: string) => { const t = s.trim().replace(/\s+/g, ' '); return t.length <= 70 ? t : `${t.slice(0, 70).replace(/\s+\S*$/, '')}…`; };
const lastAnswerText = (c: GenerationContext) => { const a = c.history.at(-1); return a ? answerText(a) : ''; };
function answerText(a: GenerationContext['history'][number]): string {
  const r = a.response;
  if (r.kind === 'choice') { const o = a.question.options.find((x) => x.id === r.optionId); return o ? `${o.label} ${o.description}` : ''; }
  return r.kind === 'text' || r.kind === 'correction' ? r.text : '';
};
const lastAnswer = (c: GenerationContext) => {
  const a = c.history.at(-1); if (!a) return undefined;
  const r = a.response;
  return r.kind === 'choice' ? a.question.options.find((o) => o.id === r.optionId)?.label.replace(/[.!?…]+$/, '') : r.kind === 'text' || r.kind === 'correction' ? `“${short(r.text)}”` : undefined;
};

export function localMediaQuestion(c: GenerationContext): Question | null {
  if (c.history.length >= 10) return null;
  const guide = guidanceFor(c);
  if (!guide.topics.length) return null;
  const want = c.evidence.filter((e) => e.polarity === 'want').map((e) => e.text).join(' ');
  const latest = lastAnswerText(c);
  const q = query([c.originalInput.text, 1], [want, 1], [latest, 2]);
  const voice = voiceFor(c.originalInput.text);
  const mood = sessionMood(c);
  const lean = CALM.test([...tokens(latest)].join(' ')) ? 'calm' : LOUD.test([...tokens(latest)].join(' ')) ? 'loud' : undefined;
  const used = usedMedia(c.history); const seed = hash(c.originalInput.text + c.history.length);
  const unfamiliar = c.history.at(-1)?.response.kind === 'unfamiliar';
  const ranked = rankFormats(c, voice, lean);
  const order = ranked.map((r) => r.format).filter((f) => !(unfamiliar && f === 'listening') && !(c.history.length === 0 && f === 'free_text'));
  const lastFamily = c.history.at(-1)?.question.family;
  const prior = lastAnswer(c);
  const known = c.history.length ? `You started from “${short(c.originalInput.text)}”${prior ? ` and most recently chose ${prior}` : ''}.` : `Only the starting words: “${short(c.originalInput.text)}”.`;
  for (const format of order) {
    const topic = TOPICS[format].find((t) => guide.topics.includes(t)) ?? guide.topics[0];
    const family = FAMILY[format].find((f) => f !== lastFamily) ?? 'original';
    const built = build(format, { c, q, used, seed, voice, mood, known, prior });
    if (!built) continue;
    built.design = { ...built.design, uncertainty: ranked.find((r) => r.format === format)!.why };
    const question: Question = { id: `local-${format}-${c.history.length + 1}-${seed % 9973}`, family, topic, prompt: built.prompt, cultural: built.cultural, options: built.options, presentation: { schema: 'vibenta-media/1', source: 'local', format, voice, mood, ...built.presentation, design: { known, ...built.design } } as QuestionPresentation };
    if (!presentationSessionError(question, c.history)) return question;
  }
  return null;
}

interface Ctx { c: GenerationContext; q: Query; used: ReturnType<typeof usedMedia>; seed: number; voice: Voice; mood: Mood; known: string; prior?: string }
type Built = { prompt: string; cultural: boolean; options: Choice[]; presentation: Partial<QuestionPresentation>; design: Omit<QuestionPresentation['design'], 'known'> };
const branch = (options: Choice[], f: (o: Choice) => string) => options.map((o) => ({ optionId: o.id, leadsTo: f(o) }));

function build(format: MediaFormat, x: Ctx): Built | null {
  const { q, used, seed, voice, mood, prior } = x;
  const after = prior ? `You picked ${prior}. ` : '';
  if (format === 'image_choice') {
    const count = x.c.history.length % 2 ? 2 : 3;
    const images = pickImages(q, used.images, count, seed);
    if (images.length < 2) return null;
    const options = images.map((i, n) => { const [label, description] = splitEvokes(i); return { id: `place-${n + 1}`, label, description, preference: 'want' as const }; });
    const prompt = voice === 'irreverent' ? `${after}Three doors, one night. Which photo is the one where you'd text the group chat “get here now”?`
      : voice === 'deadpan' ? `${after}Your brain has one remaining tab open. Which of these is it allowed to sit inside?`
      : voice === 'mysterious' ? `${after}Somewhere in these, the night is already waiting. Which one do you walk into?`
      : voice === 'nostalgic' ? `${after}Which of these looks like a night you'd still be talking about years later?`
      : voice === 'cinematic' ? `${after}Opening shot. Which of these frames does the camera find you in?`
      : voice === 'romantic' ? `${after}Where would the good part of the night happen?` : `${after}Which of these places would you actually want to be in tonight?`;
    return { prompt: images.length === 2 ? prompt.replace('Three doors', 'Two doors') : prompt, cultural: false, options, presentation: { optionImages: options.map((o, n) => ({ optionId: o.id, imageId: images[n].id })) },
      design: { uncertainty: 'Which physical setting and atmosphere the outing should have.', whyThisMedium: 'Real photographs let you react to light, space and texture before naming them.', branches: branch(options, (o) => `Next questions build on “${o.label}” as the setting.`) } };
  }
  if (format === 'listening') {
    const track = TRACKS.filter((t) => !used.tracks.has(t.id)).map((t) => ({ t, s: score(q, `${t.mood} ${t.sound} ${t.song}`) + (hash(t.id + seed) % 100) / 1000 })).sort((a, b) => b.s - a.s)[0]?.t;
    if (!track) return null;
    const options: Choice[] = [
      { id: 'all-in', label: voice === 'irreverent' ? 'Turn it up and let it ruin my plans' : 'Let it take over the night', description: 'A night with this kind of energy all around: music you can feel, movement and people letting go.', preference: 'want' },
      { id: 'in-background', label: 'Keep it playing low in the background', description: 'Somewhere this kind of music plays at a level that still leaves room to talk and notice each other.', preference: 'want' },
      { id: 'counterweight', label: 'The feeling, but not the volume', description: 'Keep the mood this recording gives me, in a calmer place without loud music.', preference: 'want' },
    ];
    return { prompt: `${after}Press play if you can: “${track.song}” by ${track.artist}. If tonight had this playing somewhere, what would you want it to do?`, cultural: true, options,
      presentation: { trackId: track.id, referenceNote: `Can't play it? It sounds like this: ${track.sound}` },
      design: { uncertainty: 'How much sound and energy should be part of the outing.', whyThisMedium: 'A recognizable recording conveys energy and atmosphere faster than adjectives; the sound description keeps it answerable without audio.', branches: branch(options, (o) => o.id === 'all-in' ? 'Leans toward livelier, music-forward places.' : o.id === 'in-background' ? 'Keeps music present but conversation possible.' : 'Keeps the mood but steers toward calmer places.') } };
  }
  if (format === 'image_blend') {
    const [from, to] = PAIRS[mood];
    const image = pickImages(q, used.images, 1, seed, (i) => i.rights.adaptation)[0];
    if (!image) return null;
    const options: Choice[] = [
      { id: 'from', label: LABEL[from], description: `I want the outing to have ${FEEL[from]}.`, preference: 'want' },
      { id: 'to', label: LABEL[to], description: `I want the outing to have ${FEEL[to]}.`, preference: 'want' },
      { id: 'both', label: `${LABEL[from]} and ${LABEL[to].toLowerCase()} at once`, description: `I want both at the same time: ${FEEL[from]}, with ${FEEL[to]}.`, preference: 'want' },
    ];
    return { prompt: `${after}Same place, two kinds of light. Drag between them and stop where tonight feels right.`, cultural: false, options,
      presentation: { stageImageId: image.id, blend: { from, to, fromLabel: LABEL[from], toLabel: LABEL[to] } },
      design: { uncertainty: `Whether the atmosphere leans ${LABEL[from].toLowerCase()} or ${LABEL[to].toLowerCase()}, or holds both.`, whyThisMedium: 'Changing only the light on one photo isolates a single dimension, and the middle allows contradictory moods.', branches: branch(options, (o) => o.id === 'both' ? 'Keeps the tension instead of choosing a side.' : `Leans the outing toward ${o.label.toLowerCase()}.`) } };
  }
  if (format === 'image_reveal') {
    const image = pickImages(q, used.images, 1, seed)[0];
    if (!image) return null;
    const ref = refsFor(q, used.refs)[0];
    const options: Choice[] = [
      { id: 'in', label: 'Walk straight into the middle of it', description: 'An outing where I get involved right away: join in, try things and be part of what is happening.', preference: 'want' },
      { id: 'edge', label: 'Find a spot at the edge and watch', description: 'An outing where I can settle in, watch the scene and join only when I want to.', preference: 'want' },
      { id: 'beyond', label: 'Look for what is past it', description: 'An outing that keeps moving: a couple of stops and something unexpected around the corner.', preference: 'want' },
    ];
    return { prompt: `${after}Look closer. Widen the picture as much as you like. Once you're there, what do you do?`, cultural: !!ref, options,
      presentation: { stageImageId: image.id, ...(ref ? { referenceIds: [ref.id], referenceNote: `Like ${ref.title} (${ref.year}): ${ref.evokes}. If you don't know it, ignore it.` } : {}) },
      design: { uncertainty: 'How involved you want to be once the outing starts.', whyThisMedium: 'Revealing a scene gradually lets you notice what draws you in before choosing how to act in it.', branches: branch(options, (o) => o.id === 'in' ? 'Steers toward hands-on, participatory places.' : o.id === 'edge' ? 'Steers toward places you can settle in and observe.' : 'Steers toward a multi-stop outing.') } };
  }
  if (format === 'free_text') {
    const options: Choice[] = [
      { id: 'small-thing', label: 'A small, specific treat', description: 'One specific thing to eat, drink or see that makes the outing feel worth it.', preference: 'want' },
      { id: 'right-people', label: 'The right company', description: 'The people (or lack of them) matter more than the place.', preference: 'want' },
    ];
    return { prompt: `${after}In your own words: what's one detail that would make tonight feel exactly right? Be as specific or as strange as you like.`, cultural: false, options,
      presentation: { placeholder: 'e.g. a window seat when it starts raining', referenceIds: [] }, design: { uncertainty: 'A specific detail that pictures cannot capture.', whyThisMedium: 'Some things only you can name; your words go straight into the matching.', branches: branch(options, (o) => `Uses “${o.label}” as the anchor for the next step.`) } };
  }
  return null;
}

export const isLocalPresentation = (q: Question) => presentationOf(q)?.source === 'local';
