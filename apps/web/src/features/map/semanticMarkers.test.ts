import { describe, expect, it } from 'vitest';
import type { Ranking } from '../vibe/adapters';
import { semanticMarkerState } from './semanticMarkers';

// Explicit semantic fixtures, never production similarity values.
const ranking: Ranking = {
  sessionId: 'TEST FIXTURE', version: 1, status: 'ready', provenance: 'fixture',
  all: [
    { id: 'strong', location: { lat: 42.35, lng: -71.06 }, score: 1, scale: 1.25, weak: false },
    { id: 'weak', location: { lat: 42.36, lng: -71.07 }, score: 0, scale: .7, weak: true },
  ],
};

describe('semantic appearance on the existing discovery markers', () => {
  it('ranks discovery pins and can reveal weak pins without changing their coordinates', () => {
    const before = structuredClone(ranking);
    expect(semanticMarkerState(ranking, 'strong', 'discovery', [])).toEqual({ scale: 1.25, visible: true });
    expect(semanticMarkerState(ranking, 'weak', 'discovery', [])).toEqual({ scale: .7, visible: false });
    expect(semanticMarkerState(ranking, 'weak', 'discovery', [], true)).toEqual({ scale: .7, visible: true });
    expect(ranking).toEqual(before);
  });

  it('keeps a selected weak destination visible and prevents semantic filtering from hiding Search endpoints', () => {
    expect(semanticMarkerState(ranking, 'weak', 'discovery', ['weak'])).toEqual({ scale: 1, visible: true });
    expect(semanticMarkerState(ranking, 'weak', 'search', ['weak'])).toEqual({ scale: 1, visible: true });
    expect(semanticMarkerState(ranking, 'strong', 'search', ['weak'])).toEqual({ scale: 1, visible: false });
  });

  it('keeps all ordinary pins hidden in Navigation, including selected endpoints and Show All', () => {
    for (const id of ['strong', 'weak']) {
      expect(semanticMarkerState(ranking, id, 'navigation', [id], true)).toEqual({ scale: 1, visible: false });
    }
  });

  it('leaves pins neutral when no compatible embeddings exist or a ranking is cleared', () => {
    for (const state of [null, { ...ranking, status: 'unavailable' as const, all: [] }]) {
      expect(semanticMarkerState(state, 'weak', 'discovery', [])).toEqual({ scale: 1, visible: true });
    }
  });
});
