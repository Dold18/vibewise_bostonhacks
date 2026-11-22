import { describe, expect, it } from 'vitest';
import { distanceToSegment } from '../geometry';
import { surfaceCandidates } from '../surfaces';
import { ROAD_XS, ROAD_YS, syntheticCity } from './fixtures';

const g = syntheticCity();
const area = [0, -700, 700, 0] as const;
const candidates = surfaceCandidates(g, area);

describe('surface suitability', () => {
  it('finds every safe surface type in a real-looking downtown grid', () => {
    const surfaces = new Set(candidates.map((c) => c.surface));
    for (const s of ['sidewalk', 'park', 'path_edge', 'plaza', 'waterfront', 'rooftop']) expect(surfaces).toContain(s);
  });

  it('never places a ground candidate inside a building, in water or near rails', () => {
    for (const c of candidates.filter((k) => k.surface !== 'rooftop')) {
      expect(g.areaAt('building', c.x, c.y)).toBeUndefined();
      expect(g.areaAt('water', c.x, c.y)).toBeUndefined();
      expect(g.railDistance(c.x, c.y, 10)).toBeGreaterThanOrEqual(6);
    }
  });

  it('keeps every candidate (and its usable radius) off carriageways', () => {
    for (const c of candidates.filter((k) => k.surface !== 'rooftop')) {
      const { own, other } = g.roadClearance(c.x, c.y, 50);
      expect(Math.min(own, other) - c.free).toBeGreaterThan(0.2);
    }
  });

  it('sidewalk props leave a walkway to the building line and avoid intersections', () => {
    const sidewalks = candidates.filter((c) => c.surface === 'sidewalk');
    expect(sidewalks.length).toBeGreaterThan(100);
    for (const c of sidewalks) {
      expect(c.buildingClear - c.free).toBeGreaterThanOrEqual(1.6 - 1e-9);
      // Not within 5 m of a crossing carriageway: distance to the nearest perpendicular road centerline.
      const nearestCross = Math.min(...ROAD_XS.map((x) => Math.abs(c.x - x)), ...ROAD_YS.map((y) => Math.abs(c.y - y)).filter((d) => d > 8));
      expect(nearestCross).toBeGreaterThan(5);
    }
  });

  it('park candidates stay off the footpath', () => {
    const path = g.lines.find((l) => l.kind === 'path')!;
    for (const c of candidates.filter((k) => k.surface === 'park')) {
      const p = path.points;
      expect(distanceToSegment(c.x, c.y, p[0]!, p[1]!, p[2]!, p[3]!) - 1.2 - c.free).toBeGreaterThan(0);
    }
  });

  it('rooftop spots stand exactly on the rendered roof, inset from its edge and off step changes', () => {
    const roofs = candidates.filter((c) => c.surface === 'rooftop');
    expect(roofs.length).toBeGreaterThan(50);
    for (const c of roofs) {
      expect(c.z).toBe(g.roofAt(c.x, c.y));
      expect(g.edgeDistance('building', c.x, c.y, 50)).toBeGreaterThanOrEqual(3);
      // Never on the tower/base boundary: the 4 m surroundings share the same roof height.
      for (const [dx, dy] of [[c.free, 0], [-c.free, 0], [0, c.free], [0, -c.free]]) expect(Math.abs(g.roofAt(c.x + dx!, c.y + dy!)! - c.z!)).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic and independent of the session seed', () => {
    expect(surfaceCandidates(g, area)).toEqual(candidates);
  });
});

describe('hot-path pre-checks are exact', () => {
  it('mayHaveArea(false) means no area or roof anywhere in the rectangle', () => {
    let skipped = 0;
    for (let x = 0; x < 700; x += 7) for (let y = -700; y < 0; y += 7) {
      for (const kind of ['park', 'plaza', 'building'] as const) {
        if (g.mayHaveArea(kind, x, y, x + 7, y + 7)) continue;
        skipped++;
        for (const [dx, dy] of [[0.5, 0.5], [3.5, 3.5], [6.5, 6.5], [1, 6]] as const) {
          expect(g.areaAt(kind, x + dx, y + dy)).toBeUndefined();
          if (kind === 'building') expect(g.roofAt(x + dx, y + dy)).toBeNull();
        }
      }
    }
    expect(skipped).toBeGreaterThan(0);
  });

  it('repeated clearance queries return identical answers (no stale query stamps)', () => {
    const probe = () => candidates.slice(0, 200).map((c) => [g.edgeDistance('building', c.x, c.y, 30), g.roadClearance(c.x, c.y, 30), g.pathClearance(c.x, c.y, 30)]);
    expect(probe()).toEqual(probe());
    expect(surfaceCandidates(g, area)).toEqual(candidates);
  });
});
