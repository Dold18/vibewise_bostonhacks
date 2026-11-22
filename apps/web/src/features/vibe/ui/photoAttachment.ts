/**
 * One-photo attachment shared by the vibe screen and the quiz's own-words box.
 * A renderer over caller-owned state: the caller keeps `PhotoAttachmentState`
 * and re-creates the attachment when it changes, so a re-render keeps the draft.
 * The one write it makes is `state.status`, set to the first validation error
 * (or cleared) when the user picks, drops or removes a photo, before `onFile`.
 * It never reads or uploads the photo; that happens on send (`prepareMessage`).
 * Status text is shown in the attachment and copied into the host's `announcer`, a
 * persistent live region the host never re-creates, so a new message is announced.
 */
import { h, icon } from '../../../discovery/ui/dom';
import { ACCEPTED_VIBE_IMAGE_TYPES, MAX_VIBE_IMAGE_BYTES, appendVibeImages } from '../../../discovery/vibeImages';
import type { PhotoAccessSource, PhotoAccessStatus } from '../photoAccess';
import './quiz.css';

export interface PhotoAttachmentState { file: File | null; description: string | null; status: { text: string; kind: 'info' | 'error' } | null; busy: boolean }

const PHOTO_ICON = 'M21 19V5H3v14h18zm0-16a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h18zM8.5 7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zm-4 10 5-4 3 2.5 3-4.5 4.5 6H4.5z';
const REMOVE_ICON = 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z';

// Thumbnail object URLs are shared by every attachment showing the same File, so
// re-creating an attachment reuses the URL instead of revoking it mid-load.
const thumbnails = new Map<File, { url: string; users: number }>();
function holdThumbnail(file: File): string {
  const entry = thumbnails.get(file) ?? { url: URL.createObjectURL(file), users: 0 };
  entry.users += 1;
  thumbnails.set(file, entry);
  return entry.url;
}
function releaseThumbnail(file: File) {
  const entry = thumbnails.get(file);
  if (!entry || --entry.users > 0) return;
  URL.revokeObjectURL(entry.url);
  thumbnails.delete(file);
}

export function createPhotoAttachment(o: { state: PhotoAttachmentState; onFile: (file: File | null) => void; access: PhotoAccessSource; signInLabel: string; announcer: HTMLElement; dropZone?: boolean }): { root: HTMLElement; destroy(): void } {
  const { state, access } = o;
  const root = h('div', { class: o.dropZone ? 'vb-photo-attachment vb-upload-zone' : 'vb-photo-attachment' });
  let rendered: PhotoAccessStatus | null = null;
  let destroyed = false;
  let thumbFile: File | null = null;

  function choose(incoming: File[]) {
    if (incoming.length === 0 || state.busy || access.status() !== 'signed_in') return;
    // Validate against the current photo so a second one is refused, not swapped in.
    const result = appendVibeImages(state.file ? [state.file] : [], incoming);
    state.status = result.errors.length ? { text: result.errors[0], kind: 'error' } : null;
    const next = result.files[0] ?? null;
    // onFile first: a caller that re-creates the attachment still sees the focused control.
    if (next !== state.file) o.onFile(next);
    render();
  }

  function thumbnailUrl(file: File): string {
    if (thumbFile !== file) {
      const url = holdThumbnail(file);
      if (thumbFile) releaseThumbnail(thumbFile);
      thumbFile = file;
      return url;
    }
    return thumbnails.get(file)!.url;
  }

  function statusLine(): HTMLElement {
    // Visible copy only; screen readers hear the message through the host's announcer.
    const line = h('p', { class: state.status?.kind === 'error' ? 'vb-upload-status vb-photo-status is-error' : 'vb-upload-status vb-photo-status' });
    line.textContent = state.status?.text ?? '';
    return line;
  }

  function addControls(): HTMLElement[] {
    const input = h('input', { type: 'file', accept: ACCEPTED_VIBE_IMAGE_TYPES.join(','), hidden: true, 'aria-label': 'Choose a photo' });
    input.addEventListener('change', () => { choose(Array.from(input.files ?? [])); input.value = ''; });
    const button = o.dropZone
      ? h('button', { type: 'button', class: 'vb-upload-button', disabled: state.busy },
        icon(PHOTO_ICON, 22),
        h('span', { class: 'vb-upload-copy' },
          h('span', { class: 'vb-upload-label' }, 'Add photo'),
          h('span', { class: 'vb-upload-detail' }, 'Drag an image here or click to browse'),
        ),
        h('span', { class: 'vb-upload-limit' }, `1 photo · ${MAX_VIBE_IMAGE_BYTES / 1024 / 1024} MB`),
      )
      : h('button', { type: 'button', class: 'vb-text-btn vb-photo-add', disabled: state.busy }, icon(PHOTO_ICON, 18), 'Add photo');
    button.addEventListener('click', () => input.click());
    return [input, button];
  }

  function attached(file: File): HTMLElement {
    const remove = h('button', { type: 'button', class: 'vb-image-remove', 'aria-label': 'Remove photo', title: 'Remove photo', disabled: state.busy }, icon(REMOVE_ICON, 18));
    remove.addEventListener('click', () => { if (state.busy) return; state.status = null; o.onFile(null); render(); });
    return h('div', { class: 'vb-photo-attached' },
      h('div', { class: 'vb-image-preview vb-photo-thumb' }, h('img', { src: thumbnailUrl(file), alt: `Attached photo: ${file.name}` }), remove),
      state.description ? h('p', { class: 'vb-photo-description' }, state.description) : null,
    );
  }

  function render() {
    if (destroyed) return;
    // Change the live region's text only when the message changes, so a re-created attachment isn't re-announced.
    const message = state.status?.text ?? '';
    if (o.announcer.textContent !== message) o.announcer.textContent = message;
    rendered = access.status();
    if (thumbFile && (rendered !== 'signed_in' || state.file !== thumbFile)) { releaseThumbnail(thumbFile); thumbFile = null; }
    // While sign-in status loads, show no controls; a pending message still shows.
    if (rendered === 'loading') { root.replaceChildren(...(state.status ? [statusLine()] : [])); return; }
    // Accounts are down: signing in can't help, so say so plainly (no control to press).
    if (rendered === 'unavailable') { root.replaceChildren(h('p', { class: 'vb-photo-unavailable' }, "Photo input isn't available right now."), statusLine()); return; }
    if (rendered !== 'signed_in') {
      const signIn = h('button', { type: 'button', class: 'vb-text-btn vb-photo-signin' }, o.signInLabel);
      signIn.addEventListener('click', () => access.requestSignIn());
      root.replaceChildren(signIn, statusLine());
      return;
    }
    root.replaceChildren(...(state.file ? [attached(state.file)] : addControls()), statusLine());
  }

  // Only a change of sign-in status changes what is shown; other account updates are ignored.
  const unsubscribe = access.subscribe(() => { if (access.status() !== rendered) render(); });

  if (o.dropZone) {
    // Always cancel the browser default so a stray drop never navigates away from the draft.
    let depth = 0;
    const accepting = () => access.status() === 'signed_in' && !state.busy;
    root.addEventListener('dragenter', (e) => { e.preventDefault(); if (!accepting()) return; depth += 1; root.classList.add('is-dragging'); });
    root.addEventListener('dragover', (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = accepting() ? 'copy' : 'none'; });
    root.addEventListener('dragleave', (e) => { e.preventDefault(); depth = Math.max(0, depth - 1); if (depth === 0) root.classList.remove('is-dragging'); });
    root.addEventListener('drop', (e) => { e.preventDefault(); depth = 0; root.classList.remove('is-dragging'); choose(Array.from(e.dataTransfer?.files ?? [])); });
  }

  render();
  return {
    root,
    destroy() {
      destroyed = true;
      unsubscribe();
      if (thumbFile) releaseThumbnail(thumbFile);
      thumbFile = null;
    },
  };
}
