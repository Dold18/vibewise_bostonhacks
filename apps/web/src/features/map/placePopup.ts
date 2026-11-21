/**
 * The destination popup, anchored to the selected place on the map. It
 * replaces the old fixed-position place card.
 *
 * One MapLibre `Popup` is reused for every place (pins, search results, saved
 * places), so only one is ever open. MapLibre keeps it attached to the
 * coordinates through pan/zoom/rotate/pitch and flips its side near screen
 * edges. It shows only facts from the place record: no distances, travel
 * times or routes (those live in the trip planner).
 */
import { Popup, type Map as MapLibreMap, type Offset } from 'maplibre-gl';
import { formatAddress, osmUrl, type Place } from '../../osm';
import './map-ui.css';

export interface PopupDetail {
  kind: 'address' | 'hours' | 'phone';
  text: string;
}

export interface PopupDetails {
  title: string;
  category: string;
  details: PopupDetail[];
  website?: string;
  osmUrl: string;
}

export function safeHttpUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    // Add https:// only to scheme-less values ("example.org"); keep any other scheme so it can be rejected.
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** What the popup shows for a place: only fields present in its OSM record. */
export function popupDetails(place: Place): PopupDetails {
  const details: PopupDetail[] = [];
  const address = formatAddress(place.tags) ?? place.tags.display_name;
  if (address) details.push({ kind: 'address', text: address });
  if (place.tags.opening_hours) details.push({ kind: 'hours', text: place.tags.opening_hours });
  const phone = place.tags.phone ?? place.tags['contact:phone'];
  if (phone) details.push({ kind: 'phone', text: phone });
  const website = safeHttpUrl(place.tags.website ?? place.tags['contact:website']);
  return { title: place.name, category: place.category, details, ...(website ? { website } : {}), osmUrl: osmUrl(place) };
}

/*
 * Offsets put the popup tip just clear of the selected pin (28×40px at 1.3×
 * scale, anchored at its tip) on whichever side MapLibre places the popup.
 */
const PIN_TOP = 54;
export const POPUP_OFFSETS: Offset = {
  center: [0, 0],
  top: [0, 8],
  'top-left': [6, 8],
  'top-right': [-6, 8],
  bottom: [0, -PIN_TOP],
  'bottom-left': [6, -PIN_TOP + 6],
  'bottom-right': [-6, -PIN_TOP + 6],
  left: [16, -26],
  right: [-16, -26],
};

const SVG = (path: string, size = 18) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" focusable="false"><path d="${path}"/></svg>`;
const ICON = {
  address: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7m0 9.5a2.5 2.5 0 0 1 0-5 2.5 2.5 0 0 1 0 5',
  hours: 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2M12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8m.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z',
  phone: 'M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02z',
  close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  navigate: 'M21.71 11.29l-9-9a.996.996 0 0 0-1.41 0l-9 9a.996.996 0 0 0 0 1.41l9 9c.39.39 1.02.39 1.41 0l9-9a.996.996 0 0 0 0-1.41M14 14.5V12h-4v3H8v-4c0-.55.45-1 1-1h5V7.5l3.5 3.5z',
  save: 'M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2m0 15-5-2.18L7 18V5h10z',
  saved: 'M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2',
};

export interface PlacePopupDeps {
  onNavigate(place: Place): void;
  saved: { has(id: string): boolean; toggle(place: Place): boolean };
  /** Called whenever the popup closes (close button, Esc, map click, replacement by `close()`). */
  onClose(place: Place): void;
}

export interface PlacePopup {
  open(place: Place, look: { color: string; icon?: string }): void;
  close(): void;
  isOpen(): boolean;
  current(): Place | null;
  /** Re-read saved state (e.g. after the Saved list removes this place). */
  refreshSaved(): void;
  element(): HTMLElement | null;
}

let popupSeq = 0;

export function createPlacePopup(map: MapLibreMap, deps: PlacePopupDeps): PlacePopup {
  let place: Place | null = null;
  let content: HTMLElement | null = null;
  let saveBtn: HTMLButtonElement | null = null;
  const popup = new Popup({
    closeButton: false,
    closeOnClick: false, // the map's own click handler closes it, keeping pin selection in sync
    closeOnMove: false,
    maxWidth: 'none',
    offset: POPUP_OFFSETS,
    className: 'vb-place-popup',
    focusAfterOpen: false,
  });
  popup.on('close', () => {
    const closed = place;
    place = null;
    content = saveBtn = null;
    if (closed) deps.onClose(closed);
  });

  function renderSave() {
    if (!saveBtn || !place) return;
    const isSaved = deps.saved.has(place.id);
    saveBtn.setAttribute('aria-pressed', String(isSaved));
    saveBtn.innerHTML = `${SVG(isSaved ? ICON.saved : ICON.save)}<span>${isSaved ? 'Saved' : 'Save'}</span>`;
    saveBtn.title = isSaved ? 'Remove from saved places' : 'Save this place';
  }

  function build(p: Place, look: { color: string; icon?: string }): HTMLElement {
    const d = popupDetails(p);
    const titleId = `vb-popup-title-${++popupSeq}`;
    const root = document.createElement('div');
    root.className = 'vb-ui vb-popup';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-labelledby', titleId);
    root.style.setProperty('--badge-color', look.color);

    const head = document.createElement('div');
    head.className = 'vb-popup-head';
    const badge = document.createElement('span');
    badge.className = 'vb-popup-badge';
    badge.setAttribute('aria-hidden', 'true');
    badge.textContent = look.icon ?? '';
    const titles = document.createElement('div');
    titles.className = 'vb-popup-titles';
    const h3 = document.createElement('h3');
    h3.id = titleId;
    h3.textContent = d.title;
    const cat = document.createElement('p');
    cat.textContent = d.category;
    titles.append(h3, cat);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'vb-popup-close';
    close.setAttribute('aria-label', `Close ${d.title}`);
    close.innerHTML = SVG(ICON.close, 18);
    close.addEventListener('click', () => api.close());
    head.append(badge, titles, close);
    root.append(head);

    if (d.details.length) {
      const ul = document.createElement('ul');
      ul.className = 'vb-popup-details';
      for (const item of d.details) {
        const li = document.createElement('li');
        li.innerHTML = SVG(ICON[item.kind], 16);
        const span = document.createElement('span');
        span.textContent = item.text;
        li.append(span);
        ul.append(li);
      }
      root.append(ul);
    }

    const actions = document.createElement('div');
    actions.className = 'vb-popup-actions';
    const nav = document.createElement('button');
    nav.type = 'button';
    nav.className = 'vb-popup-navigate';
    nav.innerHTML = `${SVG(ICON.navigate)}<span>Navigate</span>`;
    nav.addEventListener('click', () => deps.onNavigate(p));
    saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'vb-popup-save';
    saveBtn.addEventListener('click', () => {
      deps.saved.toggle(p);
      renderSave();
    });
    actions.append(nav, saveBtn);
    root.append(actions);

    const links = document.createElement('div');
    links.className = 'vb-popup-links';
    const link = (text: string, href: string) => {
      const a = document.createElement('a');
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = text;
      return a;
    };
    if (d.website) links.append(link('Website', d.website));
    links.append(link('OpenStreetMap', d.osmUrl));
    root.append(links);

    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        api.close();
      }
    });
    return root;
  }

  const api: PlacePopup = {
    open(p, look) {
      // Reuses the single popup; switching places is not a close (the caller
      // has already moved the pin selection to the new place).
      place = p;
      content = build(p, look);
      renderSave();
      popup.setLngLat([p.lon, p.lat]).setDOMContent(content);
      if (!popup.isOpen()) popup.addTo(map);
    },
    close() {
      if (popup.isOpen()) popup.remove();
    },
    isOpen: () => popup.isOpen() && !!place,
    current: () => place,
    refreshSaved: renderSave,
    element: () => content,
  };
  return api;
}
