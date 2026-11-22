/**
 * "Stylized view" disclosure. While the City Changer restyles building facades
 * or places decorations, those are imagined, not real Boston. The geography,
 * places, transit and routes are real. A quiet caption above the attribution
 * says so; it never takes pointer events and hides with the restyling.
 */
export const STYLIZED_NOTE = 'Stylized view · facades and props are imagined; places, streets and routes are real';

export interface StylizedNotice {
  set(active: boolean): void;
  readonly element: HTMLElement;
  destroy(): void;
}

export function mountStylizedNotice(container: HTMLElement): StylizedNotice {
  const el = document.createElement('p');
  el.className = 'vb-stylized-note';
  el.setAttribute('role', 'note');
  el.textContent = STYLIZED_NOTE;
  el.hidden = true;
  // Placement and Vibewise styling: .vb-stylized-note in style.css.
  container.appendChild(el);
  return {
    element: el,
    set(active) {
      if (el.hidden === !active) return;
      el.hidden = !active;
    },
    destroy() {
      el.remove();
    },
  };
}
