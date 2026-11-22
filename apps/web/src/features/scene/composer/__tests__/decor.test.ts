import { describe, expect, it } from 'vitest';
import { MAP_RENDERER_V1, previewAllCapabilities } from '../../capabilities';
import { SCENE_CATALOG } from '../../catalog';
import { createSceneSession } from '../../session';
import { composeWorld } from '../compose';
import { contextualInstallation, RESTRICTED_TAGS } from '../decor';
import { createComposerDriver } from '../driver';
import { validatePlan } from '../plan';
import { assetIndex, registry, sweep } from './helpers';

const index = assetIndex();
const ALL = previewAllCapabilities(SCENE_CATALOG);

describe('decoration and safety', () => {
  it('draws vibe decorations only from verified, culturally neutral assets', () => {
    const session = createSceneSession({ capabilities: ALL, assets: registry() });
    const driver = createComposerDriver({ session, sessionId: 'decor', capabilities: ALL, assets: registry(), assetIndex: index });
    for (const s of sweep(60)) {
      const plan = driver.update(s).plan;
      expect(validatePlan(plan, session.getState(), index)).toEqual([]);
      for (const f of plan.decoration.families) {
        for (const id of f.assetIds) {
          expect(index.models.has(id)).toBe(true);
          expect(index.models.get(id)!.some((t) => RESTRICTED_TAGS.has(t))).toBe(false);
        }
      }
      expect(plan.decoration.contextual).toBeNull(); // no venue ⇒ no venue-specific installation
    }
  });

  it('activates a cuisine layout only from verified venue facts naming every specific word', () => {
    const verified = { placeId: 'p1', verified: true, cuisines: ['japanese', 'ramen'] };
    expect(contextualInstallation(verified, index, 's', true)).toMatchObject({ layoutId: 'japanese_ramen_noir', placeId: 'p1', rendered: true });
    expect(contextualInstallation({ ...verified, verified: false }, index, 's', true)).toBeNull();
    expect(contextualInstallation({ placeId: 'p1', verified: true, cuisines: ['japanese'] }, index, 's', true)).toBeNull();
    expect(contextualInstallation(verified, index, 's', false)!.rendered).toBe(false); // eligible, but no 3D layer
  });

  it('never infers observance or seasonal decoration from preferences', () => {
    const c = composeWorld({ mood: ['hanukkah', 'cozy', 'festive', 'winter'], cuisine: ['latkes'] }, 'obs');
    expect(c.interpretation.culturalTerms).toContain('hanukkah');
    expect(contextualInstallation(c.interpretation.venue, index, 's', true)).toBeNull();
    expect(c.assignments.some((a) => a.value === 'seasonal_icons')).toBe(false);
    expect(c.decor.families.map((f) => f.id)).not.toContain('haunted');
    // Only an explicit opt-in, or a verified seasonal fact, activates them.
    expect(contextualInstallation({ placeId: 'p', verified: false, observanceOptIn: 'Hanukkah' }, index, 's', true)?.layoutId).toBe('hanukkah_observance');
    expect(contextualInstallation({ placeId: 'p', verified: true, seasonal: 'winter' }, index, 's', true)?.layoutId).toBe('winter_festive');
    expect(contextualInstallation({ placeId: 'p', verified: false, seasonal: 'winter' }, index, 's', true)).toBeNull();
  });

  it('only offers spooky props when the user asks for them', () => {
    expect(composeWorld({ mood: ['moody', 'mysterious'], timeOfDay: 'night' }, 'm').decor.families.map((f) => f.id)).not.toContain('haunted');
    expect(composeWorld({ mood: ['spooky', 'haunted'], timeOfDay: 'night', progression: { answers: 5 } }, 'm').decor.families.map((f) => f.id)).toContain('haunted');
  });

  it('falls back safely when assets or renderer features are missing', () => {
    const session = createSceneSession({ capabilities: MAP_RENDERER_V1 });
    const driver = createComposerDriver({ session, sessionId: 'bare', capabilities: MAP_RENDERER_V1, assetIndex: null });
    const plan = driver.update({ aesthetic: ['storybook'], mood: ['whimsical'], progression: { answers: 6 }, venue: { placeId: 'p', verified: true, cuisines: ['seafood'] } }).plan;
    expect(plan.decoration.families.every((f) => f.assetIds.length === 0)).toBe(true);
    expect(plan.decoration.contextual).toBeNull();
    expect(plan.decoration.setPiece).toBeNull();
    expect(validatePlan(plan, session.getState(), null)).toEqual([]);
  });

  it('keeps navigation-safe settings locked and geometry untouched', () => {
    const session = createSceneSession({ capabilities: ALL });
    const driver = createComposerDriver({ session, sessionId: 'locks', capabilities: ALL });
    for (const s of sweep(30)) {
      driver.update(s);
      for (const setting of SCENE_CATALOG.settings.filter((x) => !x.group.aiSelectable)) expect(session.getState().resolved[setting.key]).toBe(setting.default);
      expect(driver.getPlan().safety.geometry).toBe('preserved');
    }
  });
});
