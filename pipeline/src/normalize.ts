import type { Category } from './types.ts';
import { FSQ_CAFE_SEGMENTS, FSQ_NIGHTLIFE_SEGMENTS } from './config.ts';

export function nameKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/^the(?: |$)/, '')
    .replace(/ +/g, ' ');
}

export function nameSimilarity(a: string, b: string): number {
  const ka = nameKey(a);
  const kb = nameKey(b);
  if (!ka || !kb) return 0;
  const ta = new Set(ka.split(' '));
  const tb = new Set(kb.split(' '));
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

const OSM_CATEGORY: Record<string, Category> = {
  cafe: 'cafe',
  bar: 'nightlife',
  pub: 'nightlife',
  restaurant: 'restaurant',
  fast_food: 'restaurant',
  ice_cream: 'restaurant',
  food_court: 'restaurant',
};

export function osmCategory(amenity: string): Category | null {
  return Object.hasOwn(OSM_CATEGORY, amenity) ? OSM_CATEGORY[amenity]! : null;
}

export function fsqCategory(primaryLabel: string): Category | null {
  const seg = primaryLabel.split(' > ').map((s) => s.trim());
  if (seg[0] !== 'Dining and Drinking') return null;
  const second = seg[1];
  if (second !== undefined) {
    if ((FSQ_CAFE_SEGMENTS as readonly string[]).includes(second)) return 'cafe';
    if ((FSQ_NIGHTLIFE_SEGMENTS as readonly string[]).includes(second)) return 'nightlife';
  }
  return 'restaurant';
}

function toCuisine(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '_');
}

function uniqueCuisines(raws: string[]): string[] {
  const out: string[] = [];
  for (const raw of raws) {
    const c = toCuisine(raw);
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

export function osmCuisines(tags: Record<string, string>): string[] {
  return uniqueCuisines((tags.cuisine ?? '').split(';'));
}

export function fsqCuisines(labels: string[]): string[] {
  const raws: string[] = [];
  for (const label of labels) {
    const seg = label.split(' > ').map((s) => s.trim());
    if (seg[1] !== 'Restaurant' || seg.length < 3) continue;
    raws.push(seg[seg.length - 1]!.replace(/ Restaurant$/, ''));
  }
  return uniqueCuisines(raws);
}

function joinAddress(street: string, locality: string): string | null {
  const parts = [street, locality].filter((p) => p !== '');
  return parts.length ? parts.join(', ') : null;
}

function clean(v: string | null | undefined): string {
  return (v ?? '').trim();
}

function words(...parts: Array<string | null | undefined>): string {
  return parts.map(clean).filter(Boolean).join(' ');
}

export function osmAddress(tags: Record<string, string>): string | null {
  return joinAddress(
    words(tags['addr:housenumber'], tags['addr:street']),
    words(tags['addr:city'], tags['addr:postcode']),
  );
}

export function fsqAddress(p: { address: string | null; locality: string | null; postcode: string | null }): string | null {
  return joinAddress(clean(p.address), words(p.locality, p.postcode));
}

const OSM_TAG_KEYS = new Set([
  'outdoor_seating', 'internet_access', 'takeaway', 'delivery', 'wheelchair', 'opening_hours', 'amenity', 'cuisine',
  'live_music', 'smoking', 'wikidata', 'wikimedia_commons', 'image', 'happy_hours',
]);

export function pickOsmTags(tags: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tags)) {
    if (OSM_TAG_KEYS.has(k) || k.startsWith('diet:')) out[k] = v;
  }
  return out;
}
