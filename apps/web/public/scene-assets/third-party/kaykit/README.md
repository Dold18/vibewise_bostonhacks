# Vibenta — Imported official KayKit CC0 3D models

**120 distinct 3D model files imported** from official [KayKit (Kay Lousberg)](https://github.com/KayKit-Game-Assets) repositories. These are actual tracked `.gltf` files with their original matching `.bin` files, pack-specific palette PNG and original CC0 license, not just candidate download links.

| Pack subfolder | Models | Potential use |
|---|---:|---|
| `halloween-bits` | 16 | Gothic, haunted, autumn, mystery |
| `restaurant-bits` | 29 | Food objects, prepared dishes, market produce, general dining |
| `furniture-bits` | 18 | Cozy café, reading, lounge, date-night ambience |
| `city-builder-bits` | 18 | Urban street elements and fictional building dioramas |
| `space-base-bits` | 9 | Futuristic, sci-fi, experimental |
| `medieval-props` | 14 | Festival stalls, rustic accents, fantasy markets |
| `medieval-nature` | 12 | Illustrated landscapes, stylized trees/rocks/mountains |
| `medieval-buildings` | 4 | Rustic stage modules and fictional installation fences |
| **Total** | **120** | |

## Import integrity
- Source repository Git blob SHA compared to destination Git blob SHA for **256 individual files** (120 glTF + 120 BIN + 8 PNG palettes + 8 CC0 license copies).
- **256/256 matched; no mismatches.**
- External buffer and texture names were checked at import for the original 40 models; **80 newly added models still require full glTF JSON dependency auditing**.
- No visual mesh review, pivot/scale inspection, conversion to optimized GLB, browser rendering, draw-call or mobile performance tests have yet been performed.

Every model is still marked `imported_not_rendered` in the authoritative [manifest.v1.json](manifest.v1.json). Treat objects as decorative props only and never misrepresent them as real buildings, road changes, venue interiors, or live weather. Avoid placing objects on map routes, station/destination pins or attribution.

## Still outstanding
The broader [55-pack source inventory](../../sources/thematic-packs.v1.json), [40 individual external food/music GLB candidates](../../sources/curated-3dassets.v1.json) and [scene completion targets](../../sources/COMPLETION_TARGETS.md) are separate: sourced or planned items are **not included in the imported 120**. Cuisine-specific 3D objects (pho, dim sum, Korean barbecue, thali, pizza/pasta and more) and music props (sax, drums, DJ gear, guitars etc.) are still priority gaps; generic restaurant/market/set dressing is not a substitute.

In eventual Scene Composer implementation, display only a curated context hero and optional complementary ambient accent, with focus-mode suppression and reduced-motion fallback.
