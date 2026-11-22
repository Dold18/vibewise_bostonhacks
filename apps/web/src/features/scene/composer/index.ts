/**
 * Universal procedural scene composer. Pure: no MapLibre, DOM, Gemini or network.
 *
 *   const driver = createComposerDriver({ session, sessionId, capabilities: MAP_RENDERER_V1, assets, assetIndex });
 *   driver.update({ mood: ['cozy'], music: ['jazz'], timeOfDay: 'night', progression: { answers: 3 } });
 *   driver.getPlan();   // CityRenderPlan derived from the session's SceneState
 *   driver.undo();      // exact restoration
 */
export { AXES, type Axis, type StyleVector, type Pull } from './axes';
export { interpretSignals, tokenize, confidenceFor, TIMES_OF_DAY, type CompositionSignals, type Interpretation, type Term, type TimeOfDay, type VenueContext } from './signals';
export { SLOTS, SLOT_BY_ID, combinationCount, EMPHASIS_SUBSYSTEMS, type Component, type Slot, type Subsystem } from './components';
export { VALUE_TAGS, EXCLUSIVE, tagsOf, tagConflicts } from './tags';
export { harmonyFor, paletteHarmony, valueSample, hueFit, type Harmony, type Scheme } from './harmony';
export { composeWorld, COMPOSER_VERSION, VARIATION, STICKY_MARGIN, type Composition, type Assignment, type Pick, type ArchitectureParams, type DecorIntent } from './compose';
export { encodeComposition, PRESET_ANCHORS, type Encoding, type EncodeOptions } from './encode';
export { checkCoherence, activeValues, type CoherenceReport, type Violation } from './coherence';
export { buildAssetTagIndex, resolveDecor, contextualInstallation, FAMILY_TAGS, RESTRICTED_TAGS, type AssetTagIndex, type DecorPlan } from './decor';
export { deriveCityPlan, validatePlan, CITY_PLAN_SCHEMA, type CityRenderPlan, type PlanSection } from './plan';
export { createComposerDriver, connectComposer, signalsFromProfile, type ComposerDriver, type ComposerUpdate, type ProfileExtras } from './driver';
export { seedForSession, unit, prng, shuffled } from './random';
