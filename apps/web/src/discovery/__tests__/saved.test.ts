import { describe, expect, it, vi } from 'vitest';
import type { Place } from '../../osm';
import { createSavedStore, parseSaved, SAVED_LIMIT, SAVED_STORAGE_KEY, savedToPlace, toSavedPlace } from '../saved';

/** Development fixture shaped like an osm.ts place (not a real venue). */
const place = (id: string, extra: Record<string, string> = {}): Place => ({
  id,
  name: `Fixture ${id}`,
  lat: 42.35,
  lon: -71.06,
  category: 'Cafe',
  tags: { amenity: 'cafe', 'addr:street': 'Fixture St', website: 'https://example.org', note: 'not kept', ...extra },
});

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((k: string) => data.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => void data.set(k, v)),
    data,
  };
}

describe('saved places', () => {
  it('saves, reports and unsaves a place', () => {
    const store = createSavedStore(memoryStorage());
    expect(store.toggle(place('node/1'))).toBe(true);
    expect(store.has('node/1')).toBe(true);
    expect(store.toggle(place('node/1'))).toBe(false);
    expect(store.has('node/1')).toBe(false);
  });

  it('keeps only fields from the place record (no extra tags, nothing estimated)', () => {
    const s = toSavedPlace(place('node/2'), { categoryId: 'coffee' }, new Date('2026-11-21T20:00:00Z'));
    expect(s).toEqual({
      id: 'node/2',
      name: 'Fixture node/2',
      lat: 42.35,
      lon: -71.06,
      category: 'Cafe',
      tags: { amenity: 'cafe', 'addr:street': 'Fixture St', website: 'https://example.org' },
      categoryId: 'coffee',
      savedAt: '2026-11-21T20:00:00.000Z',
    });
    expect(savedToPlace(s)).toMatchObject({ id: 'node/2', lat: 42.35, lon: -71.06, tags: { website: 'https://example.org' } });
  });

  it('persists across store instances (reload)', () => {
    const storage = memoryStorage();
    createSavedStore(storage).toggle(place('way/3'));
    const reloaded = createSavedStore(storage);
    expect(reloaded.list().map((s) => s.id)).toEqual(['way/3']);
    expect(storage.data.has(SAVED_STORAGE_KEY)).toBe(true);
  });

  it('lists newest first and removes by id', () => {
    const store = createSavedStore(memoryStorage());
    store.toggle(place('node/1'));
    store.toggle(place('node/2'));
    expect(store.list().map((s) => s.id)).toEqual(['node/2', 'node/1']);
    store.remove('node/2');
    expect(store.list().map((s) => s.id)).toEqual(['node/1']);
  });

  it('notifies subscribers', () => {
    const store = createSavedStore(memoryStorage());
    const listener = vi.fn();
    store.subscribe(listener);
    store.toggle(place('node/1'));
    expect(listener).toHaveBeenCalledWith([expect.objectContaining({ id: 'node/1' })]);
  });

  it('caps the list size', () => {
    const store = createSavedStore(memoryStorage());
    for (let i = 0; i < SAVED_LIMIT + 5; i++) store.toggle(place(`node/${i}`));
    expect(store.list()).toHaveLength(SAVED_LIMIT);
    expect(store.has(`node/${SAVED_LIMIT + 4}`)).toBe(true);
    expect(store.has('node/0')).toBe(false);
  });

  it('drops corrupt or malformed stored data instead of trusting it', () => {
    expect(parseSaved('not json')).toEqual([]);
    expect(parseSaved('{"a":1}')).toEqual([]);
    const good = toSavedPlace(place('node/1'));
    const raw = JSON.stringify([good, { ...good, id: 'node/9', lat: 999 }, { id: 'x' }, good]);
    expect(parseSaved(raw).map((s) => s.id)).toEqual(['node/1']);
  });

  it('keeps working in memory when storage is unavailable or full', () => {
    const none = createSavedStore(null);
    expect(none.persistent).toBe(false);
    expect(none.toggle(place('node/1'))).toBe(true);
    const full = memoryStorage();
    full.setItem.mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const store = createSavedStore(full);
    expect(store.toggle(place('node/1'))).toBe(true);
    expect(store.persistent).toBe(false);
  });
});
