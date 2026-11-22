/** City engine: SceneState → CityPlan → independent section renderers. See README.md. */
export * from './contracts';
export { createCityEngine, type CityEngine, type CityEngineOptions, type CityEngineStats, type RendererStats, type RendererStatus } from './engine';
export { baselinePlanner, enforcePolicy, releasedPlan, NAVIGATION_POLICY, planHash } from './plan';
export { sectionOf, settingId, DECORATION_ANCHORS } from './routing';
export { allocateBudget, clampBudget, overBudget, TIER_BUDGETS, DEFAULT_SHARES, RESOURCE_KEYS } from './budget';
export { createAssetResolver } from './assets';
export { createRandom, hashSeed, subSeed, toSeed, unitHash } from './seed';
export { residualState } from './legacyBridge';
export { cityRenderers, cityPlanner } from './registry';
