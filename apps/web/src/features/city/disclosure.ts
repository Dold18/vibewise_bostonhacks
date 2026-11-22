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
  Object.assign(el.style, {
    position: 'absolute', right: '60px', bottom: '40px', zIndex: '2', margin: '0', maxWidth: 'min(420px, calc(100% - 80px))',
    padding: '3px 8px', borderRadius: '4px', pointerEvents: 'none',
    font: '500 11px/1.35 system-ui, sans-serif',
    color: '#3c4043', background: 'rgba(255, 255, 255, 0.94)', opacity: '0.86',
  } satisfies Partial<CSSStyleDeclaration>);
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
