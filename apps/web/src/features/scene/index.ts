/** Scene Composer, phase 1: the pure compiler. No map, DOM or network access. */
export { compileScene, COMPILER_VERSION, type CompileInput } from './compile';
export { sanitizeIntent, SCENE_SCHEMA_VERSION, type SceneIntent, type SceneOverride, type WeightedPreset, type Diagnostic } from './intent';
export { PRESETS, PRESET_IDS, type ScenePresetId, type ScenePreset } from './presets';
export { PALETTE_ADAPTER_V0, SCENE_ADAPTER_V1_PROPOSED, previewAllCapabilities, type CapabilityProfile } from './capabilities';
export { buildAssetRegistry, type AssetRegistry, type ManifestInput } from './assets';
export { presetsFromDescriptors, presetsFromVibeTags } from './lexicon';
export { diffScene, type SceneState, type SceneContext, type SceneDiff } from './state';
export { SCENE_CATALOG, parseCatalog, CatalogError, type SceneCatalog, type SceneKey } from './catalog';
