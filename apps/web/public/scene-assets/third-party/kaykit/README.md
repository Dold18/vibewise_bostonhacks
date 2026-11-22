# Vibenta — Official KayKit CC0 3D models

**40 actual imported models** from five official [KayKit](https://github.com/KayKit-Game-Assets) repositories. Not the same as the additional 40 exact-named `3DAssets.dev` candidates, which are still in the download queue.

| Source family | Models | Main thematic uses |
|---|---:|---|
| Halloween Bits | 6 | Haunted, gothic, mysterious |
| Restaurant Bits | 14 | Dining, comfort food, generic café props |
| Furniture Bits | 8 | Cozy cafés, lounges, listening environments |
| City Builder Bits | 8 | Stylized urban, retro, nightlife |
| Space Base Bits | 4 | Sci-fi, futuristic, whimsical |
| **Total** | **40** | |

Each model retains **original `.gltf` + matching `.bin`**. Each pack also retains its own original `LICENSE.txt` and a shared PNG palette texture. Models use external dependencies; preserve relative filenames when developing with Three.js/GLTFLoader or converting to GLB. Their original provenance and stable IDs are stored in [manifest.v1.json](manifest.v1.json).

**Integrity audit:** all **90 tracked source files** (40 glTF files, 40 binary buffers, five texture PNGs and five license files) have matching Git blob SHA identifiers against the publisher's original GitHub repositories. All 40 model glTF files had their buffer/texture dependency names checked during import. No mismatches reported.

**QA not yet done:** actual scene visual previews, renderer connection, device performance, model scale/pivot assessment, mesh complexity optimization and GLB conversion. The 40 models are *stored assets*, not working scene effects.

## Intended design

The asset system should combine independent **cuisine**, **music genre**, **venue context**, **occasion**, and **vibe** tags. The two optional set-piece slots should be:
1. One context-specific focal installation (e.g. food setup or music equipment).
2. One complementary atmospheric accent (e.g. foliage, light or surreal prop).

Keep fictional props visibly illustrative and never state or imply the actual physical venue has them. In navigation/focus mode, protect labels, real road/building shapes, destination pins, station icons, walking/transit legs, attribution and click targets. Prefer hiding decorative props to obscuring safe route information.

**Next gap:** cuisine- and genre-specific hero objects. Generic dining props do not count as completed Italian, Thai, Ethiopian, Chinese or other cuisine kits; furniture and city props do not count as rock/jazz/EDM instruments. Continue acquiring visually reviewed per-model GLBs from the [curated 3DAssets list](../../sources/curated-3dassets.v1.json) and additional legitimate CC0 suppliers.
