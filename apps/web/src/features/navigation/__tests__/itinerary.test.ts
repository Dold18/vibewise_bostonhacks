import { describe, expect, it } from 'vitest';
import type { RouteOk } from '../../../transitRoute';
import { buildItinerary } from '../itinerary';

/** TEST FIXTURE shaped like a Tier 2 (one transfer) server result; not a real trip. */
const TRANSFER: RouteOk = {
  status: 'ok',
  tier: 2,
  option: {
    durationSec: 1800,
    transfers: 1,
    legs: [
      { mode: 'walk', durationSec: 240, distanceMeters: 322, geometry: [[-71.12, 42.374], [-71.119, 42.373]], source: 'approx: straight-line walk, ~80 m/min' },
      { mode: 'subway', durationSec: 600, geometry: [[-71.119, 42.373], [-71.062, 42.356]], routeShortName: 'Red', routeColor: '#DA291C', fromStopName: 'Harvard', toStopName: 'Park Street' },
      { mode: 'subway', durationSec: 540, geometry: [[-71.062, 42.356], [-71.095, 42.349]], routeShortName: 'B', routeColor: '#00843D', fromStopName: 'Park Street', toStopName: 'Kenmore' },
      { mode: 'walk', durationSec: 180, distanceMeters: 240, geometry: [[-71.095, 42.349], [-71.097, 42.347]], source: 'approx: straight-line walk, ~80 m/min' },
    ],
  },
  timings: [
    { kind: 'scheduled', departsAt: '2026-11-22T00:10:00Z', arrivesAt: '2026-11-22T00:20:00Z', rideSeconds: 600 },
    { kind: 'scheduled', departsAt: '2026-11-22T00:24:00Z', arrivesAt: '2026-11-22T00:33:00Z', rideSeconds: 540 },
  ],
  transferWaitSeconds: 240,
  lastTrainBack: { fromStopName: 'Kenmore', toStopName: 'Park Street', departsAt: '2026-11-22T05:30:00Z', catchable: true },
};

describe('itinerary', () => {
  const it2 = buildItinerary(TRANSFER, { fromLabel: 'Harvard Yard', toLabel: 'Fixture Cafe' });

  it('lists walk, ride, transfer, ride, walk in order with matching line colours', () => {
    expect(it2.steps.map((s) => s.kind)).toEqual(['walk', 'ride', 'transfer', 'ride', 'walk']);
    const rides = it2.steps.filter((s) => s.kind === 'ride');
    expect(rides.map((r) => [r.line, r.color, r.from, r.to])).toEqual([
      ['Red Line', '#DA291C', 'Harvard', 'Park Street'],
      ['Green Line B', '#00843D', 'Park Street', 'Kenmore'],
    ]);
  });

  it('labels straight-line walks as estimates and names where they go', () => {
    const walks = it2.steps.filter((s) => s.kind === 'walk');
    expect(walks[0]).toMatchObject({ text: 'Walk to Harvard', estimate: true });
    expect(walks[0].kind === 'walk' && walks[0].detail).toContain('straight-line estimate');
    expect(walks[1]).toMatchObject({ text: 'Walk to Fixture Cafe' });
  });

  it('labels schedule times as scheduled (never live) in Boston time', () => {
    expect(it2.departure).toBe('First train departs 7:10 PM (scheduled)');
    const ride = it2.steps[1];
    expect(ride.kind === 'ride' && ride.schedule).toBe('Departs 7:10 PM · arrives 7:20 PM (scheduled)');
    expect(JSON.stringify(it2).toLowerCase()).not.toContain('live');
  });

  it('without a first-train wait from the server, says the total excludes it, and includes the transfer wait when there is one', () => {
    expect(it2.summary).toBe('About 30 min · 1 transfer');
    expect(it2.summaryNote).toContain('Excludes waiting for the first train');
    expect(it2.summaryNote).toContain('scheduled wait at the transfer');
    expect(it2.steps[2]).toEqual({ kind: 'transfer', text: 'Transfer at Park Street', detail: 'Scheduled wait about 4 min' });
  });

  it('with firstTrainWaitSeconds, includes that wait in the total, adds a wait row before the first ride, and says so', () => {
    const waited = buildItinerary({ ...TRANSFER, firstTrainWaitSeconds: 300 }, { fromLabel: 'Harvard Yard', toLabel: 'Fixture Cafe' });
    // durationSec (1800, already includes the transfer wait) + 300 s first wait = 35 min.
    expect(waited.summary).toBe('About 35 min · 1 transfer');
    expect(waited.summaryNote).toContain('Assumes you leave now');
    expect(waited.summaryNote).toContain('wait for the first train');
    expect(waited.summaryNote).not.toContain('Excludes');
    expect(waited.steps.map((s) => s.kind)).toEqual(['walk', 'wait', 'ride', 'transfer', 'ride', 'walk']);
    expect(waited.steps[1]).toEqual({ kind: 'wait', text: 'Wait at Harvard', detail: '~5 min, next scheduled Red Line train' });
    // The transfer wait is shown once, on the transfer step; it is not duplicated as a second wait row.
    expect(waited.steps.filter((s) => s.kind === 'wait')).toHaveLength(1);
    // A zero wait adds no row and leaves the total alone.
    const zero = buildItinerary({ ...TRANSFER, firstTrainWaitSeconds: 0 }, { fromLabel: 'a', toLabel: 'b' });
    expect(zero.steps.some((s) => s.kind === 'wait')).toBe(false);
    expect(zero.summary).toBe('About 30 min · 1 transfer');
  });

  it('reports the last train back, or why it is unavailable', () => {
    expect(it2.lastTrain).toContain('Last scheduled train back from Kenmore toward Park Street: 12:30 AM');
    const none = buildItinerary({ ...TRANSFER, lastTrainBack: null, lastTrainBackNote: 'no scheduled return trips found after 20:00' }, { fromLabel: 'a', toLabel: 'b' });
    expect(none.lastTrain).toBe('Last train back: no scheduled return trips found after 20:00');
  });

  it('adds no invented fields (no fare, no live departures)', () => {
    const text = JSON.stringify(it2).toLowerCase();
    for (const word of ['fare', '$', 'live', 'real-time']) expect(text).not.toContain(word);
  });
});
