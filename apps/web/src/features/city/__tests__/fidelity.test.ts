/**
 * Composition fidelity against the live City Changer capability profile:
 * how much of what the composer intends actually reaches the drawn scene.
 */
import { describe, expect, it } from 'vitest';
import { SCENE_CATALOG } from '../../scene/catalog';
import { assetCapabilities } from '../../scene/runtime';
import { runtimeAssets } from '../../scene/registry';
import { composeWorld } from '../../scene/composer/compose';
import { encodeComposition } from '../../scene/composer/encode';
import { BUILDING_VALUES } from '../buildings/appearance';
import { createStreetRenderer } from '../streets';
import { createAtmosphereRenderer } from '../atmosphere';
import { sectionOf } from '../routing';
import type { CapabilityProfile } from '../../scene/capabilities';

/** The profile `city.capabilities()` composes in the live app: base asset theme plus every renderer's claims. */
export function liveProfile(): CapabilityProfile {
  const base = assetCapabilities(false);
  const values = new Map(base.values);
  const claims = [BUILDING_VALUES, createStreetRenderer({} as never).capabilities.values ?? {}, createAtmosphereRenderer({} as never).capabilities.values ?? {}];
  for (const c of claims) for (const [k, v] of Object.entries(c)) values.set(k, new Set(v));
  return Object.freeze({ id: 'live-city', values, features: new Set([...base.features, 'set_piece_3d' as never]) });
}

export const VIBES = [
  'nostalgic warm jazz evening', 'futuristic synthwave arcade', 'haunted but romantic', 'peaceful botanical afternoon',
  'bright playful outing', 'cozy rainy bookstore atmosphere', 'dark cinematic noir', 'energetic but intimate', 'ramen and dumplings',
];

function measure(text: string, catalog = SCENE_CATALOG) {
  const composition = composeWorld({ text: [text], progression: { answers: 6 } }, '424242', { catalog });
  const enc = encodeComposition(composition, { version: 0, capabilities: liveProfile(), catalog, assets: runtimeAssets });
  const lost: Record<string, number> = {};
  for (const u of enc.unrealized) lost[sectionOf(u.key) ?? 'base'] = (lost[sectionOf(u.key) ?? 'base'] ?? 0) + 1;
  return { fidelity: enc.fidelity, drawn: enc.renderableFidelity, lost, coherent: enc.coherence.ok };
}

describe('composition fidelity on the live City Changer profile', () => {
  it('realizes nearly all of every composed world (composer override budget), coherently', () => {
    const rows: string[] = [];
    let before = 0, after = 0;
    for (const v of VIBES) {
      const old = measure(v, { ...SCENE_CATALOG, composerOverrideLimit: SCENE_CATALOG.aiOverrideLimit });
      const now = measure(v);
      before += old.drawn;
      after += now.drawn;
      rows.push(`${v.padEnd(34)} drawn ${old.drawn.toFixed(2)} → ${now.drawn.toFixed(2)}  all ${old.fidelity.toFixed(2)} → ${now.fidelity.toFixed(2)}  lost ${JSON.stringify(now.lost)}`);
      expect(now.coherent, v).toBe(true);
      expect(now.drawn, v).toBeGreaterThanOrEqual(0.95);
      expect(now.fidelity, v).toBeGreaterThanOrEqual(0.95);
    }
    console.log(`${rows.join('\n')}\nmean drawn ${(before / VIBES.length).toFixed(3)} → ${(after / VIBES.length).toFixed(3)}`);
    expect(after).toBeGreaterThan(before);
  }, 60_000);
});
