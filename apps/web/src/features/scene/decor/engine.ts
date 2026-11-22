/**
 * World decoration engine: distributes themed imported models across the
 * visible Boston map, world-anchored, from reusable procedural rules.
 *
 *   SceneState ──deriveTheme──▶ motifs/gates/strength ──selectCast──▶ cast
 *   z14 tiles ──surfaceCandidates──▶ safe spots per z17 cell ──composeCell──▶ placements (cached)
 *   placements ──venue/route/LOD/budget filters──▶ instances ──▶ instanced WebGL layer
 *
 * Placement is a pure function of (seed, theme, config, map data); the camera
 * only decides which cells are composed and which instances are shown.
 */
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { AssetRegistry } from '../assets';
import type { SceneState } from '../state';
import { createModelLoader } from '../modelLoader';
import { buildDecorCatalog, themeAllowed, themesOfModel, type AssetMetrics, type DecorCatalog, type Family, type Tier } from './catalog';
import { composeCell, composeHero, selectCast, type Cast, type HeroLayout, type Placement } from './compose';
import { DEFAULT_CONFIG, PERFORMANCE_BUDGETS, placementKey, resolveConfig, type DecorConfig, type DecorConfigInput } from './config';
import {
  CELL_ZOOM, SOURCE_ZOOM, cellRect, latFromMercator, lngFromMercator, mercatorX, mercatorY, parentTile, tileAt, tileKey, toLocal,
  type TileFrame, type TileGeometry, type TileId,
} from './geometry';
import { createDecorLayer, prototypeOf, type Prototype, type WorldInstance } from './layer';
import { surfaceCandidates, type Candidate, type Surface } from './surfaces';
import { createTileSource, type TileSource } from './tiles';
import { deriveTheme, type DecorTheme } from './themes';

export interface Exclusion { readonly lng: number; readonly lat: number; readonly radius?: number }

interface LoaderLike { load(id: string): Promise<import('three').Object3D>; retain(ids: Set<string>): void; stats(): { cached: number; loads: number }; destroy(): void }

export interface WorldDecorOptions {
  readonly assets: AssetRegistry;
  readonly metrics: Readonly<Record<string, AssetMetrics>>;
  readonly config?: DecorConfigInput;
  /** Destination pins etc. Decorations keep `venueClearance` away (never implying venue features). */
  readonly exclusions?: () => readonly Exclusion[];
  /** GeoJSON sources holding route lines to keep clear (navigation also hides everything). */
  readonly routeSources?: readonly string[];
  readonly basemapSource?: string;
  readonly layoutContext?: ReadonlyMap<string, string>;
  /** Existing set-piece staging spots [lng, lat]: heroes stay away while a set piece is active. */
  readonly stage?: ReadonlyArray<readonly [number, number]>;
  readonly tileSource?: TileSource;
  readonly loader?: LoaderLike;
  readonly onError?: (error: unknown) => void;
}

interface Located extends Placement { readonly mx: number; readonly my: number; readonly mpu: number; readonly key: string }

const TIER_ORDER: Record<Tier, number> = { hero: 0, secondary: 1, micro: 2 };
/** Longest the old decorations wait for the new set's models before swapping anyway. */
const PRELOAD_CAP_MS = 1500;
/** Leaving models are released after their exit animation (decor layer EXIT_MS) has played. */
const PRUNE_AFTER_MS = 800;
const GLOWING: ReadonlySet<Family> = new Set(['light', 'small_light', 'festoon']);
/** Hero-layout lighting props are not in the scatter catalog; recognise them by manifest name. */
const GLOW_NAME = /lantern|lightpost|light_|lights|lamp|candle/;
/** Yield to input/rendering between cells without waiting a whole animation frame. */
const yieldTask = () => new Promise<void>((r) => setTimeout(r, 0));

export function mountWorldDecor(map: MapLibreMap, options: WorldDecorOptions) {
  const catalog: DecorCatalog = buildDecorCatalog({ modelIds: options.assets.models, metrics: options.metrics });
  let config: DecorConfig = resolveConfig(DEFAULT_CONFIG, options.config);
  const source = options.basemapSource ?? 'openmaptiles';
  const tiles = options.tileSource ?? createTileSource({ template: () => tileTemplate(map, source) });
  const loader: LoaderLike = options.loader ?? createModelLoader(options.assets);
  const layer = createDecorLayer(map, { minZoom: config.lod.minZoom });
  const prototypes = new Map<string, Prototype>(), loading = new Map<string, Promise<void>>(), failed = new Set<string>();
  const candidateCache = new Map<string, Candidate[]>(), placementCache = new Map<string, Placement[]>(), heroCache = new Map<string, Placement[]>();
  const errors: string[] = [];
  let latest: SceneState | null = null, theme: DecorTheme | null = null, cast: Cast | null = null;
  let run = 0, dead = false, timer: ReturnType<typeof setTimeout> | undefined;
  let pruneTimer: ReturnType<typeof setTimeout> | undefined;
  let shown: Located[] = [], generated: Located[] = [], culled = { lod: 0, budget: 0, venue: 0, route: 0, hero: 0, loading: 0, unauthorized: 0 };
  let timing = { refreshMs: 0, composeMs: 0, cells: 0, regions: 0, tiles: 0, candidates: 0 };
  let explicitHidden = false, timerPending = false, current: Promise<void> = Promise.resolve();

  const fail = (error: unknown) => { errors.push(String(error)); if (errors.length > 20) errors.shift(); options.onError?.(error); };

  function updateTheme() {
    const next = deriveTheme(latest, options.assets, config.theme, options.layoutContext);
    const castChanged = !theme || next.key !== theme.key;
    theme = next;
    layer.setReducedMotion(next.reducedMotion);
    if (latest) layer.setLighting(latest.lighting.color, latest.lighting.intensity);
    layer.setGlow(glowLevel(), prototypes.values());
    if (castChanged) cast = selectCast(catalog, next, effectiveConfig());
  }
  /** Performance context tightens the budget; it never loosens an explicit config. */
  function effectiveConfig(): DecorConfig {
    const perf = PERFORMANCE_BUDGETS[theme?.performance ?? 'medium'];
    const budget = { maxInstances: Math.min(config.budget.maxInstances, perf.maxInstances * 2), maxTriangles: Math.min(config.budget.maxTriangles, perf.maxTriangles * 2), maxAssets: Math.min(config.budget.maxAssets, perf.maxAssets + 6), maxDrawCalls: Math.min(config.budget.maxDrawCalls, perf.maxDrawCalls + 20) };
    return theme?.performance === 'low' ? { ...config, budget, tiers: { ...config.tiers, micro: false } } : { ...config, budget };
  }

  /** Dark palettes (by the realized land luminance) light the lanterns; daylight keeps a faint warmth. */
  function glowLevel() {
    const land = latest?.palette.land;
    if (!land || !/^#[0-9a-f]{6}$/i.test(land)) return latest?.darkMode ? 0.85 : 0.15;
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(land.slice(i, i + 2), 16) / 255);
    const luminance = 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    return luminance < 0.3 ? 0.85 : luminance < 0.55 ? 0.45 : 0.15;
  }

  function schedule(delay = 90) {
    if (dead) return;
    clearTimeout(timer); timerPending = true;
    timer = setTimeout(() => { timerPending = false; void start(); }, delay);
  }
  function start() { current = refresh().catch(fail); return current; }
  /** Resolves once no refresh is pending or running and every needed model has loaded (tests, QA). */
  async function settled() {
    for (let i = 0; i < 200 && !dead; i++) {
      const run0 = run, p = current;
      await p; await Promise.all(loading.values());
      if (!timerPending && run0 === run && p === current && !loading.size) return;
      if (timerPending) await new Promise((r) => setTimeout(r, 50));
    }
  }

  /** z17 cells under a grid of screen samples, nearest first, within the secondary range. */
  function viewCells(rangeMeters: number): TileId[] {
    const canvas = map.getCanvas(), w = canvas.clientWidth, h = canvas.clientHeight, center = map.getCenter();
    const keys = new Map<string, { cell: TileId; dist: number }>();
    for (let i = 0; i <= 10; i++) for (let j = 0; j <= 8; j++) {
      const p = map.unproject([(w * i) / 10, (h * j) / 8]);
      const dist = metersBetween(center.lng, center.lat, p.lng, p.lat);
      if (!Number.isFinite(dist) || dist > rangeMeters) continue;
      const cell = tileAt(p.lng, p.lat, CELL_ZOOM);
      // Include immediate neighbours so cells partially on screen are composed too.
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const c = { z: CELL_ZOOM, x: cell.x + dx, y: cell.y + dy }, k = tileKey(c);
        const n = 2 ** CELL_ZOOM, cd = metersBetween(center.lng, center.lat, lngFromMercator((c.x + 0.5) / n), latFromMercator((c.y + 0.5) / n));
        if (cd <= rangeMeters + 160 && (!keys.has(k) || keys.get(k)!.dist > cd)) keys.set(k, { cell: c, dist: cd });
      }
    }
    return [...keys.values()].sort((a, b) => a.dist - b.dist).map((v) => v.cell).slice(0, 72);
  }

  function locate(frame: TileFrame, p: Placement): Located {
    const mx = frame.originX + p.x / frame.metersPerUnit, my = frame.originY - p.y / frame.metersPerUnit;
    return { ...p, mx, my, mpu: frame.metersPerUnit, key: `${p.group}:${p.assetId}:${Math.round(p.x * 10)}:${Math.round(p.y * 10)}` };
  }

  async function refresh() {
    const token = ++run;
    if (dead) return;
    const started = performance.now();
    if (!theme) updateTheme();
    const zoom = map.getZoom();
    const hidden = explicitHidden || !theme || theme.hidden || theme.strength * config.density < 0.04 || zoom < Math.min(config.lod.minZoom.hero, config.lod.minZoom.secondary) - 0.25;
    if (hidden) { shown = []; generated = []; apply(); return; }
    // Zooming out widens the range per level; zooming into a pitched view still shows the city far
    // beyond the center, so the range shrinks only gently above z16.
    const cfg = effectiveConfig(), pk = placementKey(cfg), zoomScale = zoom >= 16 ? 2 ** ((16 - zoom) * 0.45) : 2 ** (16 - zoom);
    const range = (tier: Tier) => cfg.lod.range[tier] * zoomScale;
    const cells = viewCells(range('secondary'));
    const sourceTiles = new Map<string, TileId>();
    for (const c of cells) { const t = parentTile(c, SOURCE_ZOOM); sourceTiles.set(tileKey(t), t); }
    const geometries = new Map<string, TileGeometry | null>();
    await Promise.all([...sourceTiles].map(async ([k, t]) => geometries.set(k, await tiles.get(t))));
    if (token !== run || dead) return;

    const composeStart = performance.now();
    let budgetStart = performance.now(), candidatesTotal = 0;
    const all: Located[] = [];
    for (const cell of cells) {
      const sourceTile = parentTile(cell, SOURCE_ZOOM), geometry = geometries.get(tileKey(sourceTile));
      if (!geometry) continue;
      const ck = tileKey(cell);
      let candidates = candidateCache.get(ck);
      if (!candidates) { candidates = surfaceCandidates(geometry, cellRect(geometry.frame, cell)); candidateCache.set(ck, candidates); trim(candidateCache, 400); }
      candidatesTotal += candidates.length;
      const pkey = `${ck}|${cast!.key}|${pk}`;
      let placements = placementCache.get(pkey);
      if (!placements) { placements = composeCell({ cellKey: ck, rect: cellRect(geometry.frame, cell), candidates, cast: cast!, theme: theme!, config: cfg }); placementCache.set(pkey, placements); trim(placementCache, 600); }
      for (const p of placements) all.push(locate(geometry.frame, p));
      // Stay responsive: yield after ~12 ms of composition.
      if (performance.now() - budgetStart > 12) { await yieldTask(); if (token !== run || dead) return; budgetStart = performance.now(); }
    }

    // Hero installations: one per z15 region at most, near the end of discovery.
    const heroes: Located[] = [], heroSites: Array<{ mx: number; my: number; r: number }> = [];
    let regions = 0;
    if (cfg.tiers.hero && theme!.progress >= cfg.heroProgress && theme!.heroLayouts.length && zoom >= cfg.lod.minZoom.hero) {
      const layouts = theme!.heroLayouts.map((id) => options.assets.layouts.get(id)).filter((l): l is NonNullable<typeof l> => !!l?.slots) as unknown as HeroLayout[];
      const regionTiles = new Map<string, TileId>();
      for (const c of viewCells(range('hero'))) { const r = parentTile(c, 15); regionTiles.set(tileKey(r), r); }
      // Nearest regions first; stop at maxHeroes and keep heroes minSpacing.hero apart.
      const regionCenter = (r: TileId) => { const n = 2 ** r.z; return metersBetween(map.getCenter().lng, map.getCenter().lat, lngFromMercator((r.x + 0.5) / n), latFromMercator((r.y + 0.5) / n)); };
      const ordered = [...regionTiles].sort((a, b) => regionCenter(a[1]) - regionCenter(b[1]));
      const maxHeroes = Math.max(0, Math.round(cfg.maxHeroes * Math.min(1, cfg.density + 0.4)));
      for (const [rk, region] of ordered) {
        if (heroSites.length >= maxHeroes) break;
        const sourceTile = parentTile(region, SOURCE_ZOOM);
        let geometry = geometries.get(tileKey(sourceTile));
        if (geometry === undefined) { geometry = await tiles.get(sourceTile); geometries.set(tileKey(sourceTile), geometry); if (token !== run || dead) return; }
        if (!geometry) continue;
        regions++;
        const avoid = latest?.setPiece ? (options.stage ?? []).map(([lng, lat]) => { const [x, y] = toLocal(geometry!.frame, lng, lat); return { x, y, r: 160 }; }) : [];
        const hk = `${rk}|${cfg.seed}|${theme!.heroLayouts.join(',')}|${avoid.length}`;
        let hero = heroCache.get(hk);
        if (!hero) { hero = composeHero({ regionKey: rk, rect: cellRect(geometry.frame, region), geometry, layouts, config: cfg, avoid }); heroCache.set(hk, hero); trim(heroCache, 64); }
        const located = hero.map((p) => locate(geometry!.frame, p));
        if (located.length) {
          const cx = located.reduce((s, p) => s + p.mx, 0) / located.length, cy = located.reduce((s, p) => s + p.my, 0) / located.length;
          if (heroSites.some((h) => Math.hypot(h.mx - cx, h.my - cy) * located[0]!.mpu < cfg.minSpacing.hero)) continue;
          const r = Math.max(...located.map((p) => Math.hypot(p.mx - cx, p.my - cy) * p.mpu + p.size * 0.6));
          heroSites.push({ mx: cx, my: cy, r });
        }
        heroes.push(...located);
      }
    }
    const composeMs = performance.now() - composeStart;
    generated = [...heroes, ...all];

    // --- Filters: hero footprint, venues, routes, LOD, budget --------------
    const center = map.getCenter(), cmx = mercatorX(center.lng), cmy = mercatorY(center.lat);
    const exclusions = (options.exclusions?.() ?? []).map((e) => ({ mx: mercatorX(e.lng), my: mercatorY(e.lat), r: e.radius ?? cfg.venueClearance }));
    const routes = routeSegments();
    culled = { lod: 0, budget: 0, venue: 0, route: 0, hero: 0, loading: 0, unauthorized: 0 };
    const survivors: Array<Located & { dist: number }> = [];
    // Last line of defense: nothing renders whose meaning nobody asked for (neutral details, explicitly
    // requested themes, or the members of an authorized set piece).
    const authorized = (id: string) => theme!.gates.activatedIds.has(id) || themeAllowed(catalog.assets.get(id)?.themes ?? themesOfModel(id), theme!.gates.themes);
    for (const p of generated) {
      if (!authorized(p.assetId)) { culled.unauthorized++; continue; }
      if (p.tier !== 'hero' && heroSites.some((h) => Math.hypot(p.mx - h.mx, p.my - h.my) * p.mpu < h.r + p.base)) { culled.hero++; continue; }
      if (exclusions.some((e) => Math.hypot(p.mx - e.mx, p.my - e.my) * p.mpu < e.r + p.base)) { culled.venue++; continue; }
      if (routes.some(([ax, ay, bx, by]) => segmentDistance(p.mx, p.my, ax, ay, bx, by) * p.mpu < 14 + p.base)) { culled.route++; continue; }
      const dist = Math.hypot(p.mx - cmx, p.my - cmy) * p.mpu, limit = range(p.tier);
      if (zoom < cfg.lod.minZoom[p.tier] || dist > limit || p.rank > 1.05 - 0.6 * (dist / limit) ** 2) { culled.lod++; continue; }
      survivors.push({ ...p, dist });
    }
    survivors.sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || a.rank - b.rank || a.dist - b.dist);
    let tris = 0;
    const kept: Located[] = [];
    for (const p of survivors) {
      const t = options.metrics[p.assetId]?.tris ?? 2000;
      if (kept.length >= cfg.budget.maxInstances || tris + t > cfg.budget.maxTriangles) { culled.budget++; continue; }
      kept.push(p); tris += t;
    }
    const ids = new Set(kept.map((p) => p.assetId));
    timing = { refreshMs: performance.now() - started, composeMs, cells: cells.length, regions, tiles: sourceTiles.size, candidates: candidatesTotal };
    // The old decorations stay on screen until the new set's models are resident (capped, so a slow
    // model never holds the world back); then one swap: leavers shrink out while newcomers grow in.
    await preload(ids, token);
    if (token !== run || dead) return;
    shown = kept;
    await ensureModels(ids, token);
  }

  /** Load what `ids` needs without touching what is on screen. */
  async function preload(ids: Set<string>, token: number) {
    const missing = [...ids].filter((id) => !prototypes.has(id) && !failed.has(id));
    if (!missing.length) return;
    loader.retain(new Set([...ids, ...prototypes.keys()]));
    await Promise.race([Promise.all(missing.map((id) => loadModel(id, token))), new Promise((r) => setTimeout(r, PRELOAD_CAP_MS))]);
  }

  function loadModel(id: string, token: number): Promise<void> {
    let promise = loading.get(id);
    if (!promise) {
      promise = loader.load(id).then((object) => {
        const family = catalog.assets.get(id)?.family;
        const proto = prototypeOf(object, family ? GLOWING.has(family) : GLOW_NAME.test(id));
        prototypes.set(id, proto); layer.setGlow(glowLevel(), [proto]);
      })
        .catch((error) => {
          // A request retired by a newer view is not a broken model; it may be requested again.
          if (String(error).includes('retired')) return;
          failed.add(id); fail(`${id}: ${error}`);
        })
        .finally(() => { loading.delete(id); if (token === run && !dead) apply(); });
      loading.set(id, promise);
    }
    return promise;
  }

  /** Load only what is shown; retire the rest. Renders whatever is ready, re-renders as loads land. */
  async function ensureModels(ids: Set<string>, token: number) {
    apply();
    // Models that left keep their prototypes until the exit animation is over, then are released.
    clearTimeout(pruneTimer);
    pruneTimer = setTimeout(() => {
      if (dead) return;
      const keep = new Set(shown.map((p) => p.assetId));
      for (const id of [...prototypes.keys()]) if (!keep.has(id) && !loading.has(id)) prototypes.delete(id);
      loader.retain(new Set([...keep, ...loading.keys()]));
      apply();
    }, PRUNE_AFTER_MS);
    const missing = [...ids].filter((id) => !prototypes.has(id) && !failed.has(id));
    await Promise.all(missing.map((id) => loadModel(id, token)));
  }

  function apply() {
    if (dead) return;
    const visible = shown.filter((p) => prototypes.has(p.assetId));
    culled.loading = shown.length - visible.length;
    layer.setInstances(visible.map((p): WorldInstance => ({ key: p.key, assetId: p.assetId, tier: p.tier, mx: p.mx, my: p.my, z: p.z, facing: p.facing, size: p.size, rank: p.rank })), prototypes);
  }

  function routeSegments(): Array<[number, number, number, number]> {
    const out: Array<[number, number, number, number]> = [];
    for (const id of options.routeSources ?? []) {
      if (!map.getSource(id)) continue;
      for (const f of map.querySourceFeatures(id)) {
        const g = f.geometry;
        const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
        for (const line of lines) for (let i = 0; i + 1 < line.length; i++) out.push([mercatorX(line[i]![0]!), mercatorY(line[i]![1]!), mercatorX(line[i + 1]![0]!), mercatorY(line[i + 1]![1]!)]);
      }
    }
    return out;
  }

  const onMoveEnd = () => schedule();
  map.on('moveend', onMoveEnd);

  return {
    /** Follow the Scene Session (same contract as the existing asset renderers). */
    render(state: SceneState | null) {
      latest = state;
      const before = theme?.key, hiddenBefore = theme?.hidden;
      updateTheme();
      if (theme!.hidden && !hiddenBefore) { shown = []; apply(); }
      if (theme!.key !== before || theme!.hidden !== hiddenBefore) schedule(theme!.hidden ? 0 : 60);
    },
    /** Change parameters (density, seed, tiers, clustering, budget…). */
    configure(input: DecorConfigInput) {
      config = resolveConfig(config, input);
      layer.setMinZoom(config.lod.minZoom);
      theme = null; updateTheme(); schedule(0);
    },
    setHidden(value: boolean) { explicitHidden = value; schedule(0); },
    /** Pins or routes changed outside a camera move. */
    invalidate() { schedule(150); },
    refresh: () => { clearTimeout(timer); timerPending = false; return start().then(settled); },
    settled,
    config: () => config,
    stats() { return collectStats(); },
    destroy() {
      dead = true; run++; clearTimeout(timer); clearTimeout(pruneTimer);
      map.off('moveend', onMoveEnd);
      layer.destroy(); tiles.destroy(); loader.destroy();
      prototypes.clear(); candidateCache.clear(); placementCache.clear(); heroCache.clear(); shown = []; generated = [];
    },
  };

  function collectStats() {
    const count = <K extends string>(list: readonly Located[], key: (p: Located) => K) => list.reduce<Record<string, number>>((acc, p) => { const k = key(p); acc[k] = (acc[k] ?? 0) + 1; return acc; }, {});
    const canvas = map.getCanvas(), w = canvas.clientWidth, h = canvas.clientHeight;
    const rendered = shown.filter((p) => prototypes.has(p.assetId));
    const grid = Array.from({ length: 3 }, () => [0, 0, 0]);
    const onScreen: Record<string, number> = {};
    const screenPoints: Array<{ id: string; tier: Tier; surface: string; x: number; y: number; z: number; size: number; lng: number; lat: number }> = [];
    for (const p of rendered) {
      // Locate the object where it is drawn: its mid-height, including roof altitude.
      const s = layer.project(p.mx, p.my, p.z + p.size * 0.35) ?? map.project([lngFromMercator(p.mx), latFromMercator(p.my)]);
      if (s.x < 0 || s.x >= w || s.y < 0 || s.y >= h) continue;
      onScreen[p.tier] = (onScreen[p.tier] ?? 0) + 1;
      screenPoints.push({ id: p.assetId, tier: p.tier, surface: p.surface, x: Math.round(s.x), y: Math.round(s.y), z: Math.round(p.z * 10) / 10, size: Math.round(p.size * 10) / 10, lng: lngFromMercator(p.mx), lat: latFromMercator(p.my) });
      if (p.tier === 'secondary') grid[Math.min(2, Math.floor((3 * s.y) / h))]![Math.min(2, Math.floor((3 * s.x) / w))]!++;
    }
    // Solid-body overlaps between independently placed decorations. Members of one authored hero
    // layout are excluded: the layout author positioned them together on purpose.
    const collisionPairs: string[] = [];
    let collisions = 0;
    for (let i = 0; i < rendered.length; i++) for (let j = i + 1; j < rendered.length; j++) {
      const a = rendered[i]!, b = rendered[j]!;
      if (a.tier === 'hero' && b.tier === 'hero' && a.group.split(':hero:')[0] === b.group.split(':hero:')[0]) continue;
      const d = Math.hypot(a.mx - b.mx, a.my - b.my) * a.mpu;
      if (d < a.base + b.base) { collisions++; if (collisionPairs.length < 10) collisionPairs.push(`${a.assetId}@${a.group} × ${b.assetId}@${b.group} d=${d.toFixed(2)} need=${(a.base + b.base).toFixed(2)}`); }
    }
    // Dev diagnostics: why each non-neutral decoration on screen is allowed to be there.
    const provenance = rendered.flatMap((p) => {
      const themes = catalog.assets.get(p.assetId)?.themes ?? themesOfModel(p.assetId);
      if (themes.includes('neutral')) return [];
      const motifs = catalog.assets.get(p.assetId)?.motifs ?? {};
      return [{
        assetId: p.assetId, family: catalog.assets.get(p.assetId)?.family ?? 'hero', themes,
        evidence: theme?.evidence.filter((e) => (themes as readonly string[]).includes(e.theme)) ?? [],
        setPiece: theme?.gates.activatedIds.has(p.assetId) ?? false,
        motifs: Object.fromEntries(Object.entries(motifs).filter(([m]) => (theme?.motifs as Record<string, number> | undefined)?.[m]).map(([m, w]) => [m, Math.round(w * ((theme?.motifs as Record<string, number>)[m] ?? 0) * 100) / 100])),
        tier: p.tier === 'hero' ? 'hero installation' : 'detail', surface: p.surface, pattern: p.pattern,
        lng: Math.round(lngFromMercator(p.mx) * 1e5) / 1e5, lat: Math.round(latFromMercator(p.my) * 1e5) / 1e5,
      }];
    });
    return {
      provenance,
      seed: config.seed, density: config.density, clustering: config.clustering, tiers: config.tiers,
      theme: theme && { evidence: theme.evidence, motifs: theme.motifs, strength: Math.round(theme.strength * 100) / 100, progress: theme.progress, heroLayouts: theme.heroLayouts, hidden: theme.hidden, performance: theme.performance },
      cast: cast && { secondary: cast.secondary.map((e) => e.asset.id), micro: cast.micro.map((e) => e.asset.id) },
      catalog: { eligible: catalog.assets.size, rejected: catalog.rejected.size },
      generated: { total: generated.length, byTier: count(generated, (p) => p.tier), byPattern: count(generated, (p) => p.pattern) },
      shown: { total: rendered.length, byTier: count(rendered, (p) => p.tier), byPattern: count(rendered, (p) => p.pattern), bySurface: count(rendered, (p) => p.surface as Surface), byAsset: count(rendered, (p) => p.assetId) },
      onScreen, secondaryScreenGrid: grid, screenPoints, culled, collisions, collisionPairs,
      models: { resident: prototypes.size, loading: loading.size, failed: [...failed], loader: loader.stats(), tiles: tiles.stats() },
      layer: layer.stats(), timing, errors: [...errors],
    };
  }
}

export type WorldDecor = ReturnType<typeof mountWorldDecor>;

function trim<K, V>(map: Map<K, V>, max: number) { while (map.size > max) map.delete(map.keys().next().value!); }

function metersBetween(lng1: number, lat1: number, lng2: number, lat2: number) {
  const x = ((lng2 - lng1) * Math.PI) / 180 * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180), y = ((lat2 - lat1) * Math.PI) / 180;
  return Math.hypot(x, y) * 6371008.8;
}
function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

async function tileTemplate(map: MapLibreMap, sourceId: string): Promise<string | null> {
  for (let i = 0; i < 100; i++) {
    const source = map.getSource(sourceId) as { tiles?: string[]; url?: string } | undefined;
    if (source?.tiles?.[0]) return source.tiles[0];
    if (source?.url && i > 20) {
      const json = await (await fetch(source.url)).json() as { tiles?: string[] };
      if (json.tiles?.[0]) return json.tiles[0];
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}
