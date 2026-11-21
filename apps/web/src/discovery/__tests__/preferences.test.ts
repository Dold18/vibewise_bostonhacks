import { describe, expect, it } from 'vitest';
import {
  activeSubtypes,
  initialPreferences,
  normalizePreferences,
  preferencesReducer,
  secondaryFieldFor,
  summarizePreferences,
  summarizeSelection,
  CUISINE_OPTIONS,
  VIBE_TEXT_MAX_LENGTH,
  type InitialPreferences,
  type PreferencesAction,
} from '../preferences';

const NOW = new Date('2026-11-21T17:00:00Z'); // 12:00 PM EST
const run = (...actions: PreferencesAction[]): InitialPreferences =>
  actions.reduce(preferencesReducer, initialPreferences());

describe('initial state', () => {
  it('starts with nothing chosen and no secondary field', () => {
    const s = initialPreferences();
    expect(s).toMatchObject({ activity: null, cuisines: [], activityTypes: [], origin: null, budget: null, timing: null, vibeText: '' });
    expect(secondaryFieldFor(s.activity)).toBeNull();
  });
});

describe('conditional secondary field', () => {
  it('shows no secondary field before an activity is chosen', () => {
    expect(secondaryFieldFor(null)).toBeNull();
  });

  it('shows cuisines for Food & drinks and activity types for Activities', () => {
    expect(secondaryFieldFor('food_drinks')).toBe('cuisines');
    expect(secondaryFieldFor('activities')).toBe('activityTypes');
  });

  it('hides the secondary field for Open to anything', () => {
    expect(secondaryFieldFor('anything')).toBeNull();
  });

  it('ignores subtype toggles while no matching field is visible', () => {
    expect(run({ type: 'toggleSubtype', id: 'japanese' }).cuisines).toEqual([]);
    const anything = run({ type: 'setActivity', activity: 'anything' }, { type: 'toggleSubtype', id: 'japanese' });
    expect(anything.cuisines).toEqual([]);
    // A cuisine id can't sneak into the activity-type list, or vice versa.
    const acts = run({ type: 'setActivity', activity: 'activities' }, { type: 'toggleSubtype', id: 'japanese' });
    expect(acts.activityTypes).toEqual([]);
    expect(acts.cuisines).toEqual([]);
  });
});

describe('multi-select checkboxes', () => {
  const food = (...ids: Parameters<typeof toggle>[0][]) =>
    run({ type: 'setActivity', activity: 'food_drinks' }, ...ids.map(toggle));
  function toggle(id: (typeof CUISINE_OPTIONS)[number]['id']): PreferencesAction {
    return { type: 'toggleSubtype', id };
  }

  it('selects several options and keeps them in list order', () => {
    expect(food('thai', 'japanese', 'italian').cuisines).toEqual(['italian', 'japanese', 'thai']);
  });

  it('unticks an option when toggled again', () => {
    expect(food('thai', 'japanese', 'thai').cuisines).toEqual(['japanese']);
  });

  it('"Clear selections" empties the list but keeps the activity', () => {
    const s = preferencesReducer(food('thai', 'korean'), { type: 'clearSubtypes' });
    expect(s.cuisines).toEqual([]);
    expect(s.activity).toBe('food_drinks');
  });

  it('keeps selections when other fields change (e.g. the popup closes and reopens)', () => {
    const s = [
      { type: 'setBudget', choice: 'under_25' },
      { type: 'setVibeText', text: 'cozy' },
      { type: 'setTiming', kind: 'now', now: NOW },
    ].reduce((acc, a) => preferencesReducer(acc, a as PreferencesAction), food('mexican', 'other'));
    expect(s.cuisines).toEqual(['mexican', 'other']);
  });

  it('handles activity types the same way', () => {
    const s = run(
      { type: 'setActivity', activity: 'activities' },
      { type: 'toggleSubtype', id: 'nightlife' },
      { type: 'toggleSubtype', id: 'live_music' },
    );
    expect(s.activityTypes).toEqual(['live_music', 'nightlife']);
  });

  it('summarises selections for the collapsed field', () => {
    expect(summarizeSelection(CUISINE_OPTIONS, [])).toBe('');
    expect(summarizeSelection(CUISINE_OPTIONS, ['thai'])).toBe('Thai');
    expect(summarizeSelection(CUISINE_OPTIONS, ['thai', 'japanese'])).toBe('Japanese, Thai');
    expect(summarizeSelection(CUISINE_OPTIONS, ['thai', 'japanese', 'italian'])).toBe('Italian, Japanese +1');
  });
});

describe('clearing stale selections', () => {
  it('changing the activity clears secondary selections', () => {
    const s = run(
      { type: 'setActivity', activity: 'food_drinks' },
      { type: 'toggleSubtype', id: 'japanese' },
      { type: 'setActivity', activity: 'activities' },
    );
    expect(s.cuisines).toEqual([]);
    expect(s.activityTypes).toEqual([]);
  });

  it('switching back does not resurrect old selections', () => {
    const s = run(
      { type: 'setActivity', activity: 'food_drinks' },
      { type: 'toggleSubtype', id: 'japanese' },
      { type: 'setActivity', activity: 'anything' },
      { type: 'setActivity', activity: 'food_drinks' },
    );
    expect(s.cuisines).toEqual([]);
    expect(activeSubtypes(s)).toEqual([]);
  });

  it('re-selecting the same activity keeps selections', () => {
    const s = run(
      { type: 'setActivity', activity: 'food_drinks' },
      { type: 'toggleSubtype', id: 'korean' },
      { type: 'setActivity', activity: 'food_drinks' },
    );
    expect(s.cuisines).toEqual(['korean']);
  });
});

describe('budget', () => {
  it('stores the maximum in USD cents per person', () => {
    expect(run({ type: 'setBudget', choice: 'under_15' }).budget).toEqual({ choice: 'under_15', maxCentsPerPerson: 1500 });
    expect(run({ type: 'setBudget', choice: 'under_60' }).budget?.maxCentsPerPerson).toBe(6000);
  });

  it('represents "No limit" as null, distinct from "not chosen"', () => {
    expect(run({ type: 'setBudget', choice: 'no_limit' }).budget).toEqual({ choice: 'no_limit', maxCentsPerPerson: null });
    expect(initialPreferences().budget).toBeNull();
  });
});

describe('origin', () => {
  const origin = { label: 'Park Street station', location: { lat: 42.35639, lng: -71.0624 }, source: 'local_suggestion' as const };

  it('stores label and coordinates', () => {
    expect(run({ type: 'setOrigin', origin }).origin).toEqual(origin);
  });

  it('rejects out-of-range or non-numeric coordinates', () => {
    expect(run({ type: 'setOrigin', origin: { ...origin, location: { lat: 95, lng: 0 } } }).origin).toBeNull();
    expect(run({ type: 'setOrigin', origin: { ...origin, location: { lat: NaN, lng: -71 } } }).origin).toBeNull();
  });

  it('can be cleared', () => {
    expect(run({ type: 'setOrigin', origin }, { type: 'clearOrigin' }).origin).toBeNull();
  });
});

describe('vibe text', () => {
  it('is stored verbatim up to the maximum length', () => {
    expect(run({ type: 'setVibeText', text: 'rainy-day cafe' }).vibeText).toBe('rainy-day cafe');
    expect(run({ type: 'setVibeText', text: 'x'.repeat(900) }).vibeText).toHaveLength(VIBE_TEXT_MAX_LENGTH);
  });
});

describe('reset and summary', () => {
  it('reset returns to the initial state', () => {
    const s = run({ type: 'setActivity', activity: 'anything' }, { type: 'setBudget', choice: 'under_25' }, { type: 'reset' });
    expect(s).toEqual(initialPreferences());
  });

  it('summarises chosen preferences for the collapsed panel', () => {
    const s = run(
      { type: 'setActivity', activity: 'food_drinks' },
      { type: 'toggleSubtype', id: 'thai' },
      { type: 'toggleSubtype', id: 'korean' },
      { type: 'setBudget', choice: 'under_25' },
      { type: 'setTiming', kind: 'tonight', now: NOW },
    );
    expect(summarizePreferences(s)).toEqual(['Food & drinks: Korean +1', 'Under $25', 'Tonight']);
  });

  it('leaves an unfinished custom time out of the summary', () => {
    const s = run({ type: 'setCustomTiming', date: '2026-11-22', time: '', now: NOW });
    expect(summarizePreferences(s)).toEqual([]);
  });
});

describe('normalizePreferences', () => {
  it('returns the initial state for junk input', () => {
    expect(normalizePreferences(null, NOW)).toEqual(initialPreferences());
    expect(normalizePreferences('nope', NOW)).toEqual(initialPreferences());
  });

  it('drops unknown ids and subtypes that belong to a different activity', () => {
    const s = normalizePreferences(
      { activity: 'food_drinks', cuisines: ['thai', 'klingon', 'italian'], activityTypes: ['nightlife'] },
      NOW,
    );
    expect(s.cuisines).toEqual(['italian', 'thai']);
    expect(s.activityTypes).toEqual([]);
    expect(normalizePreferences({ activity: 'skydiving', cuisines: ['thai'] }, NOW)).toMatchObject({ activity: null, cuisines: [] });
  });

  it('re-derives the budget amount from its choice instead of trusting stored cents', () => {
    expect(normalizePreferences({ budget: { choice: 'under_40', maxCentsPerPerson: 1 } }, NOW).budget).toEqual({
      choice: 'under_40',
      maxCentsPerPerson: 4000,
    });
  });

  it('keeps a valid origin and discards one with bad coordinates', () => {
    const good = normalizePreferences({ origin: { label: 'BU', location: { lat: 42.35, lng: -71.1 }, source: 'local_suggestion' } }, NOW);
    expect(good.origin?.location).toEqual({ lat: 42.35, lng: -71.1 });
    expect(normalizePreferences({ origin: { label: 'Nowhere', location: { lat: '42', lng: -71 } } }, NOW).origin).toBeNull();
    expect(normalizePreferences({ origin: { label: 'Nowhere' } }, NOW).origin).toBeNull();
  });

  it('re-resolves timing against the current time', () => {
    const s = normalizePreferences({ timingChoice: 'tomorrow', timing: { start: '1999-01-01T00:00:00Z' } }, NOW);
    expect(s.timing?.start).toBe('2026-11-22T00:00:00-05:00');
  });
});
