/**
 * Practical filtering and ranking over the map's existing OSM places.
 *
 * Every preference is evaluated per place as one of:
 *   match       the data positively satisfies it
 *   mismatch    the data positively contradicts it → the place is excluded
 *   unknown     the data needed isn't there → kept, ranked below matches
 *   not_applied the preference can't be checked with today's data at all
 *   unset       the user hasn't chosen anything
 *
 * Nothing is guessed: a place with no cuisine tag is "cuisine unknown", never
 * a match; no price data exists, so budget never excludes anything.
 *
 * Vibe text is intentionally not read here. Aesthetic ranking belongs to the
 * future Vibe Engine and must stay separate from these hard constraints.
 */
import type { Place } from '../osm';
import {
  activeSubtypes,
  type ActivityTypeId,
  type CuisineId,
  type GeoPoint,
  type InitialPreferences,
} from './preferences';

export type FilterStatus = 'match' | 'mismatch' | 'unknown' | 'not_applied' | 'unset';

export interface PlaceEvaluation {
  activity: FilterStatus;
  subtype: FilterStatus;
  budget: FilterStatus;
  timing: FilterStatus;
}

export interface RankedPlace {
  place: Place;
  evaluation: PlaceEvaluation;
  /** Straight-line ("as the crow flies") distance from the origin, not travel time. */
  straightLineMeters?: number;
  /** Human-readable notes on why the place is included, excluded or uncertain. */
  notes: string[];
}

export interface RankResult {
  included: RankedPlace[];
  excluded: RankedPlace[];
}

// ---------------------------------------------------------------------------
// OSM tag vocabulary
// ---------------------------------------------------------------------------

type TagRule = Record<string, readonly string[] | '*'>;

const FOOD_DRINK_TAGS: TagRule = {
  amenity: ['restaurant', 'cafe', 'fast_food', 'bar', 'pub', 'food_court', 'ice_cream', 'biergarten'],
  shop: ['bakery', 'coffee', 'deli', 'pastry', 'confectionery'],
};

const ACTIVITY_TYPE_TAGS: Record<Exclude<ActivityTypeId, 'student_events'>, TagRule> = {
  live_music: { amenity: ['music_venue', 'concert_hall'] },
  museums_galleries: { tourism: ['museum', 'gallery'], amenity: ['arts_centre'] },
  outdoors_parks: {
    leisure: ['park', 'garden', 'nature_reserve', 'dog_park', 'beach_resort'],
    natural: ['beach'],
    tourism: ['picnic_site'],
  },
  sightseeing: { tourism: ['attraction', 'viewpoint', 'artwork'], historic: '*' },
  sports_recreation: {
    leisure: ['sports_centre', 'stadium', 'pitch', 'fitness_centre', 'ice_rink', 'swimming_pool', 'track', 'golf_course'],
  },
  games_entertainment: {
    leisure: ['bowling_alley', 'amusement_arcade', 'escape_game', 'miniature_golf'],
    amenity: ['cinema', 'theatre', 'casino'],
    tourism: ['theme_park', 'zoo', 'aquarium'],
  },
  nightlife: { amenity: ['nightclub', 'bar', 'pub'], leisure: ['dance'] },
  shopping: { shop: '*', amenity: ['marketplace'] },
};

/** OSM `cuisine` values (lowercase, `;`-separated in the tag) mapped to our cuisine choices. */
const CUISINE_SYNONYMS: Record<Exclude<CuisineId, 'other'>, readonly string[]> = {
  italian: ['italian', 'pizza', 'pasta', 'italian_pizza'],
  japanese: ['japanese', 'sushi', 'ramen', 'izakaya', 'udon', 'teriyaki'],
  chinese: ['chinese', 'dim_sum', 'cantonese', 'sichuan', 'szechuan', 'dumpling', 'hot_pot', 'taiwanese', 'shanghainese'],
  korean: ['korean'],
  mexican: ['mexican', 'tex-mex', 'tacos', 'taco', 'burrito'],
  indian: ['indian', 'north_indian', 'south_indian', 'punjabi'],
  thai: ['thai'],
  mediterranean: ['mediterranean', 'greek', 'spanish', 'tapas'],
  american: ['american', 'burger', 'diner', 'barbecue', 'bbq', 'steak_house', 'hot_dog', 'sandwich', 'southern'],
  vietnamese: ['vietnamese', 'pho', 'banh_mi'],
  middle_eastern: ['middle_eastern', 'lebanese', 'turkish', 'persian', 'falafel', 'kebab', 'israeli', 'arab', 'shawarma'],
};

const CUISINE_LOOKUP = new Map<string, CuisineId>(
  Object.entries(CUISINE_SYNONYMS).flatMap(([id, values]) => values.map((v) => [v, id as CuisineId] as const)),
);

/**
 * Facts about what kind of place this is. Overpass places carry real OSM tags.
 * Tile and search places carry none, only a humanised OSM value in `category`
 * ("Restaurant", "Cafe"); we keep that bare value, whose key is unknown.
 */
interface KindHints {
  tags: Record<string, string>;
  /** OSM value recovered from `category` when there are no tags. */
  bareValue?: string;
}

const KIND_KEYS = ['amenity', 'tourism', 'leisure', 'shop', 'historic', 'natural'];

function kindHints(place: Place): KindHints {
  if (Object.keys(place.tags).some((k) => KIND_KEYS.includes(k))) return { tags: place.tags };
  return { tags: {}, bareValue: place.category.trim().toLowerCase().replace(/\s+/g, '_') };
}

function matchesRule(hints: KindHints, rule: TagRule): boolean {
  return Object.entries(rule).some(([key, values]) => {
    // A bare value matches listed values under any key, but never a wildcard:
    // without the key we can't tell e.g. a `shop` from an `amenity`.
    if (hints.bareValue !== undefined) return values !== '*' && values.includes(hints.bareValue);
    const v = hints.tags[key];
    return v !== undefined && (values === '*' || values.includes(v));
  });
}

const isFoodOrDrink = (hints: KindHints) => matchesRule(hints, FOOD_DRINK_TAGS);
const isActivity = (hints: KindHints) => Object.values(ACTIVITY_TYPE_TAGS).some((rule) => matchesRule(hints, rule));

/** Our cuisine ids for a place's OSM `cuisine` tag; "other" for tagged cuisines we don't list. */
export function cuisinesOf(tags: Record<string, string>): CuisineId[] | null {
  const raw = tags.cuisine;
  if (!raw) return null;
  const ids = new Set<CuisineId>();
  for (const token of raw.split(';')) {
    const value = token.trim().toLowerCase().replace(/\s+/g, '_');
    if (!value) continue;
    ids.add(CUISINE_LOOKUP.get(value) ?? 'other');
  }
  return ids.size ? [...ids] : null;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export function evaluatePlace(place: Place, prefs: InitialPreferences): RankedPlace {
  const notes: string[] = [];
  const hints = kindHints(place);
  const subtypes = activeSubtypes(prefs);

  // Activity
  let activity: FilterStatus = 'unset';
  if (prefs.activity === 'anything') activity = 'match';
  else if (prefs.activity) {
    const food = isFoodOrDrink(hints);
    const act = isActivity(hints);
    if (!food && !act) {
      activity = 'unknown';
      notes.push("Type of place isn't known");
    } else {
      activity = (prefs.activity === 'food_drinks' ? food : act) ? 'match' : 'mismatch';
      if (activity === 'match' && hints.bareValue !== undefined) notes.push('Type taken from the map label only');
    }
  }

  // Cuisine / activity type
  let subtype: FilterStatus = 'unset';
  if (prefs.activity === 'food_drinks' && subtypes.length > 0 && activity !== 'mismatch') {
    const cuisines = cuisinesOf(place.tags);
    if (!cuisines) {
      subtype = 'unknown';
      notes.push('Cuisine unknown');
    } else {
      subtype = cuisines.some((c) => (subtypes as CuisineId[]).includes(c)) ? 'match' : 'mismatch';
    }
  } else if (prefs.activity === 'activities' && subtypes.length > 0 && activity !== 'mismatch') {
    const checkable = (subtypes as ActivityTypeId[]).filter(
      (t): t is Exclude<ActivityTypeId, 'student_events'> => t !== 'student_events',
    );
    if (checkable.length === 0) {
      subtype = 'not_applied';
      notes.push('Student events have no data source yet');
    } else if (activity === 'unknown') {
      subtype = 'unknown';
    } else {
      subtype = checkable.some((t) => matchesRule(hints, ACTIVITY_TYPE_TAGS[t])) ? 'match' : 'mismatch';
    }
  }

  // Budget: OSM has no reliable price data and transit fares aren't integrated.
  const budget: FilterStatus =
    prefs.budget === null ? 'unset' : prefs.budget.maxCentsPerPerson === null ? 'match' : 'unknown';
  if (budget === 'unknown') notes.push('Price unknown');

  // Timing: opening_hours isn't parsed in v1.
  const timing: FilterStatus = prefs.timing === null ? 'unset' : 'not_applied';

  let straightLineMeters: number | undefined;
  if (prefs.origin) straightLineMeters = straightLineDistance(prefs.origin.location, { lat: place.lat, lng: place.lon });

  return { place, evaluation: { activity, subtype, budget, timing }, straightLineMeters, notes };
}

const isExcluded = (e: PlaceEvaluation) => Object.values(e).includes('mismatch');
const unknownCount = (e: PlaceEvaluation) => Object.values(e).filter((s) => s === 'unknown').length;

/**
 * Drop places that contradict a preference; order the rest by certainty
 * (fewest unknowns first), then straight-line distance from the origin, then
 * their original order (a stable sort).
 */
export function rankPlaces(places: readonly Place[], prefs: InitialPreferences): RankResult {
  const evaluated = places.map((place, index) => ({ ...evaluatePlace(place, prefs), index }));
  const included = evaluated
    .filter((r) => !isExcluded(r.evaluation))
    .sort(
      (a, b) =>
        unknownCount(a.evaluation) - unknownCount(b.evaluation) ||
        (a.straightLineMeters ?? 0) - (b.straightLineMeters ?? 0) ||
        a.index - b.index,
    );
  const excluded = evaluated.filter((r) => isExcluded(r.evaluation));
  const strip = ({ index: _index, ...rest }: RankedPlace & { index: number }): RankedPlace => rest;
  return { included: included.map(strip), excluded: excluded.map(strip) };
}

/** Haversine distance in meters between two `{lat, lng}` points. */
export function straightLineDistance(a: GeoPoint, b: GeoPoint): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ---------------------------------------------------------------------------
// Panel qualifications
// ---------------------------------------------------------------------------

/** What the panel should say about preferences that can't (fully) be applied yet. */
export function qualificationsFor(prefs: InitialPreferences): string[] {
  const notes: string[] = [];
  if (prefs.activity === 'food_drinks' && prefs.cuisines.length > 0) {
    notes.push("Cuisine comes from OpenStreetMap tags; places with no cuisine listed are kept and marked unknown.");
  }
  if (prefs.activity === 'activities' && prefs.activityTypes.includes('student_events')) {
    notes.push('Student events: no event source is connected yet, so this choice is saved but not applied.');
  }
  if (prefs.origin) {
    notes.push('Starting point is used for straight-line distance only, not MBTA travel time.');
  }
  if (prefs.budget && prefs.budget.maxCentsPerPerson !== null) {
    notes.push("Budget saved. Venue prices and transit fares aren't available yet, so nothing is filtered by cost.");
  }
  if (prefs.timing) {
    notes.push("Timing saved. Opening hours aren't checked yet.");
  }
  if (prefs.vibeText.trim()) {
    notes.push('Vibe saved for later. Vibe matching is not active yet.');
  }
  return notes;
}
