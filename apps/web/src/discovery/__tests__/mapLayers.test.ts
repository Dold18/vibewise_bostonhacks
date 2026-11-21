import { afterEach, describe, expect, it, vi } from 'vitest';
import { CATEGORIES } from '../../osm';
import { createMapLayerNotifier, mapLayersFor, selectionKey, type MapLayer, type MapLayerSelection } from '../mapLayers';
import { initialPreferences, preferencesReducer, type InitialPreferences, type PreferencesAction } from '../preferences';

/** The map's real category list, so these tests fail if a layer id drifts. */
const LAYERS: MapLayer[] = CATEGORIES.map(({ id, label }) => ({ id, label }));
const prefs = (...actions: PreferencesAction[]): InitialPreferences => actions.reduce(preferencesReducer, initialPreferences());
const activities = (...ids: string[]) =>
  prefs({ type: 'setActivity', activity: 'activities' }, ...ids.map((id) => ({ type: 'toggleSubtype', id }) as PreferencesAction));

describe('mapLayersFor', () => {
  it('only uses layer ids the map actually has', () => {
    expect(LAYERS.map((l) => l.id)).toEqual(['restaurants', 'coffee', 'bars', 'parks', 'museums']);
  });

  it('before any choice, shows every layer from map tiles only (no network lookups)', () => {
    expect(mapLayersFor(initialPreferences(), LAYERS)).toEqual({
      layerIds: ['restaurants', 'coffee', 'bars', 'parks', 'museums'],
      detail: 'tiles',
      unsupportedActivityTypes: [],
    });
  });

  it('Food & drinks loads restaurants, cafés and bars', () => {
    expect(mapLayersFor(prefs({ type: 'setActivity', activity: 'food_drinks' }), LAYERS).layerIds).toEqual([
      'restaurants',
      'coffee',
      'bars',
    ]);
  });

  it('cuisine choices do not change the layers', () => {
    const plain = mapLayersFor(prefs({ type: 'setActivity', activity: 'food_drinks' }), LAYERS);
    const withCuisine = mapLayersFor(
      prefs({ type: 'setActivity', activity: 'food_drinks' }, { type: 'toggleSubtype', id: 'thai' }),
      LAYERS,
    );
    expect(selectionKey(withCuisine)).toBe(selectionKey(plain));
  });

  it('Activities with no type chosen loads every supported activity layer', () => {
    expect(mapLayersFor(activities(), LAYERS).layerIds).toEqual(['bars', 'parks', 'museums']);
  });

  it('several activity types load the union of their layers', () => {
    expect(mapLayersFor(activities('museums_galleries'), LAYERS).layerIds).toEqual(['museums']);
    expect(mapLayersFor(activities('outdoors_parks', 'museums_galleries'), LAYERS).layerIds).toEqual(['parks', 'museums']);
    expect(mapLayersFor(activities('nightlife'), LAYERS).layerIds).toEqual(['bars']);
  });

  it('reports unsupported types and never substitutes other layers for them', () => {
    expect(mapLayersFor(activities('live_music', 'student_events'), LAYERS)).toEqual({
      layerIds: [],
      detail: 'full',
      unsupportedActivityTypes: ['live_music', 'student_events'],
    });
    expect(mapLayersFor(activities('shopping', 'outdoors_parks'), LAYERS)).toMatchObject({
      layerIds: ['parks'],
      unsupportedActivityTypes: ['shopping'],
    });
  });

  it('Open to anything loads every layer with full detail', () => {
    expect(mapLayersFor(prefs({ type: 'setActivity', activity: 'anything' }), LAYERS)).toMatchObject({
      layerIds: ['restaurants', 'coffee', 'bars', 'parks', 'museums'],
      detail: 'full',
    });
  });

  it('ignores layers the map does not offer', () => {
    const onlyParks = LAYERS.filter((l) => l.id === 'parks');
    expect(mapLayersFor(prefs({ type: 'setActivity', activity: 'food_drinks' }), onlyParks).layerIds).toEqual([]);
    expect(mapLayersFor(activities('museums_galleries'), onlyParks).unsupportedActivityTypes).toEqual(['museums_galleries']);
  });

  it('budget, timing, origin and vibe never change the layers', () => {
    const base = prefs({ type: 'setActivity', activity: 'food_drinks' });
    const more = [
      { type: 'setBudget', choice: 'under_15' },
      { type: 'setTiming', kind: 'tonight', now: new Date('2026-11-21T17:00:00Z') },
      { type: 'setVibeText', text: 'only museums please' },
    ].reduce((s, a) => preferencesReducer(s, a as PreferencesAction), base);
    expect(selectionKey(mapLayersFor(more, LAYERS))).toBe(selectionKey(mapLayersFor(base, LAYERS)));
  });
});

describe('createMapLayerNotifier', () => {
  afterEach(() => vi.useRealTimers());

  function setup() {
    vi.useFakeTimers();
    let state = initialPreferences();
    const calls: MapLayerSelection[] = [];
    const notifier = createMapLayerNotifier(() => state, LAYERS, (s) => calls.push(s), 500);
    const dispatch = (a: PreferencesAction) => {
      state = preferencesReducer(state, a);
      notifier.schedule();
    };
    return { notifier, dispatch, calls };
  }

  it('reports the initial selection immediately', () => {
    const { notifier, calls } = setup();
    notifier.start();
    expect(calls.map((c) => c.detail)).toEqual(['tiles']);
  });

  it('debounces rapid changes into one update (~500 ms after the last change)', () => {
    const { notifier, dispatch, calls } = setup();
    notifier.start();
    dispatch({ type: 'setActivity', activity: 'activities' });
    vi.advanceTimersByTime(300);
    dispatch({ type: 'toggleSubtype', id: 'museums_galleries' });
    vi.advanceTimersByTime(300);
    dispatch({ type: 'toggleSubtype', id: 'outdoors_parks' });
    vi.advanceTimersByTime(499);
    expect(calls).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(calls).toHaveLength(2);
    expect(calls[1].layerIds).toEqual(['parks', 'museums']);
  });

  it('does not reload when the layers are unchanged', () => {
    const { notifier, dispatch, calls } = setup();
    notifier.start();
    dispatch({ type: 'setActivity', activity: 'food_drinks' });
    vi.advanceTimersByTime(500);
    dispatch({ type: 'toggleSubtype', id: 'thai' });
    dispatch({ type: 'setBudget', choice: 'under_25' });
    vi.advanceTimersByTime(500);
    expect(calls).toHaveLength(2);
  });

  it('dispose cancels a pending update', () => {
    const { notifier, dispatch, calls } = setup();
    notifier.start();
    dispatch({ type: 'setActivity', activity: 'anything' });
    notifier.dispose();
    vi.advanceTimersByTime(1000);
    expect(calls).toHaveLength(1);
  });
});
