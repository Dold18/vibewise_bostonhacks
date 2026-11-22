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
import { priceLabel } from '../../catalog';
import { dealStatus, describeSchedule, type Deal } from '../../deals';
import { iconForCategoryMark, vwIconHtml, type IconName } from '../../design/vibewise/icons';

export interface PopupDetail {
  kind: 'address' | 'hours' | 'phone' | 'price';
  text: string;
}

export interface PopupDetails {
  title: string;
  category: string;
  details: PopupDetail[];
  website?: string;
  osmUrl: string;
  attribution?: string;
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
  if (place.tags['catalog:price_band']) details.push({ kind: 'price', text: priceLabel(place.tags['catalog:price_band'], place.tags['catalog:price_source']) });
  const phone = place.tags.phone ?? place.tags['contact:phone'];
  if (phone) details.push({ kind: 'phone', text: phone });
  const website = safeHttpUrl(place.tags.website ?? place.tags['contact:website']);
  return { title: place.name, category: place.category, details, ...(website ? { website } : {}), osmUrl: osmUrl(place), attribution: place.tags['catalog:attribution'] };
}

/*
 * Offsets put the popup tip just clear of the selected pin (28×40px at 1.3×
 * scale, anchored at its tip) on whichever side MapLibre places the popup.
 */
const PIN_TOP = 54;
/** Distance from the pin's map point to the popup's tip when it sits above the pin. */
export const POPUP_PIN_GAP = PIN_TOP;
/** Height of MapLibre's popup tip (10 px border triangle). */
const TIP_PX = 10;
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

/** V3 icons for the popup (src/design/vibewise/icons). */
const SVG = (name: IconName, size = 18) => vwIconHtml(name, { size });
const ICON = {
  price: 'deal',
  address: 'pin',
  hours: 'clock',
  phone: 'phone',
  close: 'close',
  navigate: 'navigate',
  save: 'saved',
  saved: 'saved',
} as const satisfies Record<string, IconName>;

export interface PlacePopupDeps {
  onNavigate(place: Place): void;
  saved: { has(id: string): boolean; toggle(place: Place): boolean };
  /** Called whenever the popup closes (close button, Esc, map click, `close()`); not when it switches places. */
  onClose(place: Place): void;
}

export interface PlacePopup {
  open(place: Place, look: { color: string; icon?: string }): void;
  close(): void;
  isOpen(): boolean;
  current(): Place | null;
  /** Re-read saved state (e.g. after the Saved list removes this place). */
  refreshSaved(): void;
  refreshDeals(now: Date): void;
  element(): HTMLElement | null;
  /** Rendered size of the open popup, tip included (for camera placement). */
  size(): { width: number; height: number } | null;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

const shortDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });

function dealStatusText(deal: Deal, now: Date): string {
  const status = dealStatus(deal, now);
  switch (status.kind) {
    case 'active':
      return 'Active now';
    case 'next':
      return status.label;
    case 'unconfirmed':
      return 'Times not confirmed';
    case 'stale':
      return 'Not recently checked';
  }
}

function renderDealRows(place: Place, list: HTMLElement, now: Date) {
  list.replaceChildren();
  for (const deal of place.deals ?? []) {
    const li = el('li', 'deal-row');
    const head = el('div', 'deal-title');
    const mark = el('span', 'detail-icon');
    mark.setAttribute('aria-hidden', 'true');
    mark.innerHTML = vwIconHtml(deal.kind === 'student' ? 'culture' : 'deal', { size: 18 });
    head.append(mark, el('span', undefined, deal.title));
    li.append(head);
    const status = dealStatus(deal, now);
    const when = el('div', `deal-when${status.kind === 'active' ? ' deal-active' : ''}`);
    when.textContent = [describeSchedule(deal), dealStatusText(deal, now)].filter(Boolean).join(' · ');
    li.append(when);
    const meta = el('div', 'deal-meta');
    const href = deal.source === 'osm' ? osmUrl(place) : safeHttpUrl(deal.sourceUrl ?? undefined);
    if (href) {
      const a = el('a', undefined, 'Source');
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      meta.append(a);
    }
    const checked = new Date(deal.checkedAt);
    if (!Number.isNaN(checked.getTime())) meta.append(el('span', undefined, `checked ${shortDate.format(checked)}`));
    if (deal.source === 'website') meta.append(el('span', undefined, 'found on venue site'));
    li.append(meta);
    list.append(li);
  }
}

let popupSeq = 0;

export function createPlacePopup(map: MapLibreMap, deps: PlacePopupDeps): PlacePopup {
  let place: Place | null = null;
  let content: HTMLElement | null = null;
  let dealsList: HTMLElement | null = null;
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
    content = saveBtn = dealsList = null;
    if (closed) deps.onClose(closed);
  });

  function renderSave() {
    if (!saveBtn || !place) return;
    const isSaved = deps.saved.has(place.id);
    saveBtn.setAttribute('aria-pressed', String(isSaved));
    saveBtn.innerHTML = `${SVG(isSaved ? ICON.saved : ICON.save)}<span>${isSaved ? 'Saved' : 'Save'}</span>`;
    saveBtn.title = isSaved ? 'Remove from saved places' : 'Save this place';
    saveBtn.classList.toggle('is-saved', isSaved);
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
    // V3 venue mark: the category hue with a paper glyph (hue alone is never the only cue).
    badge.innerHTML = vwIconHtml(iconForCategoryMark(look.icon), { size: 24 });
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

    dealsList = null;
    if (p.deals?.length) {
      dealsList = el('ul', 'deal-list');
      renderDealRows(p, dealsList, new Date());
      root.append(el('h4', 'vb-popup-section', 'Deals'), dealsList);
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
      a.insertAdjacentHTML('beforeend', vwIconHtml('external', { size: 14 }));
      return a;
    };
    if (d.website) links.append(link('Website', d.website));
    links.append(link('OpenStreetMap', d.osmUrl));
    root.append(links);
    if (d.attribution) { const attribution = document.createElement('p'); attribution.className = 'vb-popup-attribution'; attribution.textContent = d.attribution; root.append(attribution); }

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
    refreshDeals(now) { if (place && dealsList) renderDealRows(place, dealsList, now); },
    element: () => content,
    size: () => (content ? { width: content.offsetWidth, height: content.offsetHeight + TIP_PX } : null),
  };
  return api;
}
