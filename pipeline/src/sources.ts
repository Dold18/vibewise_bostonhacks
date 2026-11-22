import { ATTRIBUTION_FSQ, ATTRIBUTION_OSM, STUDY_BBOX } from './config.ts';
import { toEwkt } from './geo.ts';
import { fsqAddress, fsqCategory, fsqCuisines, osmAddress, osmCategory, osmCuisines, pickOsmTags } from './normalize.ts';
import { classifyFsq, classifyOsm, type OsmBounds, type PlaceTypeConfig } from './placeTypes.ts';
import type { BaseRow, Category, FsqPlace, OsmPlace, PlaceRow } from './types.ts';

export interface OverpassElement {
  type: 'node' | 'way' | 'relation'; id: number;
  lat?: number; lon?: number; center?: { lat: number; lon: number };
  bounds?: OsmBounds;                // ways/relations under `out bb`
  tags?: Record<string, string>;
}

function clean(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '') return null;
    v = t;
  }
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

const BBOX_MARGIN_DEG = 0.01;

/** Rejects (0,0) and other stray coordinates: must lie within the study bbox plus a small margin. */
function inStudyArea(lat: number, lng: number): boolean {
  return lat >= STUDY_BBOX.south - BBOX_MARGIN_DEG && lat <= STUDY_BBOX.north + BBOX_MARGIN_DEG
    && lng >= STUDY_BBOX.west - BBOX_MARGIN_DEG && lng <= STUDY_BBOX.east + BBOX_MARGIN_DEG;
}

/** Midpoint of a bounding box: the same point Overpass's `center` reports. */
function boundsMid(b: OsmBounds | undefined): { lat: number; lng: number } | undefined {
  if (!b) return undefined;
  return { lat: (b.minlat + b.maxlat) / 2, lng: (b.minlon + b.maxlon) / 2 };
}

/** Keeps named elements in the study area that belong to `cfg`'s type (first match in PLACE_TYPES order) and pass its filter. */
export function parseOverpass(elements: OverpassElement[], cfg: PlaceTypeConfig): OsmPlace[] {
  const out: OsmPlace[] = [];
  for (const el of elements) {
    const tags = el.tags;
    if (!tags) continue;
    const name = clean(tags.name);
    if (!name) continue;
    const bounds = el.bounds ?? null;
    if (classifyOsm(tags)?.type !== cfg.type || !cfg.keepOsm(tags, bounds)) continue;
    const mid = boundsMid(el.bounds);
    const lat = el.lat ?? el.center?.lat ?? mid?.lat;
    const lng = el.lon ?? el.center?.lon ?? mid?.lng;
    if (typeof lat !== 'number' || typeof lng !== 'number' || !inStudyArea(lat, lng)) continue;
    out.push({ osmId: `${el.type}/${el.id}`, name, lat, lng, tags, bounds });
  }
  return out;
}

export function parseFsqRows(rows: Record<string, unknown>[], cfg: PlaceTypeConfig): FsqPlace[] {
  const out: FsqPlace[] = [];
  for (const r of rows) {
    const fsqId = clean(r.fsq_place_id);
    const name = clean(r.name);
    const lat = toNumber(r.latitude);
    const lng = toNumber(r.longitude);
    const labels = Array.isArray(r.fsq_category_labels)
      ? r.fsq_category_labels.filter((l): l is string => typeof l === 'string')
      : [];
    if (!fsqId || !name || lat === null || lng === null || !inStudyArea(lat, lng) || labels.length === 0) continue;
    if (classifyFsq(labels[0])?.type !== cfg.type) continue;
    out.push({
      fsqId, name, lat, lng,
      address: clean(r.address), locality: clean(r.locality), postcode: clean(r.postcode),
      tel: clean(r.tel), website: clean(r.website),
      categoryLabels: labels,
      dateRefreshed: clean(r.date_refreshed),
    });
  }
  return out;
}

type Common = Omit<BaseRow, 'id' | 'hours_raw' | 'osm_tags' | 'fsq_place_id' | 'attribution' | 'last_seen_at'>;
type Tail = Pick<BaseRow, 'hours_raw' | 'osm_tags' | 'fsq_place_id' | 'attribution' | 'last_seen_at'>;

/** Food rows carry category + source_cuisines, other types carry kind; columns keep today's order. */
function assemble(head: Common, typed: { category: Category; source_cuisines: string[] } | { kind: string }, tail: Tail): PlaceRow {
  return { ...head, ...typed, ...tail };
}

export function osmRow(p: OsmPlace, runStart: string, cfg: PlaceTypeConfig): PlaceRow {
  const head: Common = {
    place_id: `osm:${p.osmId}`, source: 'osm', source_id: p.osmId, name: p.name.trim(),
    location: toEwkt(p.lat, p.lng),
    address: osmAddress(p.tags),
    website: clean(p.tags.website) ?? clean(p.tags['contact:website']),
    phone: clean(p.tags.phone) ?? clean(p.tags['contact:phone']),
  };
  const tail: Tail = {
    hours_raw: clean(p.tags.opening_hours),
    osm_tags: pickOsmTags(p.tags, cfg.osmTagKeys),
    fsq_place_id: null, attribution: ATTRIBUTION_OSM, last_seen_at: runStart,
  };
  if (cfg.type === 'restaurants') {
    const category = osmCategory(p.tags.amenity);
    if (category === null) throw new Error(`osmRow: unsupported amenity '${p.tags.amenity}' for ${p.osmId}`);
    return assemble(head, { category, source_cuisines: osmCuisines(p.tags) }, tail);
  }
  const kind = cfg.osmKind(p.tags);
  if (kind === null) throw new Error(`osmRow: ${p.osmId} is not a ${cfg.type} place`);
  return assemble(head, { kind }, tail);
}

export function fsqRow(p: FsqPlace, runStart: string, cfg: PlaceTypeConfig): PlaceRow {
  const head: Common = {
    place_id: `fsq:${p.fsqId}`, source: 'foursquare', source_id: p.fsqId, name: p.name.trim(),
    location: toEwkt(p.lat, p.lng),
    address: fsqAddress(p),
    website: clean(p.website), phone: clean(p.tel),
  };
  const tail: Tail = {
    hours_raw: null, osm_tags: null,
    fsq_place_id: p.fsqId, attribution: ATTRIBUTION_FSQ, last_seen_at: runStart,
  };
  if (cfg.type === 'restaurants') {
    const category = fsqCategory(p.categoryLabels[0]);
    if (category === null) throw new Error(`fsqRow: unsupported category '${p.categoryLabels[0]}' for ${p.fsqId}`);
    return assemble(head, { category, source_cuisines: fsqCuisines(p.categoryLabels) }, tail);
  }
  const kind = cfg.fsqKind(p.categoryLabels[0]);
  if (kind === null) throw new Error(`fsqRow: unsupported category '${p.categoryLabels[0]}' for ${p.fsqId} (${cfg.type})`);
  return assemble(head, { kind }, tail);
}
