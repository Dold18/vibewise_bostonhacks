/**
 * Procedural composition: theme + seed + safe surfaces → placements.
 *
 * 1. A coherent *cast* is chosen once per scene: a handful of models per tier,
 *    weighted by motif relevance, with family diversity and a draw-call budget.
 *    Stable weighted sampling (Efraimidis–Spirakis keys from the seed) means
 *    small vibe drifts rarely swap cast members.
 * 2. Each decoration cell then composes from that cast using spatial patterns,
 *    not a grid: rhythmic promenades along real streets/paths, vignette
 *    clusters (anchor + satellites), natural groves in parks, Poisson-disk
 *    dispersed accents and sparse micro details.
 * 3. Hero installations reuse the authored two-slot layouts (hero_installation
 *    + ambient_accent), sited on the largest verified open ground per region.
 *
 * Everything here is pure and deterministic (tests run it on synthetic maps).
 */
import { FAMILIES, gateAllows, relevance, type DecorAsset, type DecorCatalog, type Family, type Tier } from './catalog';
import type { DecorConfig } from './config';
import type { Rect, TileGeometry } from './geometry';
import { gaussian, hashSeed, logUniform, pickWeighted, rng, unit, type Rng } from './random';
import type { Candidate, Surface } from './surfaces';
import type { DecorTheme } from './themes';

export interface CastEntry { readonly asset: DecorAsset; readonly weight: number }
export interface Cast { readonly micro: readonly CastEntry[]; readonly secondary: readonly CastEntry[]; readonly key: string }

export type Pattern = 'promenade' | 'vignette' | 'grove' | 'accent' | 'detail' | 'rooftop' | 'hero';

export interface Placement {
  readonly assetId: string;
  readonly tier: Tier;
  readonly pattern: Pattern;
  /** Local meters in the source tile frame. */
  readonly x: number;
  readonly y: number;
  /** Standing height (m): 0 on the ground, roof height on rooftops. */
  readonly z: number;
  /** Radians in the local frame: direction the model's front (+Z) faces. */
  readonly facing: number;
  /** Longest model dimension (m). */
  readonly size: number;
  /** Base radius that was cleared against roads/paths (m). */
  readonly base: number;
  readonly surface: Surface | 'open_ground';
  /** 0..1 thinning priority (lower survives LOD/budget culling first); clusters share it. */
  readonly rank: number;
  readonly group: string;
}

// ---------------------------------------------------------------------------
// Cast
// ---------------------------------------------------------------------------

export function selectCast(catalog: DecorCatalog, theme: DecorTheme, config: DecorConfig): Cast {
  const pick = (tier: 'micro' | 'secondary', size: number, perFamily: number, prims: { used: number }) => {
    if (!config.tiers[tier] || size <= 0) return [];
    const scored: Array<{ asset: DecorAsset; weight: number; key: number }> = [];
    for (const asset of catalog.assets.values()) {
      if (asset.tier !== tier || !gateAllows(asset, theme.gates)) continue;
      const weight = relevance(asset, theme.motifs);
      if (weight < 0.15) continue;
      // Efraimidis–Spirakis: key = u^(1/w); stable per (seed, asset).
      scored.push({ asset, weight, key: Math.pow(Math.max(1e-9, unit(config.seed, 'cast', asset.id)), 1 / weight) });
    }
    scored.sort((a, b) => b.key - a.key || (a.asset.id < b.asset.id ? -1 : 1));
    const out: CastEntry[] = [], families = new Map<Family, number>();
    const take = (entry: (typeof scored)[number]) => {
      if (out.some((e) => e.asset.id === entry.asset.id)) return false;
      if ((families.get(entry.asset.family) ?? 0) >= perFamily) return false;
      if (prims.used + entry.asset.metrics.prims > config.budget.maxDrawCalls) return false;
      out.push({ asset: entry.asset, weight: entry.weight });
      families.set(entry.asset.family, (families.get(entry.asset.family) ?? 0) + 1);
      prims.used += entry.asset.metrics.prims;
      return true;
    };
    // Structural roles first so every cast can form patterns, then fill by key order.
    const roles: Array<(a: DecorAsset) => boolean> = tier === 'secondary'
      ? [(a) => !!FAMILIES[a.family].linear, (a) => !!FAMILIES[a.family].anchor && !FAMILIES[a.family].linear, (a) => !!FAMILIES[a.family].grove]
      : [(a) => !!FAMILIES[a.family].grove, (a) => !FAMILIES[a.family].grove];
    for (const role of roles) { const e = scored.find((s) => role(s.asset)); if (e && out.length < size) take(e); }
    for (const e of scored) { if (out.length >= size) break; take(e); }
    return out;
  };
  const prims = { used: 0 };
  const maxAssets = Math.max(0, config.budget.maxAssets - 5); // headroom for one hero layout
  const secondary = pick('secondary', Math.min(config.castSize.secondary, maxAssets), 2, prims);
  const micro = pick('micro', Math.min(config.castSize.micro, maxAssets - secondary.length), 2, prims);
  const key = hashSeed(config.seed, theme.key, ...secondary.map((e) => e.asset.id), '|', ...micro.map((e) => e.asset.id)).toString(36);
  return { micro, secondary, key };
}

// ---------------------------------------------------------------------------
// Cell composition
// ---------------------------------------------------------------------------

class Occupancy {
  private readonly items: Array<{ x: number; y: number; base: number; canopy: number; tier: Tier; tree: boolean }> = [];
  fits(x: number, y: number, base: number, canopy: number, tier: Tier, tree: boolean, spacing: DecorConfig['minSpacing']) {
    for (const o of this.items) {
      const d = Math.hypot(o.x - x, o.y - y);
      const solid = o.base + base + 0.6;
      // Canopies may interleave a little (rows of trees), solid bodies may not.
      const visual = tree && o.tree ? 0.55 * (o.canopy + canopy) : 0.8 * (o.canopy + canopy);
      const same = o.tier === tier ? spacing[tier] : 0;
      if (d < Math.max(solid, Math.min(visual, solid + 6), same)) return false;
    }
    return true;
  }
  add(x: number, y: number, base: number, canopy: number, tier: Tier, tree: boolean) { this.items.push({ x, y, base, canopy, tier, tree }); }
}

export interface CellInput {
  readonly cellKey: string;
  readonly rect: Rect;
  readonly candidates: readonly Candidate[];
  readonly cast: Cast;
  readonly theme: DecorTheme;
  readonly config: DecorConfig;
}

/** A park or plaza larger than this (4 ha) is a major open public space. */
export const OPEN_SPACE_M2 = 40_000;
/** Share of a major open space's sample spots that may hold a decoration. */
export const OPEN_SPACE_KEEP = { ordinary: 0.25, themed: 0.45 } as const;

export function composeCell(input: CellInput): Placement[] {
  const { cellKey, rect, candidates, cast, theme, config } = input;
  const d = config.density * theme.strength;
  if (d < 0.04 || candidates.length === 0 || (!cast.secondary.length && !cast.micro.length)) return [];
  const next: Rng = rng(hashSeed(config.seed, cellKey, cast.key));
  const occupancy = new Occupancy(), out: Placement[] = [];
  const counts = { micro: 0, secondary: 0 }, perFamily = new Map<Family, number>();
  const caps = { micro: Math.round(3 + 14 * d), secondary: Math.round(1 + 4.5 * d) };
  const [x0, y0, x1, y1] = rect;
  const clustering = config.clustering;

  const sizeFor = (asset: DecorAsset, r: number) => {
    const [lo, hi] = FAMILIES[asset.family].size, mid = Math.sqrt(lo * hi);
    const v = config.scaleVariance;
    return config.scale * logUniform(mid * Math.pow(lo / mid, v), mid * Math.pow(hi / mid, v), r);
  };
  const dims = (asset: DecorAsset, size: number) => {
    const canopy = size * asset.radiusRatio;
    return { canopy, base: Math.max(0.25, canopy * FAMILIES[asset.family].base) };
  };
  /** Try to place; returns the placement or null. Enforces surface, clearance, cell margin, spacing and caps. */
  const place = (entry: CastEntry, c: Candidate, size: number, pattern: Pattern, group: string, rank: number, facing = c.facing): Placement | null => {
    const asset = entry.asset, spec = FAMILIES[asset.family], tier = asset.tier;
    const roof = pattern === 'rooftop';
    if (!roof && counts[tier] >= caps[tier]) return null;
    if (spec.perCell && (perFamily.get(asset.family) ?? 0) >= spec.perCell) return null;
    if (!spec.surfaces.includes(c.surface)) return null;
    const { canopy, base } = dims(asset, size);
    if (base > c.free || canopy > c.buildingClear - 0.4) return null;
    // Margin from the cell edge: neighbours are composed independently, so this guarantees cross-cell spacing.
    const margin = Math.max(base, config.minSpacing[tier] / 2);
    if (c.x - x0 < margin || x1 - c.x < margin || c.y - y0 < margin || y1 - c.y < margin) return null;
    const tree = asset.family === 'tree';
    if (!occupancy.fits(c.x, c.y, base, canopy, tier, tree, config.minSpacing)) return null;
    occupancy.add(c.x, c.y, base, canopy, tier, tree);
    if (!roof) counts[tier]++;
    perFamily.set(asset.family, (perFamily.get(asset.family) ?? 0) + 1);
    const p: Placement = { assetId: asset.id, tier, pattern, x: c.x, y: c.y, z: c.z ?? 0, facing, size, base, surface: c.surface, rank, group };
    out.push(p);
    return p;
  };
  const choose = (entries: readonly CastEntry[], filter: (a: DecorAsset) => boolean, r: number, surface?: Surface) =>
    pickWeighted(entries.filter((e) => filter(e.asset) && (!surface || FAMILIES[e.asset.family].surfaces.includes(surface))), (e) => e.weight, r);
  // Rooftops have their own pattern; ground patterns only see ground candidates. Major open public spaces
  // (Boston Common, the Public Garden...) stay recognizably open: most of their lawn is left bare, a little
  // less so when the user explicitly asked for a theme. Deterministic per (seed, cell, spot).
  const keepOpen = theme.evidence.length ? OPEN_SPACE_KEEP.themed : OPEN_SPACE_KEEP.ordinary;
  const ground = candidates.filter((c) => c.surface !== 'rooftop' && !((c.open ?? 0) > OPEN_SPACE_M2 && unit(config.seed, 'open', cellKey, Math.round(c.x), Math.round(c.y)) >= keepOpen));
  const roofs = candidates.filter((c) => c.surface === 'rooftop');
  const near = (cx: number, cy: number, radius: number) => ground.filter((c) => Math.hypot(c.x - cx, c.y - cy) <= radius);
  /**
   * Visibility: in a pitched view, props in narrow street canyons are hidden by the extruded buildings.
   * Openness (clearance to the building line) biases secondary decorations toward plazas, parks and wide streets.
   */
  const openness = (c: Candidate) => Math.min(1, c.buildingClear / 14);

  // --- a) Promenades: rhythmic lines along one side of a real street/path ---
  const runs = new Map<number, Candidate[]>();
  for (const c of ground) if (c.run >= 0) { let list = runs.get(c.run); if (!list) runs.set(c.run, (list = [])); list.push(c); }
  const runList = [...runs.entries()].sort((a, b) => a[0] - b[0]);
  const linear = cast.secondary.filter((e) => FAMILIES[e.asset.family].linear);
  let promenades = 0;
  const maxPromenades = Math.round(0.3 + 1.1 * d * (1 - 0.4 * clustering));
  for (const [runId, list] of runList) {
    if (!linear.length || promenades >= maxPromenades) break;
    const open = list.reduce((s, c) => s + openness(c), 0) / list.length;
    if (next() > (0.15 + 0.3 * d) * (0.3 + 0.7 * open)) continue;
    list.sort((a, b) => a.along - b.along);
    const span = list[list.length - 1]!.along - list[0]!.along;
    if (span < 30) continue;
    const primary = choose(linear, () => true, next(), list[0]!.surface);
    if (!primary) continue;
    const alternate = next() < 0.3 ? choose(linear, (a) => a.id !== primary.asset.id, next(), list[0]!.surface) : undefined;
    const interval = (primary.asset.family === 'tree' ? 17 : primary.asset.family === 'mast' ? 26 : 22) * (1.3 - 0.3 * d) * (0.9 + 0.2 * next());
    const length = Math.min(span, 35 + 60 * next());
    const start = list[0]!.along + (span - length) * next();
    const baseSize = sizeFor(primary.asset, next()), rank = next() * 0.6;
    const group = `${cellKey}:p${runId}`;
    let placed = 0;
    for (let s = start; s <= start + length; s += interval) {
      const target = s + gaussian(next) * 1.2;
      let best: Candidate | undefined, bestD = 2.8;
      for (const c of list) { const dd = Math.abs(c.along - target); if (dd < bestD) { bestD = dd; best = c; } }
      if (!best) continue;
      const entry = alternate && placed % 2 === 1 ? alternate : primary;
      const size = (entry === primary ? baseSize : sizeFor(entry.asset, next())) * (0.94 + 0.12 * next());
      if (place(entry, best, size, 'promenade', group, rank + placed * 0.002)) placed++;
    }
    if (placed >= 2) promenades++;
  }

  // --- b) Vignettes: an anchor with a few coherent satellites ---
  const anchors = cast.secondary.filter((e) => FAMILIES[e.asset.family].anchor);
  const roomy = ground.filter((c) => c.free >= 1.6 && c.surface !== 'path_edge');
  const vignetteRate = d * (0.35 + 1.1 * clustering) * Math.min(1.5, roomy.length / 110);
  const vignettes = Math.floor(vignetteRate + next());
  const centers: Array<[number, number]> = [];
  const clusterSpacing = 55 * (1.35 - 0.5 * d);
  for (let v = 0, tries = 0; v < vignettes && tries < vignettes * 6 && anchors.length; tries++) {
    const c = pickWeighted(roomy, (k) => Math.min(6, k.free) * (0.25 + openness(k)), next());
    if (!c || centers.some(([cx, cy]) => Math.hypot(cx - c.x, cy - c.y) < clusterSpacing)) continue;
    const anchor = choose(anchors, () => true, next(), c.surface);
    if (!anchor) continue;
    const rank = next() * 0.8, group = `${cellKey}:v${v}`;
    const a = place(anchor, c, sizeFor(anchor.asset, next()), 'vignette', group, rank);
    if (!a) continue;
    centers.push([c.x, c.y]); v++;
    // Satellites share the anchor's leading motif for coherence.
    const lead = Object.entries(anchor.asset.motifs).sort((p, q) => (q[1] ?? 0) - (p[1] ?? 0))[0]?.[0];
    const palette = cast.micro.filter((e) => !lead || (e.asset.motifs as Record<string, number>)[lead]);
    const pool = palette.length ? palette : cast.micro;
    const first = pickWeighted(pool, (e) => e.weight, next()), second = next() < 0.5 ? pickWeighted(pool, (e) => e.weight, next()) : first;
    const members = 2 + Math.floor(5 * d * next());
    const ring = near(c.x, c.y, dims(anchor.asset, a.size).canopy + 10).sort((p, q) => unit(group, p.x, p.y) - unit(group, q.x, q.y));
    let added = 0;
    for (const s of ring) {
      if (added >= members || !first) break;
      const entry = added % 2 === 0 ? first : second!;
      if (place(entry, s, sizeFor(entry.asset, next()), 'vignette', group, rank + 0.001 * (added + 1), Math.atan2(c.y - s.y, c.x - s.x))) added++;
    }
  }

  // --- c) Groves: Thomas-process clumps of planting in parks ---
  const park = ground.filter((c) => c.surface === 'park');
  const groveEntries = [...cast.secondary, ...cast.micro].filter((e) => FAMILIES[e.asset.family].grove);
  const groves = Math.floor(d * (0.25 + 0.9 * clustering) * Math.min(2, park.length / 160) + next());
  for (let gi = 0; gi < groves && groveEntries.length && park.length; gi++) {
    const center = park[Math.floor(next() * park.length)]!;
    if (centers.some(([cx, cy]) => Math.hypot(cx - center.x, cy - center.y) < clusterSpacing * 0.5)) continue;
    centers.push([center.x, center.y]);
    const species = [pickWeighted(groveEntries, (e) => e.weight, next())!, pickWeighted(groveEntries, (e) => e.weight, next())!];
    const sigma = 7 + 6 * next(), members = 3 + Math.floor(6 * d * next());
    const rank = next() * 0.9, group = `${cellKey}:g${gi}`;
    const pool = near(center.x, center.y, sigma * 2.6).filter((c) => c.surface === 'park');
    let added = 0;
    for (let k = 0; k < members * 4 && added < members && pool.length; k++) {
      const c = pickWeighted(pool, (p) => Math.exp(-((p.x - center.x) ** 2 + (p.y - center.y) ** 2) / (2 * sigma * sigma)), next());
      const entry = species[next() < 0.65 ? 0 : 1]!;
      if (c && place(entry, c, sizeFor(entry.asset, next()), 'grove', group, rank + 0.001 * added, next() * Math.PI * 2)) added++;
    }
  }

  // --- d) Dispersed accents: Poisson-disk singles across the whole cell ---
  const accentEntries = cast.secondary.filter((e) => !FAMILIES[e.asset.family].linear || e.asset.family === 'tree');
  const accentSpacing = 70 * (1.3 - 0.55 * d);
  const accentTarget = Math.round(d * (1 - 0.55 * clustering) * 1.8 * Math.min(1.5, ground.length / 160) + next() * 0.6);
  // Weighted random order (Efraimidis–Spirakis) favouring open, visible spots.
  const orderKey = (c: Candidate) => Math.pow(Math.max(1e-9, unit(config.seed, cellKey, 'acc', c.x, c.y)), 1 / (0.2 + openness(c)));
  const order = [...ground].sort((a, b) => orderKey(b) - orderKey(a));
  const accents: Array<[number, number]> = [...centers];
  let accentsPlaced = 0;
  for (const c of order) {
    if (accentsPlaced >= accentTarget || !accentEntries.length) break;
    if (accents.some(([ax, ay]) => Math.hypot(ax - c.x, ay - c.y) < accentSpacing)) continue;
    const entry = choose(accentEntries, () => true, unit(config.seed, cellKey, 'ae', c.x, c.y), c.surface);
    if (entry && place(entry, c, sizeFor(entry.asset, next()), 'accent', `${cellKey}:a${accentsPlaced}`, next())) { accents.push([c.x, c.y]); accentsPlaced++; }
  }

  // --- e) Micro details: sparse benches, planting, lights along walkways ---
  const detailTarget = Math.round(d * 5 * Math.min(1.5, ground.length / 150));
  let details = 0;
  for (const c of order.slice().reverse()) {
    if (details >= detailTarget || !cast.micro.length) break;
    if (unit(config.seed, cellKey, 'det', c.x, c.y) > 0.25) continue;
    const entry = choose(cast.micro, () => true, unit(config.seed, cellKey, 'de', c.x, c.y), c.surface);
    if (entry && place(entry, c, sizeFor(entry.asset, next()), 'detail', `${cellKey}:d${details}`, 0.3 + next() * 0.7)) details++;
  }

  // --- f) Rooftops: skyline accents with a few companions on the same roof ---
  const roofSecondary = cast.secondary.filter((e) => FAMILIES[e.asset.family].surfaces.includes('rooftop'));
  const roofMicro = cast.micro.filter((e) => FAMILIES[e.asset.family].surfaces.includes('rooftop'));
  const roofTarget = Math.round(d * (0.5 + 0.8 * (1 - 0.5 * clustering)) * Math.min(1.5, roofs.length / 80) + next() * 0.6);
  const roofKey = (c: Candidate) => Math.pow(Math.max(1e-9, unit(config.seed, cellKey, 'roof', c.x, c.y)), 1 / (0.3 + Math.min(1, (c.z ?? 0) / 60)));
  const roofSpacing = 30 * (1.3 - 0.4 * d), roofAnchors: Array<[number, number]> = [];
  for (const c of [...roofs].sort((a, b) => roofKey(b) - roofKey(a))) {
    if (roofAnchors.length >= roofTarget || !roofSecondary.length) break;
    if (roofAnchors.some(([ax, ay]) => Math.hypot(ax - c.x, ay - c.y) < roofSpacing)) continue;
    // Seen from above, bulk reads and thin posts vanish: weight rooftop accents by measured footprint.
    const entry = pickWeighted(roofSecondary, (e) => e.weight * (0.25 + 2.5 * e.asset.radiusRatio), next());
    const group = `${cellKey}:r${roofAnchors.length}`, rank = next() * 0.85;
    if (!entry || !place(entry, c, sizeFor(entry.asset, next()), 'rooftop', group, rank)) continue;
    roofAnchors.push([c.x, c.y]);
    const companion = roofMicro.length ? pickWeighted(roofMicro, (e) => e.weight, next()) : undefined;
    let added = 0;
    for (const s of roofs) {
      if (!companion || added >= 1 + Math.floor(2 * d * next())) break;
      if (Math.abs((s.z ?? 0) - (c.z ?? 0)) > 1 || Math.hypot(s.x - c.x, s.y - c.y) > 9) continue;
      if (place(companion, s, sizeFor(companion.asset, next()), 'rooftop', group, rank + 0.001 * (added + 1))) added++;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Hero installations
// ---------------------------------------------------------------------------

export interface HeroLayout {
  readonly id: string;
  readonly slots: Readonly<Record<string, { center: readonly number[]; radius: number; placements: ReadonlyArray<{ assetId: string; position: readonly number[]; yawDegrees: number; targetMaxDimension: number }> }>>;
}

/** Layout extent in authored units (max distance of any member edge from the layout origin). */
export function layoutRadius(layout: HeroLayout): number {
  let r = 0;
  for (const slot of Object.values(layout.slots)) for (const p of slot.placements)
    r = Math.max(r, Math.hypot(slot.center[0]! + p.position[0]!, slot.center[2]! + p.position[2]!) + p.targetMaxDimension / 2);
  return r;
}

export interface HeroInput {
  readonly regionKey: string;
  readonly rect: Rect;
  readonly geometry: TileGeometry;
  readonly layouts: readonly HeroLayout[];
  readonly config: DecorConfig;
  /** Areas (local meters) that must stay clear, e.g. the existing set-piece stage. */
  readonly avoid?: ReadonlyArray<{ x: number; y: number; r: number }>;
}

/**
 * One hero installation per region at most, sited on verified open ground
 * (park/plaza) whose clearance from roads, buildings, paths and water covers
 * the whole authored layout. Unit scale adapts to the space (3.2–5.5 m/unit).
 */
export function composeHero(input: HeroInput): Placement[] {
  const { regionKey, rect, geometry: g, layouts, config } = input;
  if (!layouts.length) return [];
  const layout = layouts[Math.floor(unit(config.seed, regionKey, 'layout') * layouts.length)]!;
  const radius = layoutRadius(layout);
  const minUnit = 3.2, maxUnit = 5.5;
  const [x0, y0, x1, y1] = rect, step = 9;
  let best: { x: number; y: number; open: number; score: number } | null = null;
  for (let x = x0 + step / 2; x < x1; x += step) for (let y = y0 + step / 2; y < y1; y += step) {
    if (!g.areaAt('park', x, y) && !g.areaAt('plaza', x, y)) continue;
    if (g.areaAt('building', x, y) || g.areaAt('water', x, y)) continue;
    if (input.avoid?.some((a) => Math.hypot(a.x - x, a.y - y) < a.r)) continue;
    const road = g.roadClearance(x, y, 40), open = Math.min(road.own - 2, road.other - 2, g.edgeDistance('building', x, y, 40) - 3, g.edgeDistance('water', x, y, 40) - 1, g.pathClearance(x, y, 40) - 0.5, g.railDistance(x, y, 40) - 6);
    const margin = Math.min(x - x0, x1 - x, y - y0, y1 - y);
    if (open < radius * minUnit || margin < open * 0.5) continue;
    const score = open * (0.85 + 0.3 * unit(config.seed, regionKey, x, y));
    if (!best || score > best.score) best = { x, y, open, score };
  }
  if (!best) return [];
  const scaleUnit = Math.min(maxUnit, best.open / radius);
  const yaw = unit(config.seed, regionKey, 'yaw') * Math.PI * 2, cos = Math.cos(yaw), sin = Math.sin(yaw);
  const out: Placement[] = [], rank = unit(config.seed, regionKey, 'rank') * 0.2;
  for (const [slotName, slot] of Object.entries(layout.slots)) for (const p of slot.placements) {
    // Authored layout axes: X right, Z toward the viewer (south); local frame is y north.
    const lx = (slot.center[0]! + p.position[0]!) * scaleUnit, ly = -(slot.center[2]! + p.position[2]!) * scaleUnit;
    out.push({
      assetId: p.assetId, tier: 'hero', pattern: 'hero', x: best.x + lx * cos - ly * sin, y: best.y + lx * sin + ly * cos, z: 0,
      // three rotation.y = facing + π/2 (see layer.ts), so this reproduces the authored yaw on top of the layout yaw.
      facing: yaw + (p.yawDegrees * Math.PI) / 180 - Math.PI / 2, size: p.targetMaxDimension * scaleUnit, base: p.targetMaxDimension * scaleUnit * 0.5,
      surface: 'open_ground', rank, group: `${regionKey}:hero:${layout.id}:${slotName}`,
    });
  }
  return out;
}
