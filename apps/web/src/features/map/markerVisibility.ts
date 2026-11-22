import type { FocusMode } from './focusMode';
/** Focus visibility affects presentation and hit testing, never discovery filters. */
export function markerVisible(mode: FocusMode, kind: 'discovery' | 'search', id: string, relevantIds: readonly string[]) {
  if (mode === 'navigation') return false; // dedicated trip endpoints and hubs replace destination pins
  if (mode === 'discovery') return kind === 'discovery' || relevantIds.includes(id);
  return kind === 'search' || relevantIds.includes(id);
}
export function setMarkerVisible(element: HTMLElement, visible: boolean) {
  element.classList.toggle('vb-marker-hidden', !visible);
  element.inert = !visible;
  element.setAttribute('aria-hidden', String(!visible));
}
