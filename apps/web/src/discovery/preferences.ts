/**
 * Initial-preferences state for the discovery panel.
 *
 * The UI never edits this state directly: every change goes through
 * `preferencesReducer`, which also enforces the invariants (e.g. switching the
 * activity clears secondary selections so hidden filters can't linger).
 *
 * These are *practical* constraints only. The optional vibe text is stored
 * verbatim for the future Vibe Engine and is deliberately ignored by filtering.
 */
import { supportedVibeImage, MAX_VIBE_IMAGES } from './vibeImages';
import {
  addDays,
  bostonWallTime,
  bostonWallTimeToInstant,
  BOSTON_TIME_ZONE,
  parseDateTimeInputs,
  toBostonIso,
  type WallTime,
} from './bostonTime';

/**
 * WGS84 point, `{lat, lng}` as in docs/CONTRACTS.md. Duplicated here only
 * because no executable shared-contracts module exists yet; replace with an
 * import once `src/shared/contracts` lands.
 */
export type GeoPoint = { lat: number; lng: number };

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface Option<Id extends string> {
  id: Id;
  label: string;
}

export const ACTIVITY_OPTIONS = [
  { id: 'food_drinks', label: 'Food & drinks' },
  { id: 'activities', label: 'Activities & entertainment' },
  { id: 'anything', label: 'Open to anything' },
] as const satisfies readonly Option<string>[];
export type ActivityId = (typeof ACTIVITY_OPTIONS)[number]['id'];

export const CUISINE_OPTIONS = [
  { id: 'italian', label: 'Italian' },
  { id: 'japanese', label: 'Japanese' },
  { id: 'chinese', label: 'Chinese' },
  { id: 'korean', label: 'Korean' },
  { id: 'mexican', label: 'Mexican' },
  { id: 'indian', label: 'Indian' },
  { id: 'thai', label: 'Thai' },
  { id: 'mediterranean', label: 'Mediterranean' },
  { id: 'american', label: 'American' },
  { id: 'vietnamese', label: 'Vietnamese' },
  { id: 'middle_eastern', label: 'Middle Eastern' },
  { id: 'other', label: 'Other' },
] as const satisfies readonly Option<string>[];
export type CuisineId = (typeof CUISINE_OPTIONS)[number]['id'];

export const ACTIVITY_TYPE_OPTIONS = [
  { id: 'live_music', label: 'Live music' },
  { id: 'museums_galleries', label: 'Museums & galleries' },
  { id: 'outdoors_parks', label: 'Outdoors & parks' },
  { id: 'sightseeing', label: 'Sightseeing' },
  { id: 'sports_recreation', label: 'Sports & recreation' },
  { id: 'games_entertainment', label: 'Games & entertainment' },
  { id: 'nightlife', label: 'Nightlife' },
  { id: 'shopping', label: 'Shopping' },
  { id: 'student_events', label: 'Student events' },
] as const satisfies readonly Option<string>[];
export type ActivityTypeId = (typeof ACTIVITY_TYPE_OPTIONS)[number]['id'];

/** Budget choices. `maxCentsPerPerson: null` means no limit. Money is USD cents (docs/CONTRACTS.md). */
export const BUDGET_OPTIONS = [
  { id: 'under_15', label: 'Under $15', maxCentsPerPerson: 1500 },
  { id: 'under_25', label: 'Under $25', maxCentsPerPerson: 2500 },
  { id: 'under_40', label: 'Under $40', maxCentsPerPerson: 4000 },
  { id: 'under_60', label: 'Under $60', maxCentsPerPerson: 6000 },
  { id: 'no_limit', label: 'No limit', maxCentsPerPerson: null },
] as const satisfies readonly (Option<string> & { maxCentsPerPerson: number | null })[];
export type BudgetId = (typeof BUDGET_OPTIONS)[number]['id'];

export const TIMING_OPTIONS = [
  { id: 'now', label: 'Right now' },
  { id: 'tonight', label: 'Tonight' },
  { id: 'tomorrow', label: 'Tomorrow' },
  { id: 'custom', label: 'Pick date/time' },
] as const satisfies readonly Option<string>[];
export type TimingKind = (typeof TIMING_OPTIONS)[number]['id'];

export const VIBE_TEXT_MAX_LENGTH = 500;

/** Hours that define "Tonight" on a Boston clock: 7 PM until 3 AM next day. */
export const TONIGHT_START_HOUR = 19;
export const TONIGHT_END_HOUR = 3;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type OriginSource = 'local_suggestion' | 'device_geolocation' | 'live_geocoder';

export interface Origin {
  label: string;
  /** Extra context shown under the label, e.g. "MBTA Red Line". */
  secondaryLabel?: string;
  location: GeoPoint;
  source: OriginSource;
  /** Identifier in the source dataset, e.g. "mbta:place-pktrm" or "osm:way/123". */
  sourceRef?: string;
  /** Reported accuracy radius for device locations. */
  accuracyMeters?: number;
}

export interface Budget {
  choice: BudgetId;
  /** Maximum estimated outing cost per person in USD cents; null = no limit. */
  maxCentsPerPerson: number | null;
}

export interface Timing {
  kind: TimingKind;
  /** Start of the requested window, ISO 8601 with Boston offset. */
  start: string;
  /** End of the window (exclusive) when the choice is a range. */
  end?: string;
  timeZone: typeof BOSTON_TIME_ZONE;
  /** When this choice was resolved; lets consumers refresh "Right now". */
  resolvedAt: string;
}

/** Raw inputs for "Pick date/time", kept so partially filled inputs survive re-renders. */
export interface CustomTimingDraft {
  date: string;
  time: string;
}

export interface InitialPreferences {
  activity: ActivityId | null;
  /** Only ever non-empty when `activity === 'food_drinks'`. */
  cuisines: CuisineId[];
  /** Only ever non-empty when `activity === 'activities'`. */
  activityTypes: ActivityTypeId[];
  origin: Origin | null;
  budget: Budget | null;
  /** Null until a timing is chosen, or while a custom date/time is incomplete or invalid. */
  timing: Timing | null;
  timingChoice: TimingKind | null;
  customTiming: CustomTimingDraft;
  /** Why the custom date/time can't be used, if it can't. */
  timingError: TimingError | null;
  /** Free text for the future Vibe Engine. Never used by practical filtering. */
  vibeText: string;
  /** Browser-memory-only references; files are never sent to a server by this panel. */
  vibeImages: File[];
}

export type TimingError = 'incomplete' | 'invalid' | 'past';

export const initialPreferences = (): InitialPreferences => ({
  activity: null,
  cuisines: [],
  activityTypes: [],
  origin: null,
  budget: null,
  timing: null,
  timingChoice: null,
  customTiming: { date: '', time: '' },
  timingError: null,
  vibeText: '',
  vibeImages: [],
});

// ---------------------------------------------------------------------------
// Actions and reducer
// ---------------------------------------------------------------------------

export type PreferencesAction =
  | { type: 'setActivity'; activity: ActivityId }
  | { type: 'toggleSubtype'; id: CuisineId | ActivityTypeId }
  | { type: 'clearSubtypes' }
  | { type: 'setOrigin'; origin: Origin }
  | { type: 'clearOrigin' }
  | { type: 'setBudget'; choice: BudgetId }
  | { type: 'setTiming'; kind: TimingKind; now: Date }
  | { type: 'setCustomTiming'; date: string; time: string; now: Date }
  | { type: 'setVibeText'; text: string }
  | { type: 'setVibeImages'; files: File[] }
  | { type: 'reset' };

const CUISINE_IDS = new Set<string>(CUISINE_OPTIONS.map((o) => o.id));
const ACTIVITY_TYPE_IDS = new Set<string>(ACTIVITY_TYPE_OPTIONS.map((o) => o.id));

export function preferencesReducer(state: InitialPreferences, action: PreferencesAction): InitialPreferences {
  switch (action.type) {
    case 'setActivity':
      if (state.activity === action.activity) return state;
      // A new activity always starts with no secondary selections, so choices
      // made under a now-hidden field can never filter results.
      return { ...state, activity: action.activity, cuisines: [], activityTypes: [] };

    case 'toggleSubtype': {
      if (state.activity === 'food_drinks' && CUISINE_IDS.has(action.id)) {
        return { ...state, cuisines: toggleInOrder(state.cuisines, action.id as CuisineId, CUISINE_OPTIONS) };
      }
      if (state.activity === 'activities' && ACTIVITY_TYPE_IDS.has(action.id)) {
        return {
          ...state,
          activityTypes: toggleInOrder(state.activityTypes, action.id as ActivityTypeId, ACTIVITY_TYPE_OPTIONS),
        };
      }
      return state; // The field for this subtype isn't showing; ignore.
    }

    case 'clearSubtypes':
      return { ...state, cuisines: [], activityTypes: [] };

    case 'setOrigin':
      return isValidGeoPoint(action.origin.location) ? { ...state, origin: action.origin } : state;

    case 'clearOrigin':
      return { ...state, origin: null };

    case 'setBudget': {
      const option = BUDGET_OPTIONS.find((o) => o.id === action.choice);
      return option ? { ...state, budget: { choice: option.id, maxCentsPerPerson: option.maxCentsPerPerson } } : state;
    }

    case 'setTiming': {
      if (action.kind === 'custom') {
        const custom = resolveCustomTiming(state.customTiming, action.now);
        return { ...state, timingChoice: 'custom', timing: custom.timing, timingError: custom.error };
      }
      return { ...state, timingChoice: action.kind, timing: resolveTiming(action.kind, action.now), timingError: null };
    }

    case 'setCustomTiming': {
      const draft = { date: action.date, time: action.time };
      const custom = resolveCustomTiming(draft, action.now);
      return { ...state, timingChoice: 'custom', customTiming: draft, timing: custom.timing, timingError: custom.error };
    }

    case 'setVibeText':
      return { ...state, vibeText: action.text.slice(0, VIBE_TEXT_MAX_LENGTH) };

    case 'setVibeImages':
      // Files stay in memory; reject unsupported or oversized inputs at the state boundary too.
      return { ...state, vibeImages: action.files.filter(supportedVibeImage).slice(0, MAX_VIBE_IMAGES) };

    case 'reset':
      return initialPreferences();
  }
}

/** Toggle `id`, keeping selections in the option list's order for stable summaries. */
function toggleInOrder<Id extends string>(selected: Id[], id: Id, options: readonly Option<Id>[]): Id[] {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return options.map((o) => o.id).filter((o) => next.has(o));
}

export function isValidGeoPoint(p: GeoPoint | null | undefined): p is GeoPoint {
  return (
    !!p &&
    typeof p.lat === 'number' &&
    typeof p.lng === 'number' &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lng) <= 180
  );
}

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

/**
 * Resolve a preset timing choice against `now`, in Boston time.
 * - now: the moment of selection.
 * - tonight: 7 PM → 3 AM. Already evening? It starts now. Between midnight and
 *   3 AM it means the rest of the current night.
 * - tomorrow: all of the next Boston calendar day.
 */
export function resolveTiming(kind: Exclude<TimingKind, 'custom'>, now: Date): Timing {
  const base = { kind, timeZone: BOSTON_TIME_ZONE, resolvedAt: toBostonIso(now) } as const;
  const today = bostonWallTime(now);
  const at = (day: WallTime, hour: number) => bostonWallTimeToInstant({ ...day, hour, minute: 0 });

  switch (kind) {
    case 'now':
      return { ...base, start: toBostonIso(now) };
    case 'tonight': {
      if (today.hour < TONIGHT_END_HOUR) {
        return { ...base, start: toBostonIso(now), end: toBostonIso(at(today, TONIGHT_END_HOUR)) };
      }
      const evening = at(today, TONIGHT_START_HOUR);
      const start = now.getTime() > evening.getTime() ? now : evening;
      return { ...base, start: toBostonIso(start), end: toBostonIso(at(addDays(today, 1), TONIGHT_END_HOUR)) };
    }
    case 'tomorrow': {
      const tomorrow = addDays(today, 1);
      return { ...base, start: toBostonIso(at(tomorrow, 0)), end: toBostonIso(at(addDays(tomorrow, 1), 0)) };
    }
  }
}

/** Validate "Pick date/time" inputs, read as Boston wall-clock time. */
export function resolveCustomTiming(
  draft: CustomTimingDraft,
  now: Date,
): { timing: Timing | null; error: TimingError | null } {
  if (!draft.date || !draft.time) return { timing: null, error: 'incomplete' };
  const wall = parseDateTimeInputs(draft.date, draft.time);
  if (!wall) return { timing: null, error: 'invalid' };
  const instant = bostonWallTimeToInstant(wall);
  // Allow the current minute so "now-ish" custom times aren't rejected.
  if (instant.getTime() < Math.floor(now.getTime() / 60_000) * 60_000) return { timing: null, error: 'past' };
  return {
    timing: { kind: 'custom', start: toBostonIso(instant), timeZone: BOSTON_TIME_ZONE, resolvedAt: toBostonIso(now) },
    error: null,
  };
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export type SecondaryField = 'cuisines' | 'activityTypes' | null;

/** Which secondary multi-select is visible for the current activity, if any. */
export function secondaryFieldFor(activity: ActivityId | null): SecondaryField {
  if (activity === 'food_drinks') return 'cuisines';
  if (activity === 'activities') return 'activityTypes';
  return null;
}

/** The secondary selections that actually apply (always [] when no field is showing). */
export function activeSubtypes(state: InitialPreferences): (CuisineId | ActivityTypeId)[] {
  const field = secondaryFieldFor(state.activity);
  if (field === 'cuisines') return state.cuisines;
  if (field === 'activityTypes') return state.activityTypes;
  return [];
}

export function labelFor<Id extends string>(options: readonly Option<Id>[], id: Id | null | undefined): string | undefined {
  return options.find((o) => o.id === id)?.label;
}

/** Short summary of a multi-select: "Japanese, Thai +1". */
export function summarizeSelection<Id extends string>(
  options: readonly Option<Id>[],
  selected: readonly Id[],
  maxShown = 2,
): string {
  const labels = options.filter((o) => selected.includes(o.id)).map((o) => o.label);
  if (labels.length <= maxShown) return labels.join(', ');
  return `${labels.slice(0, maxShown).join(', ')} +${labels.length - maxShown}`;
}

/** One-line summary of the whole state for the collapsed panel. */
export function summarizePreferences(state: InitialPreferences): string[] {
  const parts: string[] = [];
  const activity = labelFor(ACTIVITY_OPTIONS, state.activity);
  if (activity) {
    const sub =
      state.activity === 'food_drinks'
        ? summarizeSelection(CUISINE_OPTIONS, state.cuisines, 1)
        : state.activity === 'activities'
          ? summarizeSelection(ACTIVITY_TYPE_OPTIONS, state.activityTypes, 1)
          : '';
    parts.push(sub ? `${activity}: ${sub}` : activity);
  }
  if (state.origin) parts.push(`From ${state.origin.label}`);
  const budget = labelFor(BUDGET_OPTIONS, state.budget?.choice);
  if (budget) parts.push(budget);
  if (state.timingChoice && (state.timing || state.timingChoice !== 'custom')) {
    parts.push(labelFor(TIMING_OPTIONS, state.timingChoice)!);
  }
  return parts;
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/**
 * Coerce untrusted input (e.g. restored from storage or a URL) into a valid
 * state: unknown ids are dropped, subtypes only survive under their activity,
 * budget is re-derived from its choice, and bad coordinates are discarded.
 */
export function normalizePreferences(input: unknown, now: Date = new Date()): InitialPreferences {
  const base = initialPreferences();
  if (!input || typeof input !== 'object') return base;
  const raw = input as Partial<Record<keyof InitialPreferences, unknown>>;

  const activity = ACTIVITY_OPTIONS.some((o) => o.id === raw.activity) ? (raw.activity as ActivityId) : null;
  const pick = <Id extends string>(value: unknown, options: readonly Option<Id>[]): Id[] => {
    const ids = new Set(Array.isArray(value) ? value : []);
    return options.map((o) => o.id).filter((id) => ids.has(id));
  };

  let state: InitialPreferences = {
    ...base,
    activity,
    cuisines: activity === 'food_drinks' ? pick(raw.cuisines, CUISINE_OPTIONS) : [],
    activityTypes: activity === 'activities' ? pick(raw.activityTypes, ACTIVITY_TYPE_OPTIONS) : [],
    vibeText: typeof raw.vibeText === 'string' ? raw.vibeText.slice(0, VIBE_TEXT_MAX_LENGTH) : '',
    // Restored JSON cannot contain usable File objects. Require a new local selection.
    vibeImages: [],
  };

  const budget = raw.budget as Partial<Budget> | null | undefined;
  if (budget && typeof budget === 'object' && typeof budget.choice === 'string') {
    state = preferencesReducer(state, { type: 'setBudget', choice: budget.choice as BudgetId });
  }

  const origin = raw.origin as Partial<Origin> | null | undefined;
  if (origin && typeof origin === 'object' && typeof origin.label === 'string' && isValidGeoPoint(origin.location)) {
    const source: OriginSource =
      origin.source === 'device_geolocation' || origin.source === 'live_geocoder' ? origin.source : 'local_suggestion';
    state = {
      ...state,
      origin: {
        label: origin.label,
        location: { lat: origin.location.lat, lng: origin.location.lng },
        source,
        ...(typeof origin.secondaryLabel === 'string' ? { secondaryLabel: origin.secondaryLabel } : {}),
        ...(typeof origin.sourceRef === 'string' ? { sourceRef: origin.sourceRef } : {}),
        ...(typeof origin.accuracyMeters === 'number' && origin.accuracyMeters >= 0
          ? { accuracyMeters: origin.accuracyMeters }
          : {}),
      },
    };
  }

  // Timing is re-resolved rather than trusted, so stale "tonight" windows refresh.
  const choice = TIMING_OPTIONS.some((o) => o.id === raw.timingChoice) ? (raw.timingChoice as TimingKind) : null;
  if (choice === 'custom') {
    const draft = raw.customTiming as Partial<CustomTimingDraft> | undefined;
    state = preferencesReducer(state, {
      type: 'setCustomTiming',
      date: typeof draft?.date === 'string' ? draft.date : '',
      time: typeof draft?.time === 'string' ? draft.time : '',
      now,
    });
  } else if (choice) {
    state = preferencesReducer(state, { type: 'setTiming', kind: choice, now });
  }
  return state;
}
