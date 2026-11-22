import { h } from '../../../discovery/ui/dom';
import type { Question, Response } from '../profile';
import { presentationOf } from '../media/presentation';
import { MAX_TYPED_TEXT } from '../photoMessage';
import { IMAGE_BY_ID, imageCredit, REFERENCE_BY_ID, TRACK_BY_ID, trackEmbedUrl, trackWatchUrl } from '../media/registry';
import type { ImageAsset, Transform } from '../media/types';

/** Disposable, per-question view state. Looking, widening, sliding and playing are never evidence. */
export interface MediaViewState { reveal: number; blend: number; playerLoaded: boolean; failed: Set<string>; draft: string }
export const emptyMediaView = (): MediaViewState => ({ reveal: 0, blend: 50, playerLoaded: false, failed: new Set(), draft: '' });

export const FILTERS: Record<Transform, string> = {
  golden_hour: 'sepia(.45) saturate(1.5) hue-rotate(-12deg) brightness(1.06) contrast(1.05)',
  blue_hour: 'saturate(1.2) hue-rotate(185deg) brightness(.78) contrast(1.1)',
  neon: 'saturate(2.3) contrast(1.25) hue-rotate(290deg) brightness(.92)',
  candlelight: 'sepia(.7) saturate(1.6) brightness(.68) contrast(1.25)',
  fog: 'blur(1.6px) brightness(1.12) contrast(.68) saturate(.55)',
  noir: 'grayscale(1) contrast(1.45) brightness(.88)',
  dreamlike: 'blur(.8px) saturate(.8) brightness(1.12) hue-rotate(-25deg) contrast(.85)',
  storm: 'saturate(.6) contrast(1.35) brightness(.72) hue-rotate(-10deg)',
};
const REVEAL = [2.6, 1.7, 1] as const;

function picture(image: ImageAsset, state: MediaViewState, rerender: () => void, attrs: Record<string, string> = {}) {
  if (state.failed.has(image.id)) return h('p', { class: 'vb-media-fallback', role: 'img', 'aria-label': image.alt }, `Image unavailable. It shows ${image.subject}.`);
  const img = h('img', { src: image.src, alt: image.alt, width: String(image.width), height: String(image.height), loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', 'data-asset-id': image.id, ...attrs });
  img.addEventListener('error', () => { state.failed.add(image.id); rerender(); }, { once: true });
  return img;
}
function credit(image: ImageAsset, note = '') {
  const label = `${imageCredit(image)}${note}`;
  return image.rights.source === 'team_original' ? h('p', { class: 'vb-media-credit' }, label)
    : h('p', { class: 'vb-media-credit' }, h('a', { href: image.rights.sourceUrl, target: '_blank', rel: 'noopener noreferrer' }, label));
}
const kindLabel = (image: ImageAsset) => image.kind === 'photo' ? 'Real photograph, not a Boston venue' : image.kind === 'public_domain_film_still' ? 'Public-domain film still' : image.kind === 'space_photo' ? 'NASA photograph' : 'Original illustration, not a real venue';

function optionCards(question: Question, commit: (r: Response) => void, previous?: Response) {
  const cards = h('div', { class: 'vb-quiz-answers' });
  for (const option of question.options) {
    const b = h('button', { type: 'button', class: 'vb-quiz-answer', 'data-option': option.id, 'aria-pressed': String(previous?.kind === 'choice' && previous.optionId === option.id) }, h('strong', {}, option.label), h('span', {}, option.description));
    b.addEventListener('click', () => commit({ kind: 'choice', optionId: option.id }));
    cards.append(b);
  }
  return cards;
}

/**
 * Optional photo for a free_text answer. The caller owns the attachment and the send, because a
 * photo is read (described) before the answer is committed and a failed read keeps the draft.
 */
export interface FreeTextPhoto { attachment: HTMLElement; busy: boolean; reading: boolean; hasPhoto: () => boolean; send: (text: string) => void }

/** Renders a vibenta-media/1 question. Returns null when the question has no presentation. */
export function renderMediaStage(question: Question, state: MediaViewState, commit: (r: Response) => void, previous?: Response, photo?: FreeTextPhoto): HTMLElement | null {
  const p = presentationOf(question);
  if (!p) return null;
  const root = h('section', { class: 'vb-media-stage', 'data-format': p.format, 'data-voice': p.voice, 'aria-label': 'Question media' });
  const draw = () => {
    root.replaceChildren();
    const refs = (p.referenceIds ?? []).map((id) => REFERENCE_BY_ID.get(id)).filter((r) => !!r);
    if (p.format === 'image_choice') {
      const grid = h('div', { class: `vb-media-grid vb-media-grid-${p.optionImages!.length}` });
      for (const row of p.optionImages!) {
        const option = question.options.find((o) => o.id === row.optionId)!; const image = IMAGE_BY_ID.get(row.imageId)!;
        const pressed = previous?.kind === 'choice' && previous.optionId === option.id;
        const card = h('button', { type: 'button', class: 'vb-media-card', 'data-option': option.id, 'aria-pressed': String(pressed) }, picture(image, state, draw), h('strong', {}, option.label), h('span', {}, option.description));
        card.addEventListener('click', () => commit({ kind: 'choice', optionId: option.id }));
        grid.append(h('figure', { class: 'vb-media-figure' }, card, credit(image)));
      }
      root.append(h('p', { class: 'vb-media-kind' }, [...new Set(p.optionImages!.map((r) => kindLabel(IMAGE_BY_ID.get(r.imageId)!)))].join(' · ')), grid);
    } else if (p.format === 'image_reveal') {
      const image = IMAGE_BY_ID.get(p.stageImageId!)!; const step = Math.min(state.reveal, REVEAL.length - 1);
      const frame = h('div', { class: 'vb-media-reveal', 'data-reveal-step': String(step) }, picture(image, state, draw, { style: `transform:scale(${REVEAL[step]})` }));
      const wider = h('button', { type: 'button', class: 'vb-scene-control', 'data-reveal': 'wider' }, step === REVEAL.length - 1 ? 'Whole scene visible' : 'Look wider');
      wider.toggleAttribute('disabled', step === REVEAL.length - 1);
      wider.addEventListener('click', () => { state.reveal = step + 1; draw(); root.querySelector<HTMLElement>('[data-reveal="wider"]')?.focus(); });
      const closer = h('button', { type: 'button', class: 'vb-scene-control', 'data-reveal': 'closer' }, 'Look closer');
      closer.toggleAttribute('disabled', step === 0);
      closer.addEventListener('click', () => { state.reveal = step - 1; draw(); root.querySelector<HTMLElement>('[data-reveal="closer"]')?.focus(); });
      root.append(h('p', { class: 'vb-media-kind' }, kindLabel(image)), frame, h('p', { class: 'vb-media-step', 'aria-live': 'polite' }, `View ${step + 1} of ${REVEAL.length}${step === REVEAL.length - 1 ? `: ${image.subject}` : ''}`), h('div', { class: 'vb-media-controls' }, closer, wider), credit(image), optionCards(question, commit, previous));
    } else if (p.format === 'image_blend') {
      const image = IMAGE_BY_ID.get(p.stageImageId!)!; const b = p.blend!;
      const base = picture(image, state, draw, { style: `filter:${FILTERS[b.from]}`, 'data-layer': 'from' });
      const top = picture(image, state, draw, { style: `filter:${FILTERS[b.to]};opacity:${state.blend / 100}`, 'data-layer': 'to', alt: '' });
      const slider = h('input', { type: 'range', min: '0', max: '100', step: '1', value: String(state.blend), class: 'vb-media-slider', 'aria-label': `Blend from ${b.fromLabel} to ${b.toLabel}`, 'aria-valuetext': `${100 - state.blend}% ${b.fromLabel}, ${state.blend}% ${b.toLabel}` }) as HTMLInputElement;
      slider.addEventListener('input', () => { state.blend = Number(slider.value); const layer = root.querySelector<HTMLElement>('[data-layer="to"]'); if (layer) layer.style.opacity = String(state.blend / 100); slider.setAttribute('aria-valuetext', `${100 - state.blend}% ${b.fromLabel}, ${state.blend}% ${b.toLabel}`); });
      root.append(h('p', { class: 'vb-media-kind' }, `${kindLabel(image)} · light filters applied by Vibenta`), h('div', { class: 'vb-media-blend' }, base, top), h('div', { class: 'vb-media-slider-row' }, h('span', {}, b.fromLabel), slider, h('span', {}, b.toLabel)), credit(image, ' · filtered'), optionCards(question, commit, previous));
    } else if (p.format === 'listening') {
      const track = TRACK_BY_ID.get(p.trackId!)!;
      const player = state.playerLoaded
        ? h('iframe', { class: 'vb-media-player', src: trackEmbedUrl(track), title: `YouTube player: ${track.song} by ${track.artist}`, allow: 'encrypted-media; picture-in-picture', allowfullscreen: 'true', referrerpolicy: 'strict-origin-when-cross-origin', 'data-video-id': track.videoId })
        : h('button', { type: 'button', class: 'vb-media-load-player', 'data-load-player': track.id }, h('strong', {}, `▶ Load “${track.song}”`), h('span', {}, `${track.artist} · ${track.year} · YouTube player (contacts YouTube)`));
      if (!state.playerLoaded) player.addEventListener('click', () => { state.playerLoaded = true; draw(); });
      root.append(h('div', { class: 'vb-media-listen' }, player,
        h('p', { class: 'vb-media-credit' }, 'Official upload by ', h('a', { href: track.channelUrl, target: '_blank', rel: 'noopener noreferrer' }, track.channel), ' · ', h('a', { href: trackWatchUrl(track), target: '_blank', rel: 'noopener noreferrer' }, 'Open on YouTube'), ' · Playing is optional; only your answer counts.'),
        h('details', { class: 'vb-media-soundoff' }, h('summary', {}, 'Sound off or don’t know it?'), h('p', {}, track.sound))), optionCards(question, commit, previous));
    } else if (p.format === 'free_text') {
      const area = h('textarea', { class: 'vb-textarea vb-media-freetext', rows: '3', maxlength: String(MAX_TYPED_TEXT), placeholder: p.placeholder ?? 'Type your answer…', 'aria-label': 'Your answer in your own words' }) as HTMLTextAreaElement;
      area.value = state.draft || (previous?.kind === 'text' ? previous.text : '');
      // While a photo is read the words are read-only, so what is sent is what is shown.
      area.readOnly = !!photo?.busy;
      area.addEventListener('input', () => { state.draft = area.value; });
      const send = h('button', { type: 'button', class: 'vb-primary-btn vb-media-send' }, photo?.reading ? 'Reading your photo…' : 'Send my answer');
      if (photo?.busy) send.setAttribute('aria-disabled', 'true');
      send.addEventListener('click', () => {
        if (photo) { if (area.value.trim() || photo.hasPhoto()) photo.send(area.value); else area.focus(); return; }
        const text = area.value.trim(); if (text) commit({ kind: 'text', text }); else area.focus();
      });
      root.append(area, ...(photo ? [photo.attachment] : []), send, h('p', { class: 'vb-media-kind' }, 'Or pick one of these:'), optionCards(question, commit, previous));
    } else root.append(optionCards(question, commit, previous));
    if (p.referenceNote || refs.length) root.append(h('aside', { class: 'vb-media-reference' }, ...(p.referenceNote ? [h('p', {}, p.referenceNote)] : []), ...refs.map((r) => h('p', { class: 'vb-media-ref' }, h('a', { href: r!.source, target: '_blank', rel: 'noopener noreferrer' }, `${r!.title} (${r!.year})`), ` · ${r!.creator}`))));
    root.append(h('details', { class: 'vb-media-why' }, h('summary', {}, 'Why this question?'),
      h('p', {}, h('strong', {}, 'So far: '), p.design.known), h('p', {}, h('strong', {}, 'Still open: '), p.design.uncertainty), h('p', {}, h('strong', {}, 'Why this format: '), p.design.whyThisMedium),
      h('p', { class: 'vb-media-source' }, p.source === 'gemini' ? 'Written by Gemini from your answers.' : 'Local question: the AI is unavailable, so this was assembled from the verified media library without Gemini.')));
  };
  draw();
  return root;
}
