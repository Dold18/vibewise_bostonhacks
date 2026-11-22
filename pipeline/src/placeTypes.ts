import { OSM_AMENITIES } from './config.ts';
import { metersBetween } from './geo.ts';
import { fsqCategory, osmCategory, OSM_TAG_KEYS } from './normalize.ts';

// Foursquare labels below were checked against the Boston extract of release 2026-01-12 on 2026-11-21
// (exact segments split on ' > ', never substrings).

export const PLACE_TYPES = ['restaurants', 'museums', 'entertainment', 'parks', 'landmarks'] as const;
export type PlaceType = (typeof PLACE_TYPES)[number];

export interface OsmBounds { minlat: number; minlon: number; maxlat: number; maxlon: number }

export interface PlaceTypeConfig {
  type: PlaceType;
  overpassFilters: string[];
  overpassOut: 'center' | 'bb';
  osmKind(tags: Record<string, string>): string | null;
  fsqTopLevels: string[];
  fsqKind(primaryLabel: string): string | null;
  keepOsm(tags: Record<string, string>, bounds: OsmBounds | null): boolean;
  /** false: a Foursquare place that neither matches nor merges into an OSM place is dropped (it only fills fields). */
  keepUnmatchedFsq: boolean;
  osmTagKeys: ReadonlySet<string>;
  genericNameWords: ReadonlySet<string>;
  dealsWebsiteScan: boolean;
  priceEstimates: boolean;
}

type Tags = Record<string, string>;

// --- OSM matching: each type lists key/allowed-values rules in filter order. ---
interface OsmRule { key: string; values: readonly string[] }

function matchRules(tags: Tags, rules: OsmRule[]): { key: string; kind: string } | null {
  for (const r of rules) {
    const v = tags[r.key];
    if (v !== undefined && r.values.includes(v)) return { key: r.key, kind: v };
  }
  return null;
}

function filterOf(r: OsmRule): string {
  if (r.values.length === 1) return `["${r.key}"="${r.values[0]}"]`;
  return `["${r.key}"~"^(${r.values.join('|')})$"]`;
}

function notDisused(tags: Tags, key: string): boolean {
  return !(`disused:${key}` in tags) && !(`was:${key}` in tags);
}

// --- Foursquare matching: exact segment paths, optionally allowing deeper sub-categories. ---
interface FsqRule { path: string[]; deeper?: boolean }

function snake(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function fsqMatch(label: string, rules: FsqRule[]): string | null {
  const seg = label.split(' > ').map((s) => s.trim());
  for (const r of rules) {
    if (seg.length < r.path.length) continue;
    if (!r.path.every((p, i) => seg[i] === p)) continue;
    if (seg.length > r.path.length && !r.deeper) continue;
    return snake(seg[seg.length - 1]!);
  }
  return null;
}

const AE = 'Arts and Entertainment';
const SR = 'Sports and Recreation';
const LO = 'Landmarks and Outdoors';

const EXTRA_OSM_TAG_KEYS = [
  'tourism', 'leisure', 'historic', 'natural', 'wikipedia', 'fee', 'charge', 'description', 'museum', 'museum_type',
  'theatre:genre', 'sport', 'capacity', 'dog', 'lit', 'access', 'heritage', 'start_date', 'architect', 'toilets',
];
const NON_FOOD_TAG_KEYS: ReadonlySet<string> = new Set([...OSM_TAG_KEYS, ...EXTRA_OSM_TAG_KEYS]);

const NON_FOOD_GENERIC_WORDS: ReadonlySet<string> = new Set([
  'park', 'parks', 'garden', 'gardens', 'museum', 'gallery', 'theatre', 'theater', 'cinema', 'playground', 'field',
  'square', 'memorial', 'monument', 'center', 'centre', 'stadium', 'arena', 'hall', 'beach', 'reservation', 'reserve',
]);

export function boundsAreaHa(b: OsmBounds): number {
  const midLat = (b.minlat + b.maxlat) / 2;
  const midLon = (b.minlon + b.maxlon) / 2;
  const width = metersBetween({ lat: midLat, lng: b.minlon }, { lat: midLat, lng: b.maxlon });
  const height = metersBetween({ lat: b.minlat, lng: midLon }, { lat: b.maxlat, lng: midLon });
  return (width * height) / 10000;
}

const MIN_PARK_HA = 0.5;

/** OSM routes (trails, race courses, bus lines) are lines across a city, never a place to visit. */
export function isOsmRoute(tags: Tags): boolean {
  return tags.type === 'route' || 'route' in tags;
}

/** One label per kind across sources: OSM and Foursquare spell some kinds differently. */
const KIND_ALIASES: Readonly<Record<string, string>> = {
  theater: 'theatre',
  indie_theater: 'theatre',
  night_club: 'nightclub',
  movie_theater: 'cinema',
  indie_movie_theater: 'cinema',
  art_gallery: 'gallery',
  historic_and_protected_site: 'historic_site',
};

export function normalizeKind(kind: string): string {
  return Object.hasOwn(KIND_ALIASES, kind) ? KIND_ALIASES[kind]! : kind;
}

function nonFood(
  type: PlaceType,
  osmRules: OsmRule[],
  fsqTopLevels: string[],
  fsqRules: FsqRule[],
  extra: Partial<PlaceTypeConfig> = {},
): PlaceTypeConfig {
  const cfg: PlaceTypeConfig = {
    type,
    overpassFilters: osmRules.map(filterOf),
    overpassOut: 'bb',
    osmKind: (tags) => matchRules(tags, osmRules)?.kind ?? null,
    fsqTopLevels,
    fsqKind: (label) => fsqMatch(label, fsqRules),
    keepOsm: (tags) => {
      const m = matchRules(tags, osmRules);
      return m !== null && notDisused(tags, m.key);
    },
    keepUnmatchedFsq: true,
    osmTagKeys: NON_FOOD_TAG_KEYS,
    genericNameWords: NON_FOOD_GENERIC_WORDS,
    dealsWebsiteScan: true,
    priceEstimates: false,
    ...extra,
  };
  // Applied after `extra` so every non-food type rejects routes and shares one kind vocabulary.
  const { osmKind, fsqKind, keepOsm } = cfg;
  return {
    ...cfg,
    osmKind: (tags) => {
      if (isOsmRoute(tags)) return null;
      const kind = osmKind(tags);
      return kind === null ? null : normalizeKind(kind);
    },
    fsqKind: (label) => {
      const kind = fsqKind(label);
      return kind === null ? null : normalizeKind(kind);
    },
    keepOsm: (tags, bounds) => !isOsmRoute(tags) && keepOsm(tags, bounds),
  };
}

const RESTAURANTS: PlaceTypeConfig = {
  type: 'restaurants',
  overpassFilters: [`["amenity"~"^(${OSM_AMENITIES.join('|')})$"]`],
  overpassOut: 'center',
  osmKind: (tags) => (tags.amenity !== undefined ? osmCategory(tags.amenity) : null),
  fsqTopLevels: ['Dining and Drinking'],
  fsqKind: (label) => fsqCategory(label),
  keepOsm: (tags) => !('disused:amenity' in tags) && !('was:amenity' in tags),
  keepUnmatchedFsq: true,
  osmTagKeys: OSM_TAG_KEYS,
  genericNameWords: new Set(),
  dealsWebsiteScan: true,
  priceEstimates: true,
};

const MUSEUMS = nonFood(
  'museums',
  [{ key: 'tourism', values: ['museum', 'gallery'] }],
  [AE],
  [{ path: [AE, 'Museum'], deeper: true }, { path: [AE, 'Art Gallery'] }, { path: [AE, 'Planetarium'] }],
);

const ENTERTAINMENT = nonFood(
  'entertainment',
  [
    { key: 'amenity', values: ['theatre', 'cinema', 'arts_centre', 'music_venue', 'events_venue', 'nightclub'] },
    { key: 'leisure', values: ['bowling_alley', 'amusement_arcade', 'escape_game', 'miniature_golf', 'trampoline_park', 'ice_rink', 'stadium'] },
    { key: 'tourism', values: ['zoo', 'aquarium', 'theme_park'] },
  ],
  [AE, SR],
  [
    { path: [AE, 'Amusement Park'], deeper: true },
    { path: [AE, 'Aquarium'] },
    { path: [AE, 'Arcade'] },
    { path: [AE, 'Bowling Alley'] },
    { path: [AE, 'Circus'] },
    { path: [AE, 'Comedy Club'] },
    { path: [AE, 'Country Dance Club'] },
    { path: [AE, 'Escape Room'] },
    { path: [AE, 'Gaming Cafe'] },
    { path: [AE, 'Laser Tag Center'] },
    { path: [AE, 'Mini Golf Course'] },
    { path: [AE, 'Movie Theater'], deeper: true },
    { path: [AE, 'Night Club'] },
    { path: [AE, 'Performing Arts Venue'], deeper: true },
    { path: [AE, 'Pool Hall'] },
    { path: [AE, 'Roller Rink'] },
    { path: [AE, 'Salsa Club'] },
    { path: [AE, 'Stadium'], deeper: true },
    { path: [AE, 'Water Park'] },
    { path: [AE, 'Zoo'] },
    { path: [SR, 'Skating', 'Skating Rink'] },
    { path: [SR, 'Gym and Studio', 'Climbing Gym'] },
    { path: [SR, 'Paintball Field'] },
    { path: [SR, 'Skating', 'Skate Park'] },
  ],
);

const PARK_RULES: OsmRule[] = [
  { key: 'leisure', values: ['park', 'garden', 'nature_reserve'] },
  { key: 'natural', values: ['beach'] },
];

const PARKS = nonFood(
  'parks',
  PARK_RULES,
  [LO],
  [
    { path: [LO, 'Park'] },
    { path: [LO, 'Park', 'National Park'] },
    { path: [LO, 'Park', 'Natural Park'] },
    { path: [LO, 'Park', 'State or Provincial Park'] },
    { path: [LO, 'Park', 'Urban Park'] },
    { path: [LO, 'Garden'] },
    { path: [LO, 'Botanical Garden'] },
    { path: [LO, 'Sculpture Garden'] },
    { path: [LO, 'Beach'] },
    { path: [LO, 'Nature Preserve'] },
    { path: [LO, 'Forest'] },
  ],
  {
    keepOsm: (tags, bounds) => {
      const m = matchRules(tags, PARK_RULES);
      if (m === null || !notDisused(tags, m.key)) return false;
      if (tags.access === 'private') return false;
      if (tags.wikidata || tags.wikipedia) return true;
      return bounds !== null && boundsAreaHa(bounds) >= MIN_PARK_HA;
    },
    keepUnmatchedFsq: false,
  },
);

function landmarkMatch(tags: Tags): { key: string; kind: string } | null {
  const t = matchRules(tags, [{ key: 'tourism', values: ['attraction', 'viewpoint'] }]);
  if (t) return t;
  // historic=yes says only "historic": name the kind historic_site, like Foursquare's Historic and Protected Site.
  if (tags.historic && tags.wikidata) return { key: 'historic', kind: tags.historic === 'yes' ? 'historic_site' : tags.historic };
  return null;
}

const LANDMARKS = nonFood(
  'landmarks',
  [],
  [LO],
  [
    'Historic and Protected Site', 'Monument', 'Memorial Site', 'Scenic Lookout', 'Bridge', 'Plaza', 'Pedestrian Plaza',
    'Lighthouse', 'Castle', 'Palace', 'Fountain',
  ].map((s) => ({ path: [LO, s] })),
  {
    overpassFilters: ['["tourism"~"^(attraction|viewpoint)$"]', '["historic"]["wikidata"]'],
    osmKind: (tags) => landmarkMatch(tags)?.kind ?? null,
    keepOsm: (tags) => {
      const m = landmarkMatch(tags);
      return m !== null && notDisused(tags, m.key);
    },
  },
);

export const PLACE_TYPE_CONFIG: Record<PlaceType, PlaceTypeConfig> = {
  restaurants: RESTAURANTS,
  museums: MUSEUMS,
  entertainment: ENTERTAINMENT,
  parks: PARKS,
  landmarks: LANDMARKS,
};

const TYPE_LIST = PLACE_TYPES.join(', ');

export function parseTypeOption(value: string | undefined): PlaceType {
  if (value === undefined) throw new Error(`missing --type (expected one of ${TYPE_LIST})`);
  if (!(PLACE_TYPES as readonly string[]).includes(value)) {
    throw new Error(`invalid --type '${value}' (expected one of ${TYPE_LIST})`);
  }
  return value as PlaceType;
}

export function classifyOsm(tags: Tags): { type: PlaceType; kind: string } | null {
  for (const type of PLACE_TYPES) {
    const kind = PLACE_TYPE_CONFIG[type].osmKind(tags);
    if (kind !== null) return { type, kind };
  }
  return null;
}

export function classifyFsq(primaryLabel: string): { type: PlaceType; kind: string } | null {
  for (const type of PLACE_TYPES) {
    const kind = PLACE_TYPE_CONFIG[type].fsqKind(primaryLabel);
    if (kind !== null) return { type, kind };
  }
  return null;
}
