# Vibenta — Scene Composer and Visual Effects Registry (design v1)

> **Status: proposal only.** No renderer/AI calls were implemented in this PR. Review with map owner and vibe owner before changing executable contracts.
>
> **Machine-readable option library:** [scene-effect-catalog.v1.json](scene/scene-effect-catalog.v1.json)  
> Catalog size: **16 systems, 178 settings and 828 named enum variations** at initial authoring. A setting can also have a continuous blend/intensity in the compiler, so this isn't a finite list of every possible aesthetic.  
> **Critical:** Foundation tier means the existing style/effects primitives could support that *type* of control, not that every option is already implemented.

## 1. Product intent

After each response to the adaptive vibe quiz, the current outing has a progressively refined preference embedding/facet profile and newly ranked real Boston places. A Scene Composer maps that snapshot into a coherent **full** visual state. The map then transitions that state in place, rather than reloading style, clearing markers or disrupting walking/MBTA routes.

For example, "cinematic rain-soaked nocturnal city, but intimate and warm enough to talk" yields:
- a restrained midnight/slate scene with violet highlights;
- cool ambient light paired with selected warm building surfaces;
- controlled mist and simulated wet pavement;
- strong visibility for the selected venue and its transit path;
- persistent actual street geometry, real building height and legitimate place IDs.

**Do not interpret "change architecture" as constructing fictitious physical features on real buildings.** Standard MapLibre extrusions can recolor/shade; detailed façades, roofs, windows, reflections and ornamental geometry require a separately developed, clearly stylized custom rendering layer. A stylized lighting overlay must not imply actual window occupancy, venue signage, live weather or other observed conditions.

## 2. The two representations: compact AI intent, exhaustive resolved state

**AI chooses the artistic direction and a few high-value overrides. The deterministic compiler chooses coherent values for every property.**

Asking an LLM to fill all 178 settings each turn would be expensive, produce contradictory palettes, and create brittle validation. Instead:

```ts
type ScenePresetId =
  | "neutral" | "amber_refuge" | "noir_nocturne" | "neon_city" | "dream_pastel"
  | "sunlit_coast" | "woodland_story" | "underground_indie"
  | "retro_atlas" | "minimal_modern"; // ratified 2026-11-21, versioned independently

interface SceneOverride {
  /** Must match group.id + "." + setting.id in the versioned JSON registry. */
  key: string;
  /** One of that setting's documented values. */
  value: string;
  /** Optional 0..1 semantic intensity; only for applicable visual parameters. */
  intensity?: number;
}

interface SceneIntent {
  schemaVersion: "1.0.0";
  sessionVersion: number;                 // quiz snapshot version
  presets: Array<{ id: ScenePresetId; weight: number }>;  // max 3
  descriptors: string[];                  // user-friendly, not executable code
  overrides: SceneOverride[];            // suggest 0..12, not all 178
}

interface CompleteSceneState {
  schemaVersion: "1.0.0";
  sessionVersion: number;
  resolved: Record<string, string>;      // exactly one valid value per all 178 keys
  strengths: Record<string, number>;     // effective 0..1 where meaningful
  disabled: Array<{ key: string; reason: string }>; // unavailable capability/safety
  palette: Record<string, string>;       // specific validated map tokens
  effects: Array<{ kind: string; opacity: number }>;
  markerStyle: Record<string, unknown>;
  uiTokens: Record<string, string>;
}
```

A full SceneState is generated **locally** from the stable registry and presets. The model never writes raw RGB strings outside accepted design tokens, JavaScript, shaders, arbitrary CSS, map style expressions, HTML, freeform geographic coordinates, provider URLs, or marker IDs. A descriptive phrase like "rainy streets" is an input *to the scene system*, not an instruction to actually fetch weather.

### Example model output after a quiz answer

```json
{
  "schemaVersion": "1.0.0",
  "sessionVersion": 7,
  "presets": [
    {"id": "noir_nocturne", "weight": 0.48},
    {"id": "neon_city", "weight": 0.32},
    {"id": "amber_refuge", "weight": 0.20}
  ],
  "descriptors": ["moody", "rain-lit", "intimate", "cinematic"],
  "overrides": [
    {"key": "sky_and_horizon.sky_mode", "value": "purple_twilight"},
    {"key": "lighting_and_shadows.light_color", "value": "amber", "intensity": 0.55},
    {"key": "roads_and_ground.wet_sheen", "value": "subtle", "intensity": 0.40},
    {"key": "air_and_atmosphere.fog_volume", "value": "whisper", "intensity": 0.28},
    {"key": "marker_recommendations.pin_glow", "value": "warm_halo"}
  ]
}
```

The resulting complete state fills the other 173 property choices through preset defaults, blending, constraints and capability fallback. No requirement exists to enumerate them in the LLM response.

## 3. Catalog organization

Every setting has `id`, `type`, `default`, `values`, `tier`, and a group-level `renderer`. The JSON can be parsed and validated in CI, and TypeScript types can later be generated from it. It isn't yet imported by runtime code.

| System ID | What it controls |
|---|---|
| `global_grade` | Palette family, hue bias, saturation, contrast, warmth, film-grade |
| `sky_and_horizon` | Sky, cloud illustration, horizon, stars, celestial accents |
| `lighting_and_shadows` | Color, direction, intensity, edge light, pools, bloom |
| `building_surfaces` | Roof/wall palette, gradients, façade illusions, windows, trim |
| `roads_and_ground` | Roads, paths, casings, illustrative material, wetness |
| `natural_land` | Parks, foliage, terrain shading, season cues |
| `water_and_coast` | Water color, waves, sheen, mist and stylized reflections |
| `air_and_atmosphere` | Fog, particles, rain/snow visuals, grain, vignette |
| `cinematic_and_artistic` | Watercolor, print, blueprint, ink, screen effects |
| `camera_and_perspective` | Framing, pitch preference, zoom, reveal/easing |
| `marker_recommendations` | Pins, scaling, halo, match emphasis, clusters |
| `neighborhood_and_places` | Venue spotlights, nearby-building accents, local atmosphere |
| `text_and_labels` | Font treatment, hierarchy, halo, cartographic density |
| `interface_and_cards` | Overlay panel, cards, controls and color tokens |
| `animation_and_morph` | Timing, stagger, ambient movement, map morph |
| `navigation_safe` | **Protected, non-AI-editable rules**: contrast, routes, stops, attribution |

The catalog deliberately includes some future variations (e.g. animated façade lights, physically convincing water reflections) so the state vocabulary is extensible. They MUST fall back to available effects until implemented; never report them as active.

### Implementation tier definitions

- **`foundation`**: Can be expressed with existing palette/paint/light/sky/CSS/DOM foundations. Some individual variations still need implementation or mapping.
- **`extension`**: Requires dedicated MapLibre layers, additional data, new DOM/CSS overlays, font provisioning, or graphics work but no major 3D engine.
- **`custom`**: Requires custom WebGL/Three.js (or comparable shader/mesh), properly licensed assets and substantial QA.
- **Capability registry (separate):** Runtime must track *actual implemented/loaded* capabilities; tier alone is **not** a capability test. E.g. `building_surfaces.window_pattern` remains disabled until a custom renderer exists.

## 4. Runtime selection and compilation pipeline

```text
Quiz answer
    → vibe profile (semantic vector + structured facets, positive/negative)
    → verified place similarity / ranking
    → SceneIntent (AI-selected; or local deterministic fallback)
    → validate against versioned registry
    → resolve preset defaults + guarded overrides + intensity
    → normalize palette, scene layers, marker controls
    → clip to capabilities + motion budget + label/transit constraints
    → compare with previous SceneState (avoid redundant updates)
    → update MapLibre existing layers + optional overlays + marker DOM
```

**Important:** The same quiz call can return both a structured vibe interpretation and `SceneIntent` if the API is already generating questions. But the map must **not depend** on a successful LLM response: if it fails or arrives late, compile directly from the structured facets and current candidate rankings.

Design question: supply the model with `SceneIntent` schema + preset summaries + **small, relevant subset** of allowed override IDs, not the entire 828-option catalog in every request. Fetch full registry locally in app/code. This keeps inference cost reasonable.

## 5. Compiler precedence and conflict resolution

Precedence is **hard safety > active navigation/focus > active outing intent > signed-in saved taste > neutral**.

1. **Navigation invariants are locked**: accessible street names and attribution; route and walk geometry/leg colors; station labels; selected destination; map interaction hit targets.
2. **Focus mode** controls pin visibility (selected and route-relevant only), focus darkness and the chosen route's emphasis. The underlying session vibe still supplies lighting temperature and scene language.
3. **Current outing** overrides the signed-in user's cumulative account taste after every question, including for signed-out visitors.
4. **Saved account taste** provides an initial scene only when no active outing exists.
5. **Neutral map** is safe fallback if vibes/assets are unavailable.

**Incompatibilities** should be resolved by deterministic rules:
- Daylight `sky_mode` with `starfield=dense`: drop stars or deliberately switch to a twilight/night sky if model explicitly prioritized stars.
- Dark-night palette with dark labels: switch to approved light label palette with contrast-tested halos.
- Dense fog with an active route: reduce to subtle peripheral haze and protect transit/walk lines.
- Heavy rain and snow simultaneously: pick dominant weather-like visual; never claim it is actual weather.
- HDR-like bloom + film grain + frequent particles on mobile: budget effects and degrade gracefully.
- Strong smooth camera changes while user is manually panning: cancel automatic camera motion.
- `camera_shake`: always disabled for actual navigation and under reduced-motion preference.
- A soft vibe effect must not change actual building footprint, height, road geometry, route direction, stop location or verified event state.
- Local venue glow requires a grounded catalog place ID; missing geometry → harmless pin halo fallback.

## 6. Interaction rhythm, smoothness and cost

- The quiz can ask up to **10** questions, but the map should visibly respond with small, meaningful changes after each answer.
- Keep semantic changes distinct: an extra hint of nostalgia shouldn't trigger a violent full-map palette switch.
- Start with scene changes around **600–1000 ms**, reusing current style's existing 800 ms transition as a reasonable default. Reduced-motion mode cuts this back.
- Use hysteresis or a small update threshold for discrete preset switching; interpolate continuously changing tokens.
- Only update color/paint properties that changed; **do not call `map.setStyle()` on every answer**.
- Retain current map camera/pitch unless user requests a reveal; don't hijack touch panning.
- Update markers in place by stable place ID. The current `main.ts` recreates all markers on `showPlaces()`; ranking-specific updates need a stable-ID incremental path.
- Cache scene compilations by `schemaVersion + intentHash + capabilityProfile`. Skip no-op transitions.
- `sessionVersion` is mandatory: stale AI/embedding responses must not apply older state after a newer answer.
- Each custom effect needs device/performance fallback (low, medium, high), visibility gating, reduced-motion behavior, and teardown to prevent leaks.
- Don't waste model tokens listing all settings after every click; compute a full state locally.

## 7. Existing MapLibre implementation touchpoints

The source files below were inspected on `main` (they may differ on `develop`, which is being reconciled):
- `apps/web/src/mapStyle.ts`: `basePalette`, `buildMapStyle(palette)`, colorized 3D extrusions, light, sky, and 800 ms paint transition.
- `apps/web/src/features/vibeTheme/palettes.ts`: ten curated palette anchors (cozy, lively, upscale, divey, aesthetic, quiet, date_night, group_friendly, late_night, outdoor).
- `apps/web/src/features/vibeTheme/blend.ts`: blends anchors with readability/contrast guards.
- `apps/web/src/features/vibeTheme/apply.ts`: computes changed paint values and applies `map.setPaintProperty()`; intentionally preserves runtime layers and depth-related opacity.
- `apps/web/src/features/vibeTheme/effects.ts` and `effects.css`: map-canvas atmospheric effects, but overlays can visually tint the route below them and must be suppressed/reworked for navigation legibility.
- `apps/web/src/features/vibeTheme/controller.ts`: listens to the account store; **currently account-history-driven**, not current quiz session-driven.
- `apps/web/src/main.ts`: marker objects can currently be recreated, rather than smoothly restyled by stable place ID.

**Compatibility plan:** derive `SceneIntent` from the quiz session; compile through a new pure scene module; pass a validated render target through an approved adapter to the **map owner's** existing `vibeTheme` controller. Do not modify map/transit files from the vibe workstream without coordination.

MapLibre documentation:
- Style specification and layers: https://maplibre.org/maplibre-style-spec/layers/
- Light: https://maplibre.org/maplibre-style-spec/light/
- Sky: https://maplibre.org/maplibre-style-spec/sky/
- Map paint API: https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/
- Custom layers: https://maplibre.org/maplibre-gl-js/docs/API/interfaces/CustomLayerInterface/

Do **not** copy Mapbox GL JS-only flood-light/emissive APIs into a MapLibre 6 implementation unless support is independently verified; their specifications are not interchangeable.

## 8. Suggested module and contracts once approved

These paths are **proposals only**:
- `apps/web/src/features/scene/catalog.ts`: typed parsed catalog and strict validator.
- `apps/web/src/features/scene/presets.ts`: curated archetype recipes backed by palette/lighting/atmosphere definitions.
- `apps/web/src/features/scene/compile.ts`: pure `compileScene(intent, capabilities, navigationState, accountTheme?)` that fills every key and resolves conflicts.
- `apps/web/src/features/scene/sceneState.ts`: immutable, versioned session snapshots and diffing.
- `apps/web/src/features/scene/scoreToScene.ts`: deterministic no-LLM fallback and feature-weights mapper.
- `apps/web/src/features/scene/__tests__/...`: pure unit tests.
- Map-owner adapter: integrates into the existing `vibeTheme` controller (no second map renderer).
- Vibe-owner adapter: produces `SceneIntent` without changing `Place` or routing contracts.

### Questions for the implementation owners to agree on
1. ~~Which initial preset IDs are ratified beyond the ten *account-level vibe tags*?~~ **Resolved 2026-11-21:** the ten IDs above are ratified (nine aesthetics plus `neutral`). Preset names describe an aesthetic, never an unverified venue feature (hence `noir_nocturne`, not `noir_jazz`: music- or cuisine-specific props need verified context). Do not conflate account taste with ephemeral current-outing scene.
2. Which visual options are actually implemented by the first runtime release? Build a feature detection table—not guesses.
3. How do we normalize/balance semantically conflicting adjectives and user constraints?
4. Which effects should be disabled during transit directions or focus mode?
5. Do we want stylistic 3D material illusions from custom shaders now, or defer them until recommendation ranking reliably works?

## 9. Acceptance and validation

**Catalog tests**
- JSON version parses and all `group.id.setting.id` keys are unique.
- Each default belongs to that option's allowed values; enum arrays contain no duplicates.
- Every setting has a valid tier/renderer; navigation-safe settings reject AI overrides.
- Unknown preset/setting/value/intensity is rejected or safely dropped, with a logged diagnostic but no crash.
- Old catalog state is migrated by explicit version or falls back to neutral.

**Scene compiler tests**
- A full `SceneState` contains precisely one resolved value per catalog property.
- The same intent and capability profile produces byte-for-byte stable SceneState.
- Active outing overrides account theme; focus and route safety take precedence.
- Unsupported window/reflection effects degrade to existing building shading.
- Warm cozy and dark neon example intents create visibly different base/sky/building colors.
- Reversing a quiz answer reproduces the correct earlier state, not an accumulated approximation.
- Stale asynchronous response cannot revert newer scene.
- No accidental full-style replacement, route clearing, marker click loss or place-ID changes.
- At 10 quiz answers, no leaks, no stale animations, and acceptable interaction frame rates on representative mobile/laptop.

**Manual visual checks**
- Legibility on light/dark/fog scenes; especially walking dashes, train stops, transfer markers, street names, water/park boundaries and attribution.
- Focus mode's darkened map is still discernible and rail/walk paths remain clearly separated.
- Motion effects respect `prefers-reduced-motion`; never autoplay audio or pretend stylized weather is a live forecast.
- Compare screenshots with existing current-map baseline, not a fabricated 'implemented' illustration.

## 10. Release stages

**MVP A (most value):** full registry parser, 8–12 supported controls, 6 scene presets, compile and diff state; active outing overrides account; smooth existing palette, sky, building color, light and DOM pin changes.

**MVP B:** 25–40 validated controls across atmospheric overlays, street/surface tones, localized venue halos, UI styling, motion; navigation/focus guards and runtime performance budgets.

**Advanced C:** richer scene props, custom texture layers, illustrated façades, realistic-looking reflections, interactive lighting and advanced 3D effects where appropriately sourced assets and browser performance permit.

A large catalog is valuable as an expressive *design vocabulary*; do not turn 178 incomplete settings into 178 brittle special cases in the first implementation.
