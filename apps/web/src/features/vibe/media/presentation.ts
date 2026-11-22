import type { Answer, GenerationContext, Question } from '../profile.ts';
import { IMAGE_BY_ID, IMAGES, REFERENCE_BY_ID, TRACK_BY_ID, TRACKS } from './registry.ts';
import { REFERENCES } from './references.ts';
import { FORMATS, MOODS, TRANSFORMS, VOICES, type MediaFormat, type QuestionPresentation } from './types.ts';

const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number, min = 1): v is string => typeof v === 'string' && v.trim().length >= min && v.length <= max;
export const MEDIA_FORMATS: readonly MediaFormat[] = ['image_choice', 'image_reveal', 'image_blend', 'listening'];

export function presentationOf(q: Question): QuestionPresentation | undefined {
  return (q as Question & { presentation?: QuestionPresentation }).presentation;
}

/** Structural + registry checks for one question. Applies to history replays too. */
export function presentationShapeError(q: Question): string | undefined {
  const p = (q as unknown as { presentation?: unknown }).presentation;
  if (p === undefined) return;
  if (!obj(p) || p.schema !== 'vibenta-media/1') return 'Presentation schema must be vibenta-media/1';
  if (!FORMATS.includes(p.format as MediaFormat)) return 'Unknown presentation format';
  if (!VOICES.includes(p.voice as never) || !MOODS.includes(p.mood as never)) return 'Unknown voice or mood';
  if (p.source !== 'gemini' && p.source !== 'local') return 'Unknown presentation source';
  const d = p.design;
  if (!obj(d) || !text(d.known, 400, 8) || !text(d.uncertainty, 400, 8) || !text(d.whyThisMedium, 400, 8) || !Array.isArray(d.branches)) return 'Each question needs known/uncertainty/whyThisMedium/branches';
  const ids = q.options.map((o) => o.id);
  if (d.branches.length !== ids.length || !d.branches.every((b) => obj(b) && ids.includes(String(b.optionId)) && text(b.leadsTo, 300, 6)) || new Set(d.branches.map((b) => (b as { optionId: string }).optionId)).size !== ids.length) return 'Every option needs exactly one branch explaining what it changes next';
  const refs = p.referenceIds;
  if (refs !== undefined && (!Array.isArray(refs) || refs.length > 4 || !refs.every((r) => REFERENCE_BY_ID.has(String(r))))) return 'Unknown cultural reference ID';
  if (p.referenceNote !== undefined && !text(p.referenceNote, 240)) return 'Reference note too long';
  if ((refs?.length || p.format === 'listening') && !q.cultural) return 'Questions using cultural references or recognizable music must set cultural=true';
  switch (p.format as MediaFormat) {
    case 'image_choice': {
      const rows = p.optionImages;
      if (!Array.isArray(rows) || rows.length !== ids.length) return 'image_choice needs one image per option';
      if (!rows.every((r) => obj(r) && ids.includes(String(r.optionId)) && IMAGE_BY_ID.has(String(r.imageId)))) return 'Unknown image ID or option in optionImages';
      if (new Set(rows.map((r) => (r as { imageId: string }).imageId)).size !== rows.length || new Set(rows.map((r) => (r as { optionId: string }).optionId)).size !== rows.length) return 'image_choice images and options must be distinct';
      return;
    }
    case 'image_reveal':
      return IMAGE_BY_ID.has(String(p.stageImageId)) ? undefined : 'image_reveal needs a registry stageImageId';
    case 'image_blend': {
      const image = IMAGE_BY_ID.get(String(p.stageImageId));
      if (!image) return 'image_blend needs a registry stageImageId';
      if (!image.rights.adaptation) return 'That image license is not used for transformations; pick an image with blend:yes';
      const b = p.blend;
      if (!obj(b) || !TRANSFORMS.includes(b.from as never) || !TRANSFORMS.includes(b.to as never) || b.from === b.to || !text(b.fromLabel, 60, 2) || !text(b.toLabel, 60, 2)) return 'image_blend needs two distinct transforms with labels';
      return;
    }
    case 'listening':
      return TRACK_BY_ID.has(String(p.trackId)) ? undefined : 'listening needs a registry trackId';
    case 'free_text':
      return p.placeholder === undefined || text(p.placeholder, 120, 3) ? undefined : 'Placeholder must be 3–120 characters';
    case 'text_choice':
      return;
  }
}

/** Media already shown in this session, so a question never recycles it. */
export function usedMedia(history: readonly Pick<Answer, 'question'>[]) {
  const images = new Set<string>(), tracks = new Set<string>(), refs = new Set<string>();
  for (const a of history) {
    const p = presentationOf(a.question);
    if (!p) continue;
    p.optionImages?.forEach((r) => images.add(r.imageId));
    if (p.stageImageId) images.add(p.stageImageId);
    if (p.trackId) tracks.add(p.trackId);
    p.referenceIds?.forEach((r) => refs.add(r));
  }
  return { images, tracks, refs };
}

/** Session-level variety rules for the next question. */
export function presentationSessionError(q: Question, history: readonly Answer[], requirePresentation = false): string | undefined {
  const p = presentationOf(q);
  if (!p) return requirePresentation ? 'Every question needs a presentation object (format, voice, mood, design)' : undefined;
  if (history.length === 0 && !MEDIA_FORMATS.includes(p.format)) return 'The opening question must use real media (image_choice, image_reveal, image_blend or listening)';
  const used = usedMedia(history);
  if (p.optionImages?.some((r) => used.images.has(r.imageId)) || (p.stageImageId && used.images.has(p.stageImageId))) return 'An image was already shown this session; choose unused images';
  if (p.trackId && used.tracks.has(p.trackId)) return 'That track was already played this session';
  const last = history.at(-1);
  const lastFormat = last ? presentationOf(last.question)?.format : undefined;
  if (lastFormat && lastFormat === p.format) return `Do not repeat the ${p.format} format twice in a row`;
  const formats = history.map((a) => presentationOf(a.question)?.format);
  if (p.format === 'free_text' && formats.filter((f) => f === 'free_text').length >= 2) return 'At most two free-text questions per session';
  if (p.format === 'listening' && last?.response.kind === 'unfamiliar') return 'After unfamiliarity, do not lead with another recognizable recording';
  return;
}

/** Compact library for Gemini: IDs and plain descriptions only. No URLs. */
export function libraryForPrompt(c: Pick<GenerationContext, 'history'> & Partial<Pick<GenerationContext, 'sessionId'>>) {
  const used = usedMedia(c.history);
  // Per-session order: list position biases the model toward the same few items in every session.
  const seed = c.sessionId ?? '';
  const order = <T extends { id: string }>(xs: readonly T[]) => [...xs].sort((a, b) => fnv(seed + a.id) - fnv(seed + b.id));
  const IMAGES_ = order(IMAGES), TRACKS_ = order(TRACKS), REFERENCES_ = order(REFERENCES);
  return {
    images: IMAGES_.filter((i) => !used.images.has(i.id)).map((i) => `${i.id} | ${i.kind}${i.film ? ` (${i.film})` : ''} | ${i.subject} | ${i.tags.join(', ')} | blend:${i.rights.adaptation ? 'yes' : 'no'}`),
    tracks: TRACKS_.filter((t) => !used.tracks.has(t.id)).map((t) => `${t.id} | "${t.song}" by ${t.artist} (${t.year}) | ${t.sound}`),
    references: REFERENCES_.map((r) => `${r.id} | ${r.kind} | ${r.title} (${r.creator}, ${r.year}) | ${r.evokes}${r.assetIds?.length ? ` | playable: ${r.assetIds.join(',')}` : ''}${used.refs.has(r.id) ? ' | ALREADY USED' : ''}`),
    transforms: TRANSFORMS,
  };
}

const fnv = (text: string) => { let n = 2166136261; for (const ch of text) n = Math.imul(n ^ ch.charCodeAt(0), 16777619); return n >>> 0; };
