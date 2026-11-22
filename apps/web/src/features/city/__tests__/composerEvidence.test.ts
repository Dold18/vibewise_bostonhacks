import { describe, expect, it } from 'vitest';
import { createCityComposer } from '../composer';
import { createSceneSession } from '../../scene/session';
import { previewAllCapabilities } from '../../scene/capabilities';
import { SCENE_CATALOG } from '../../scene/catalog';
import type { ComposerProfileLike } from '../../scene/composer/driver';
import { runtimeAssets } from './helpers';

function setup() {
  const capabilities = previewAllCapabilities(SCENE_CATALOG);
  const session = createSceneSession({ capabilities, assets: runtimeAssets });
  const composer = createCityComposer({ session, capabilities: () => capabilities, assets: runtimeAssets, seed: () => 42 });
  let listener!: (profile: ComposerProfileLike | null) => void;
  composer.connect({ subscribe(fn) { listener = fn; return () => {}; } });
  const publish = (version: number, text: string, qualifiers = ['haunted', 'christmas'], evidence: ComposerProfileLike['evidence'] = []) => listener({
    sessionId: 'real-quiz', version, originalInput: { text }, qualifiers, evidence,
  });
  const themes = () => session.getState().context?.themeEvidence ?? [];
  return { session, composer, publish, themes };
}

describe('profile provenance at the City Composer boundary', () => {
  it('model-derived qualifiers can shape style but cannot authorize themed objects', () => {
    const { publish, themes } = setup();
    publish(1, 'Jazz and candlelight');
    expect(themes()).toEqual([]);
  });

  it('accepted explicit answer evidence authorizes only its own theme', () => {
    const { publish, themes } = setup();
    publish(1, 'A quiet bookstore', ['christmas'], [{ text: 'A haunted bookstore', polarity: 'want' }]);
    expect(themes()).toEqual(['spooky|haunted|answer']);
  });

  it('undo and reseed preserve the same permission boundary', () => {
    const { publish, composer, themes } = setup();
    publish(1, 'Haunted but romantic', ['christmas']);
    const original = [...themes()];
    publish(2, 'Jazz and candlelight', ['christmas', 'haunted']);
    expect(themes()).toEqual([]);
    composer.undo();
    expect(themes()).toEqual(original);
    expect(original).toEqual(['spooky|haunted|vibe']);
    composer.reseed();
    expect(themes()).toEqual(original);
  });
});
