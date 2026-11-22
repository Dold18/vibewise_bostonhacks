import { describe, expect, it } from 'vitest';
import { CatalogError, parseCatalog, SCENE_CATALOG } from '../catalog';
import raw from '../data/scene-effect-catalog.v1.json';
import { docsCatalog } from './fixtures';

const clone = () => JSON.parse(JSON.stringify(raw));
const problemsOf = (json: unknown) => {
  try {
    parseCatalog(json);
    return [];
  } catch (e) {
    expect(e).toBeInstanceOf(CatalogError);
    return (e as CatalogError).problems;
  }
};

describe('scene catalog v1', () => {
  it('runtime copy is identical to the design catalog in docs/', () => {
    expect(raw).toEqual(docsCatalog());
  });

  it('has the documented size: 16 systems, 178 settings, 828 variations', () => {
    expect(SCENE_CATALOG.groups).toHaveLength(16);
    expect(SCENE_CATALOG.settings).toHaveLength(178);
    expect(SCENE_CATALOG.settings.reduce((n, s) => n + s.values.length, 0)).toBe(828);
    expect(SCENE_CATALOG.byKey.size).toBe(178);
  });

  it('locks navigation safety and camera groups against model edits', () => {
    const locked = SCENE_CATALOG.groups.filter((g) => !g.aiSelectable).map((g) => g.id);
    expect(locked.sort()).toEqual(['camera_and_perspective', 'navigation_safe']);
  });

  it('every default is one of its values', () => {
    for (const s of SCENE_CATALOG.settings) expect(s.values).toContain(s.default);
  });

  it('collects every problem in a broken catalog instead of stopping at the first', () => {
    const bad = clone();
    bad.groups[0].settings[0].default = 'not_a_value';
    bad.groups[0].settings[1].values.push(bad.groups[0].settings[1].values[0]);
    bad.groups[1].settings[0].tier = 'magic';
    delete bad.groups[1].settings[1].allowIntensity;
    bad.groups[2].settings.push({ ...bad.groups[2].settings[0] });
    const problems = problemsOf(bad);
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/default is not one of its values/),
        expect.stringMatching(/values has duplicates/),
        expect.stringMatching(/tier is invalid/),
        expect.stringMatching(/allowIntensity must be boolean/),
        expect.stringMatching(/duplicate setting key/),
      ]),
    );
  });

  it('rejects non-objects, missing groups and malformed ids', () => {
    expect(problemsOf(null)).toEqual(['catalog is not an object']);
    expect(problemsOf({ schemaVersion: '1.0.0', runtimePolicy: { aiOverrideLimit: 12, maxWeightedPresets: 3 }, groups: [] })).toEqual([
      'groups must be a non-empty array',
    ]);
    const bad = clone();
    bad.groups[0].id = 'Has Spaces';
    bad.schemaVersion = 'v1';
    expect(problemsOf(bad)).toEqual(expect.arrayContaining(['schemaVersion must be a semver string', 'groups[0].id is missing or malformed']));
  });
});
