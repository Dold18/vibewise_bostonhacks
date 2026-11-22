import { describe, expect, it } from 'vitest';
import { basePalette, buildMapStyle } from '../../../mapStyle';
import { ALL_SLOTS, PIXEL_RATIO, SLOT_SIZE, paintPlan, surfaceLayers, textureSpecs } from '../layers';
import { deriveSurfaceRecipe } from '../recipe';
import { scene, WORLDS } from './fixtures';

const base = buildMapStyle(basePalette);
const baseIds = base.layers.map((l) => l.id);
const paintOf = (l: unknown) => ((l as { paint?: Record<string, unknown> }).paint ?? {}) as Record<string, unknown>;

describe('surface layers', () => {
  const defs = surfaceLayers();

  it('anchor directly above an existing base layer or an earlier surface layer', () => {
    const known = new Set(baseIds);
    for (const { layer, after } of defs) {
      expect(known.has(after), `${layer.id} anchors on missing ${after}`).toBe(true);
      known.add(layer.id);
    }
  });

  it('streets follow the exact base road widths (real street geometry, not a screen overlay)', () => {
    const pairs: Array<[string, string]> = [['ws-road-service', 'road-service'], ['ws-road-minor', 'road-minor'], ['ws-road-secondary', 'road-secondary'], ['ws-road-primary', 'road-primary'], ['ws-road-motorway', 'road-motorway']];
    for (const [ws, b] of pairs) {
      const mine = defs.find((d) => d.layer.id === ws)!.layer;
      const theirs = base.layers.find((l) => l.id === b)!;
      expect(paintOf(mine)['line-width']).toEqual(paintOf(theirs)['line-width']);
      expect((mine as { filter?: unknown }).filter).toEqual((theirs as { filter?: unknown }).filter);
      expect((mine as { 'source-layer'?: string })['source-layer']).toBe('transportation');
    }
  });

  it('never patterns water, buildings or labels; roads and parks use different slots', () => {
    for (const { layer } of defs) {
      const sl = (layer as { 'source-layer'?: string })['source-layer'];
      expect(['water', 'waterway', 'building', 'water_name', 'place']).not.toContain(sl);
      expect(layer.type).not.toBe('symbol');
    }
    const pattern = (id: string) => JSON.stringify(Object.entries(paintOf(defs.find((d) => d.layer.id === id)!.layer)).find(([k]) => k.endsWith('-pattern'))?.[1]);
    expect(pattern('ws-road-minor')).not.toBe(pattern('ws-green-park'));
    expect(pattern('ws-walk')).not.toBe(pattern('ws-road-minor'));
    expect(pattern('ws-ground')).not.toBe(pattern('ws-green-park'));
  });

  it('only references fixed slot images', () => {
    const slots = new Set(ALL_SLOTS.map((s) => s.id));
    for (const { layer } of defs) {
      for (const [k, v] of Object.entries(paintOf(layer))) {
        if (!k.endsWith('-pattern')) continue;
        const names = typeof v === 'string' ? [v] : JSON.stringify(v).match(/ws-tex-[a-z0-9-]+/g) ?? [];
        for (const n of names) expect(slots.has(n), n).toBe(true);
      }
    }
  });

  it('updates never touch patterns, filters or layout (no tile re-layout on a world change)', () => {
    for (const w of WORLDS) {
      for (const p of paintPlan(deriveSurfaceRecipe(scene([[w, 1]])))) {
        expect(p.property.endsWith('-pattern')).toBe(false);
        expect(p.property).not.toMatch(/filter|dasharray|gap-width/);
        expect(defs.some((d) => d.layer.id === p.layer)).toBe(true);
      }
    }
  });

  it('texture specs fit their slots exactly (in-place updateImage needs a constant size)', () => {
    for (const w of WORLDS) {
      for (const [slot, spec] of textureSpecs(deriveSurfaceRecipe(scene([[w, 1]])))) {
        const kind = ALL_SLOTS.find((s) => s.id === slot)!.kind;
        expect([spec.width, spec.height, spec.pixelRatio]).toEqual([...SLOT_SIZE[kind], PIXEL_RATIO]);
      }
    }
  });

  it('a neutral scene sets every surface opacity to 0', () => {
    for (const p of paintPlan(deriveSurfaceRecipe(scene([['neutral', 1]])))) if (p.property.endsWith('opacity')) expect(p.value).toBe(0);
    expect(textureSpecs(deriveSurfaceRecipe(null)).size).toBe(0);
  });
});
