// Procedural street, pavement and terrain surfaces. See README.md.
export { deriveSurfaceRecipe, neutralRecipe, presenceOf, scoreAffinities, ROAD_MATERIALS, WALK_MATERIALS, GROUND_MATERIALS, GREEN_MATERIALS, type SurfaceAppearance, type SurfaceRecipe, type SurfaceOverrides, type RoadMaterial, type WalkMaterial, type GroundMaterial, type GreenMaterial } from './recipe';
export { mountSurfaces, effectiveRecipe, beforeIdAfter, type SurfaceMap, type SurfaceRenderer, type SurfaceRendererOptions, type SurfaceStats, type NavigationMode } from './renderer';
export { connectSurfaces, type AppearanceSource } from './connect';
export { withSurfaceCapabilities, surfaceValues, SURFACE_KEYS } from './capabilities';
export { surfaceLayers, paintPlan, textureSpecs, SLOTS, SURFACE_LAYER_IDS } from './layers';
export { paintTexture, GRAIN_FOR, type TextureSpec, type TextureImage, type GrainMap, type GrainSet } from './textures';
export { loadGrains } from './grains';
