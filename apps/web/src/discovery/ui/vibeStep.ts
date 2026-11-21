/**
 * Dedicated "what should it feel like?" screen.
 * Text and browser-local File objects live in the same observable preferences
 * store as the practical filters. No upload or AI analysis occurs here.
 */
import {
  VIBE_TEXT_MAX_LENGTH,
  type InitialPreferences,
  type PreferencesAction,
} from '../preferences';
import { appendVibeImages, MAX_VIBE_IMAGES, MAX_VIBE_IMAGE_BYTES } from '../vibeImages';
import type { Store } from '../store';
import { h, icon, uid } from './dom';

const PHOTO_ICON = 'M21 19V5H3v14h18zm0-16a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h18zM8.5 7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zm-4 10 5-4 3 2.5 3-4.5 4.5 6H4.5z';
const PLUS_ICON = 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z';
const REMOVE_ICON = 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z';

const EXAMPLES = [
  {
    title: 'Warm & nostalgic',
    detail: 'Rainy-day café',
    text: 'Like a cozy movie scene on a rainy afternoon: warm lamps, books, jazz, soft conversation, and somewhere comfortable to stay a while.',
  },
  {
    title: 'Electric & social',
    detail: 'Neon night out',
    text: 'An energetic, neon-lit night with friends. Think bright signs, great music, lots of people, colorful drinks and spontaneous adventures.',
  },
  {
    title: 'Dreamy & cinematic',
    detail: 'Old-city magic',
    text: 'Like wandering through an old European street at dusk: historic buildings, little shops, golden lights, a romantic dinner and hidden corners.',
  },
] as const;

export interface VibeStep {
  root: HTMLElement;
  focus(): void;
  render(state: InitialPreferences): void;
  destroy(): void;
}

export function createVibeStep(prefs: Store<InitialPreferences, PreferencesAction>): VibeStep {
  const inputId = uid('vibe-story');
  const helpId = uid('vibe-help');
  const counterId = uid('vibe-counter');
  const uploaderId = uid('vibe-images');
  const statusId = uid('vibe-upload-status');

  const story = h('textarea', {
    id: inputId,
    class: 'vb-textarea vb-vibe-story',
    rows: 5,
    maxlength: VIBE_TEXT_MAX_LENGTH,
    placeholder: 'A place that feels like a scene from a movie: warm lights, a little rain outside, music playing, and somewhere I can talk with friends…',
    'aria-describedby': `${helpId} ${counterId}`,
  });
  story.addEventListener('input', () => prefs.dispatch({ type: 'setVibeText', text: story.value }));

  const counter = h('span', { id: counterId, class: 'vb-counter' }, `0/${VIBE_TEXT_MAX_LENGTH}`);
  const exampleButtons = EXAMPLES.map((example) => {
    const button = h(
      'button',
      { class: 'vb-vibe-example', type: 'button', title: `Use example: ${example.title}` },
      h('span', { class: 'vb-example-title' }, example.title),
      h('span', { class: 'vb-example-subtitle' }, example.detail),
    );
    button.addEventListener('click', () => {
      prefs.dispatch({ type: 'setVibeText', text: example.text });
      story.focus();
      story.setSelectionRange(story.value.length, story.value.length);
    });
    return button;
  });

  const fileInput = h('input', {
    id: uploaderId,
    type: 'file',
    accept: 'image/jpeg,image/png,image/webp',
    multiple: true,
    hidden: true,
    'aria-label': 'Choose one or more vibe reference images',
  });
  const uploadButton = h(
    'button',
    { type: 'button', class: 'vb-upload-button', 'aria-controls': uploaderId },
    icon(PHOTO_ICON, 29),
    h('span', { class: 'vb-upload-label' }, 'Drop photos here, or browse'),
    h('span', { class: 'vb-upload-detail' }, 'Moodboards, screenshots, movie stills, colors, places — anything that feels right'),
    h('span', { class: 'vb-upload-limit' }, `JPG, PNG or WebP · Up to ${MAX_VIBE_IMAGES} images · ${MAX_VIBE_IMAGE_BYTES / 1024 / 1024} MB each`),
  );
  uploadButton.addEventListener('click', () => fileInput.click());
  const previews = h('div', { class: 'vb-image-previews', 'aria-label': 'Selected vibe images' });
  const uploadStatus = h('p', { class: 'vb-upload-status', id: statusId, role: 'status', 'aria-live': 'polite' });
  const dropZone = h('div', { class: 'vb-upload-zone' }, fileInput, uploadButton, previews, uploadStatus);

  function applyFiles(incoming: File[]) {
    if (incoming.length === 0) return;
    const result = appendVibeImages(prefs.getState().vibeImages, incoming);
    prefs.dispatch({ type: 'setVibeImages', files: result.files });
    uploadStatus.textContent = result.errors.length
      ? result.errors.join(' ')
      : `${result.files.length} ${result.files.length === 1 ? 'image' : 'images'} ready to use.`;
    uploadStatus.classList.toggle('is-error', result.errors.length > 0);
  }

  fileInput.addEventListener('change', () => {
    applyFiles(Array.from(fileInput.files ?? []));
    // Allow picking the same image again after removal.
    fileInput.value = '';
  });

  // Dragging over a child element should not deactivate the drop zone.
  let dragDepth = 0;
  dropZone.addEventListener('dragenter', (event) => {
    event.preventDefault();
    dragDepth += 1;
    dropZone.classList.add('is-dragging');
  });
  dropZone.addEventListener('dragover', (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  });
  dropZone.addEventListener('dragleave', (event) => {
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropZone.classList.remove('is-dragging');
  });
  dropZone.addEventListener('drop', (event) => {
    event.preventDefault();
    dragDepth = 0;
    dropZone.classList.remove('is-dragging');
    applyFiles(Array.from(event.dataTransfer?.files ?? []));
  });

  // Object URLs are presentation only; original File objects stay in the store.
  const previewUrls = new Map<File, string>();
  let lastImages: readonly File[] = [];
  function renderImages(images: readonly File[]) {
    if (images.length === lastImages.length && images.every((file, i) => file === lastImages[i])) return;
    lastImages = [...images];
    for (const [file, url] of previewUrls) {
      if (!images.includes(file)) {
        URL.revokeObjectURL(url);
        previewUrls.delete(file);
      }
    }

    previews.replaceChildren(
      ...images.map((file, index) => {
        let url = previewUrls.get(file);
        if (!url) {
          url = URL.createObjectURL(file);
          previewUrls.set(file, url);
        }
        const remove = h('button', {
          type: 'button',
          class: 'vb-image-remove',
          'aria-label': `Remove photo ${index + 1}: ${file.name}`,
          title: `Remove ${file.name}`,
        }, icon(REMOVE_ICON, 18));
        remove.addEventListener('click', () => {
          prefs.dispatch({ type: 'setVibeImages', files: prefs.getState().vibeImages.filter((item) => item !== file) });
          uploadStatus.textContent = '';
          uploadStatus.classList.remove('is-error');
        });
        return h(
          'div',
          { class: 'vb-image-preview' },
          h('img', { src: url, alt: `Reference image ${index + 1}: ${file.name}`, loading: 'lazy' }),
          remove,
          h('span', { class: 'vb-image-filename', title: file.name }, file.name),
        );
      }),
    );
    previews.hidden = images.length === 0;
    if (images.length === 0) {
      uploadStatus.textContent = '';
      uploadStatus.classList.remove('is-error');
    }
    uploadButton.classList.toggle('has-images', images.length > 0);
    const full = images.length >= MAX_VIBE_IMAGES;
    uploadButton.disabled = full;
    uploadButton.setAttribute('aria-label', full ? 'Five images selected; remove one to add another' : 'Choose vibe reference images');
    if (full && !uploadStatus.classList.contains('is-error')) {
      uploadStatus.textContent = 'Five images selected. Remove one to add another.';
    }
  }

  const root = h(
    'div',
    { class: 'vb-vibe-screen' },
    h('div', { class: 'vb-vibe-intro' },
      h('p', { class: 'vb-overline' }, 'Your inspiration'),
      h('h3', { class: 'vb-vibe-heading' }, 'What do you want it to feel like?'),
      h('p', { class: 'vb-vibe-lead' },
        'Describe a mood, a movie or specific scene, a song, or the objects, colors and atmosphere you picture. There are no wrong answers.'),
    ),
    h('div', { class: 'vb-field' },
      h('label', { class: 'vb-label vb-vibe-label', for: inputId }, 'Describe your vibe ', h('span', { class: 'vb-optional' }, '(optional)')),
      story,
      h('div', { class: 'vb-field-foot' },
        h('span', { class: 'vb-hint-inline', id: helpId },
          'Mention lighting, energy, music, people, setting, memories, movie scenes or even everyday objects.'),
        counter,
      ),
    ),
    h('div', { class: 'vb-vibe-examples' },
      h('div', { class: 'vb-vibe-section-head' },
        h('span', { class: 'vb-vibe-section-label' }, 'Need inspiration?'),
        h('span', { class: 'vb-vibe-section-help' }, 'Tap an example to start'),
      ),
      h('div', { class: 'vb-example-grid' }, ...exampleButtons),
    ),
    h('section', { class: 'vb-vibe-upload-section', 'aria-label': 'Photo inspiration' },
      h('div', { class: 'vb-vibe-section-head' },
        h('label', { class: 'vb-vibe-section-label', for: uploaderId }, 'Or show us the feeling'),
        icon(PLUS_ICON, 18),
      ),
      h('p', { class: 'vb-upload-explainer' }, 'Add one photo or a whole moodboard. Your images stay on this device for now; visual matching is being built next.'),
      dropZone,
    ),
  );

  return {
    root,
    focus: () => story.focus(),
    render(state) {
      if (story.value !== state.vibeText) story.value = state.vibeText;
      counter.textContent = `${state.vibeText.length}/${VIBE_TEXT_MAX_LENGTH}`;
      renderImages(state.vibeImages);
    },
    destroy() {
      for (const url of previewUrls.values()) URL.revokeObjectURL(url);
      previewUrls.clear();
    },
  };
}
