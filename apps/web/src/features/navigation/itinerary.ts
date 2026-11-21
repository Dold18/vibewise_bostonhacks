/**
 * Turns a verified route into itinerary rows. Every number keeps its label:
 * ride times and departures are schedule-derived ("scheduled", never "live"),
 * walking times are straight-line estimates unless the leg carries a routed
 * pedestrian path, and the total excludes the wait for the first train.
 * Nothing is computed here that the route didn't contain.
 */
import { isVerifiedWalkGeometry, lineColor, lineName, type RouteLeg, type RouteOk } from '../../transitRoute';

export type ItineraryStep =
  | { kind: 'walk'; text: string; detail: string; estimate: boolean }
  | {
      kind: 'ride';
      line: string;
      color: string;
      colorKnown: boolean;
      from: string;
      to: string;
      /** "Departs 7:42 PM · arrives 7:55 PM (scheduled)" when the schedule gave times. */
      schedule?: string;
      detail: string;
    }
  | { kind: 'transfer'; text: string; detail?: string };

export interface Itinerary {
  summary: string;
  summaryNote: string;
  departure?: string;
  steps: ItineraryStep[];
  lastTrain: string;
}

export const bostonTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });

const minutes = (sec: number) => `${Math.max(1, Math.round(sec / 60))} min`;

function walkStep(leg: RouteLeg, toLabel: string): ItineraryStep {
  const verified = isVerifiedWalkGeometry(leg);
  const dist = typeof leg.distanceMeters === 'number' ? ` · about ${Math.round(leg.distanceMeters / 10) * 10} m` : '';
  return {
    kind: 'walk',
    text: `Walk to ${toLabel}`,
    detail: verified ? `${minutes(leg.durationSec)}${dist} · walking route` : `About ${minutes(leg.durationSec)}${dist} · straight-line estimate`,
    estimate: !verified,
  };
}

export function buildItinerary(route: RouteOk, endpoints: { fromLabel: string; toLabel: string }): Itinerary {
  const legs = route.option.legs;
  const timings = route.timings ?? (route.timing ? [route.timing] : []);
  const steps: ItineraryStep[] = [];
  let rideIndex = 0;

  legs.forEach((leg, i) => {
    if (leg.mode === 'walk') {
      const next = legs[i + 1];
      const toLabel = next && next.mode !== 'walk' ? `${next.fromStopName ?? 'the station'}` : endpoints.toLabel;
      steps.push(walkStep(leg, toLabel));
      return;
    }
    if (rideIndex > 0) {
      const wait = route.transferWaitSeconds;
      steps.push({
        kind: 'transfer',
        text: `Transfer at ${leg.fromStopName ?? 'the station'}`,
        ...(typeof wait === 'number' ? { detail: `Scheduled wait about ${minutes(wait)}` } : {}),
      });
    }
    const t = timings[rideIndex];
    const { color, known } = lineColor(leg);
    steps.push({
      kind: 'ride',
      line: lineName(leg),
      color,
      colorKnown: known,
      from: leg.fromStopName ?? '',
      to: leg.toStopName ?? '',
      ...(t ? { schedule: `Departs ${bostonTime(t.departsAt)} · arrives ${bostonTime(t.arrivesAt)} (scheduled)` } : {}),
      detail: `${minutes(leg.durationSec)} ride${t ? ' (MBTA schedule)' : ''}`,
    });
    rideIndex++;
  });

  const transfers = route.option.transfers;
  const first = timings[0];
  const last = route.lastTrainBack;
  return {
    summary: `About ${minutes(route.option.durationSec)} · ${transfers === 0 ? 'no transfers' : `${transfers} transfer${transfers === 1 ? '' : 's'}`}`,
    summaryNote:
      'Walking estimates plus scheduled ride time' +
      (typeof route.transferWaitSeconds === 'number' ? ' and the scheduled wait at the transfer' : '') +
      '. Excludes waiting for the first train.',
    ...(first ? { departure: `First train departs ${bostonTime(first.departsAt)} (scheduled)` } : {}),
    steps,
    lastTrain: last
      ? `Last scheduled train back from ${last.fromStopName} toward ${last.toStopName}: ${bostonTime(last.departsAt)}${last.catchable ? '' : ' (leaves before you would arrive)'}`
      : `Last train back: ${route.lastTrainBackNote ?? 'unavailable'}`,
  };
}
