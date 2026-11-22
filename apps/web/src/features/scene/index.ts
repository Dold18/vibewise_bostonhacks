/** Scene Composer: pure compiler (phase 1) and session (phase 2). No map, DOM, Gemini or network access. */
export { compileScene, COMPILER_VERSION, type CompileInput } from './compile';
export { sanitizeIntent, SCENE_SCHEMA_VERSION, type SceneIntent, type SceneOverride, type WeightedPreset, type Diagnostic } from './intent';
export { PRESETS, PRESET_IDS, type ScenePresetId, type ScenePreset } from './presets';
export { PALETTE_ADAPTER_V0, SCENE_ADAPTER_V1_PROPOSED, previewAllCapabilities, withFeatures, type CapabilityProfile, type SceneFeature } from './capabilities';
export { buildAssetRegistry, type AssetRegistry, type ManifestInput } from './assets';
export { presetsFromDescriptors, presetsFromVibeTags, sceneWords } from './lexicon';
export { diffScene, type SceneState, type SceneContext, type SceneDiff } from './state';
export { SCENE_CATALOG, parseCatalog, CatalogError, type SceneCatalog, type SceneKey } from './catalog';
export { createSceneSession, type SceneSession, type SceneSessionOptions, type SceneUpdate, type SubmitResult, type UpdateReason } from './session';
export { connectProfiles, intentFromProfile, presenceFor, type OutingProfileLike, type ProfileSource, type ProfileSubmission } from './profiles';
