/**
 * Dedicated "what should it feel like?" screen.
 * Text and the browser-local photo live in the same observable preferences
 * store as the practical filters. Nothing is uploaded here: the photo is read
 * only when the user presses "Refine this vibe" (see panel.ts).
 */
import {
  VIBE_TEXT_MAX_LENGTH,
  type InitialPreferences,
  type PreferencesAction,
} from '../preferences';
import type { Store } from '../store';
import { h, uid } from './dom';
import { photoAccess } from '../../features/vibe/photoAccess';
import { photoClient } from '../../features/vibe/photoClient';
import { createPhotoAttachment, type PhotoAttachmentState } from '../../features/vibe/ui/photoAttachment';

const EXAMPLES = [
  {
    title: 'Cozy & nostalgic',
    text: 'Like a rainy bookstore scene in a quiet movie: warm lamplight, old books, soft jazz, and somewhere to talk without rushing.',
  },
  {
    title: 'Loud & electric',
    text: 'The energy of an upbeat dance song: neon lights, crowded streets, loud music, and a spontaneous night out with friends.',
  },
  {
    title: 'Dreamy & romantic',
    text: 'Vintage cameras, narrow streets, golden streetlights, and candlelit tables. Quiet, a little nostalgic, and cinematic.',
  },
  {
    title: 'Calm & outdoorsy',
    text: 'Open sky, trees, sunlight, and water nearby. Fresh air, space to wander, and a peaceful atmosphere without crowds.',
  },
  {
    title: 'Sleek & modern',
    text: 'Clean lines, big windows, minimalist interiors, and mellow electronic music. Polished and stylish, but not formal or stuffy.',
  },
  {
    title: 'Playful & eclectic',
    text: 'Colorful murals, unusual decor, arcade games, and unexpected little details. Creative, welcoming, and a bit chaotic.',
  },
  {
    title: 'Moody & underground',
    text: 'Dim lighting, exposed brick, indie music, and a late-night crowd. Raw and mysterious rather than polished or touristy.',
  },
] as const;

export interface VibeStep {
  root: HTMLElement;
  focus(): void;
  render(state: InitialPreferences): void;
  /** Update the photo's description, status or busy flag (the file comes from preferences). */
  setPhoto(patch: Partial<Omit<PhotoAttachmentState, 'file'>>): void;
  destroy(): void;
}

export function createVibeStep(prefs: Store<InitialPreferences, PreferencesAction>): VibeStep {
  const inputId = uid('vibe-story');
  const helpId = uid('vibe-help');
  const counterId = uid('vibe-counter');

  const story = h('textarea', {
    id: inputId,
    class: 'vb-textarea vb-vibe-story',
    rows: 6,
    maxlength: VIBE_TEXT_MAX_LENGTH,
    placeholder: 'Describe what makes the atmosphere feel right — the energy, lighting, sounds, or setting. Mention anything you want to avoid, too.\n\nExample: Bright and bustling, with upbeat music and a casual crowd. Fun, not fancy.',
    'aria-describedby': `${helpId} ${counterId}`,
  });
  story.addEventListener('input', () => prefs.dispatch({ type: 'setVibeText', text: story.value }));

  const counter = h('span', { id: counterId, class: 'vb-counter' }, `0/${VIBE_TEXT_MAX_LENGTH}`);
  const exampleButtons = EXAMPLES.map((example) => {
    const button = h(
      'button',
      { class: 'vb-vibe-example', type: 'button', title: `Use example: ${example.title}` },
      h('span', { class: 'vb-example-title' }, example.title),
    );
    button.addEventListener('click', () => {
      prefs.dispatch({ type: 'setVibeText', text: example.text });
      story.focus();
      story.setSelectionRange(story.value.length, story.value.length);
    });
    return button;
  });

  // The photo draft: the file lives in the preferences store; its description,
  // status and busy flag are screen state set by the attachment and the panel.
  const photo: PhotoAttachmentState = { file: null, description: null, status: null, busy: false };
  let pickedHere = false;
  const mountAttachment = () => createPhotoAttachment({
    state: photo,
    access: photoAccess,
    signInLabel: 'Sign in to add a reference photo',
    dropZone: true,
    onFile: (file) => {
      pickedHere = true;
      prefs.dispatch({ type: 'setVibeImages', files: file ? [file] : [] });
      pickedHere = false;
    },
  });
  let attachment = mountAttachment();
  function remountAttachment() {
    const hadFocus = attachment.root.contains(document.activeElement);
    const next = mountAttachment();
    attachment.root.replaceWith(next.root);
    attachment.destroy();
    attachment = next;
    if (hadFocus) next.root.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
  }

  const quotaLine = h('p', { class: 'vb-photo-quota', hidden: true });
  let quotaRequest = 0;
  let destroyed = false;
  async function refreshQuota() {
    const request = ++quotaRequest;
    if (photoAccess.status() !== 'signed_in') {
      quotaLine.hidden = true;
      return;
    }
    const quota = await photoClient.quota();
    if (destroyed || request !== quotaRequest) return;
    const left = quota?.remainingToday ?? null;
    quotaLine.hidden = left === null;
    quotaLine.textContent = left === null || !quota
      ? ''
      : left > 0 ? `${left} of ${quota.limit} photo reads left today` : 'No photo reads left today. Photos can be read again tomorrow.';
  }
  let accessStatus = photoAccess.status();
  const unsubscribeAccess = photoAccess.subscribe(() => {
    if (photoAccess.status() === accessStatus) return;
    accessStatus = photoAccess.status();
    void refreshQuota();
  });
  void refreshQuota();

  function renderPhoto(file: File | null) {
    if (file === photo.file) return;
    photo.file = file;
    photo.description = file ? photoClient.cached(file) ?? null : null;
    // The attachment sets its own status when the user picks or removes; a change
    // from elsewhere (Clear all) drops any stale message.
    if (!pickedHere) photo.status = null;
    remountAttachment();
  }

  const root = h(
    'div',
    { class: 'vb-vibe-screen' },
    h('div', { class: 'vb-vibe-intro' },
      h('p', { class: 'vb-vibe-lead' },
        'Use a feeling, a song, a movie scene, or anything that captures the atmosphere.'),
    ),
    h('div', { class: 'vb-field' },
      h('label', { class: 'vb-label vb-vibe-label', for: inputId }, 'Your vibe ', h('span', { class: 'vb-optional' }, '(in your own words)')),
      story,
      h('div', { class: 'vb-field-foot' },
        h('span', { class: 'vb-hint-inline', id: helpId },
          'Specific details help, but even one reference is enough to start.'),
        counter,
      ),
    ),
    h('div', { class: 'vb-vibe-examples' },
      h('div', { class: 'vb-vibe-section-head' },
        h('span', { class: 'vb-vibe-section-help' }, 'Or start with an example:'),
      ),
      h('div', { class: 'vb-example-grid' }, ...exampleButtons),
    ),
    h('section', { class: 'vb-vibe-upload-section', 'aria-label': 'Photo inspiration' },
      attachment.root,
      quotaLine,
    ),
  );

  return {
    root,
    focus: () => story.focus(),
    render(state) {
      if (story.value !== state.vibeText) story.value = state.vibeText;
      counter.textContent = `${state.vibeText.length}/${VIBE_TEXT_MAX_LENGTH}`;
      renderPhoto(state.vibeImages[0] ?? null);
    },
    setPhoto(patch) {
      Object.assign(photo, patch);
      remountAttachment();
      // A finished read (success or failure) changes today's remaining reads.
      if (patch.busy === false) void refreshQuota();
    },
    destroy() {
      destroyed = true;
      unsubscribeAccess();
      attachment.destroy();
    },
  };
}
