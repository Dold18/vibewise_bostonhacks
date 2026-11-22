# Vibenta Scene Asset Library — Current Completion Gate

**Last verified:** November 21, 2026  
**Branch:** `assets/scene-procedural-pack-v1` (PR #33, draft)  
**Scope:** asset procurement, static layouts, standalone QA tools. **Not the Scene Composer.**

## GitHub-resident inventory

| Asset class | Stored on branch | Evidence / restrictions |
| --- | ---: | --- |
| Original SVG v1 effects and textures | 33 | Procedural vector only; not renderer-connected |
| Original SVG v2 atlas cells | 224 | 14 four-by-four atlases, including 16 food and 16 music motifs |
| KayKit CC0 glTF models | 120 | Original glTF, BIN, texture and license files |
| Modelibr converted CC0 GLB models | 192 | Source SHA / import byte integrity checked; author and license caveats recorded |
| **3D model files** | **312** | 120 + 192 distinct model entries, no duplicate-format inflation |
| **2D plus 3D items / variants** | **569** | Heterogeneous items, not 569 independently renderable world assets |
| Authored two-slot compositions | **40** | 30 existing recipes plus 10 new recipes, 147 placed references |
| Unique model IDs referenced by compositions | **91** | All ID references resolve to imported files |

A full PR branch Git tree pass checked **312/312** model paths, GLB file byte sizes and Git blob IDs where declared, **zero mismatches**; all **40/40** compositions reference imported models. This is a source/integrity audit **not** browser rendering QA.

## Library feature coverage

- 20 dining/cuisine families and 19 music genres have explicit readiness records in `coverage-readiness.v1.json`.
- Cuisine: 8 specific, 1 partial, 4 generic-compatible, **7 atmosphere-only**.
- Music: 4 partial, 10 generic-compatible, **5 atmosphere-only**; no genre should be described as visually complete purely because an instrument-related asset exists.
- New motifs add illustrated piano keys, sax, trumpet, turntable, microphone, headphones, sushi, noodle bowls, grill, dumpling and other food/music **2D decorations**. These are original illustrations, not 3D instrument models.
- Higher-quality Korean BBQ, Indian, Thai, Vietnamese, Ethiopian, Greek and Middle Eastern cuisine props, as well as brass instruments / drum kits / DJ rigs, remain procurement leads. These must not be fabricated or treated as already imported.

## Two-slot composition contract

`third-party/composites/layouts.v1.json` now defines:

- `hero_installation`: one primary context display.
- `ambient_accent`: one optional complementary vibe display.
- Explicit model IDs, local preview transforms, yaw, per-prop normalized span, center, slot radius, palette and activation policy.
- Fictional decorations only. Do not claim these structures, dishes, instruments or performances are features of real Boston venues.
- Explicit/user-verified contexts for cuisine or music and special opt-in for observances.
- Hide both slots if they cover pins, walking/MBTA routes, stops, map labels, attributions or interaction areas; always hide in navigation/focus mode.
- No audio autoplay. Respect reduced motion. Lazy-load selected assets only.

The two display slots are **not yet anchored in actual MapLibre world coordinates**. Their positions in the JSON and gallery are authored *preview units* and must be reconciled with map interaction and camera policies during the Scene Composer phase.

## Local acceptance run

From the repository root:

```bash
node scripts/validate-scene-assets.mjs
node scripts/validate-scene-layouts.mjs
cd apps/web && npm install && npm run dev
```

Open in the Vite browser:

- `/scene-assets/third-party/modelibr/gallery.html` — source-thumbnail inventory.
- `/scene-assets/third-party/composites/gallery.html` — actual GLB/glTF two-slot 3D layout preview, with orbit controls and a browser-local visual-inspection export.
- `/scene-assets/v2/gallery.html` — 2D atlas visual preview.

The 3D composition preview imports pinned Three.js dependencies over the internet; it is standalone QA tooling and is **not connected to the production map or the quiz**. Approve individual arrangements only after visually checking them. The export is a review record, not proof of mobile GPU behavior.

## Handoff status

**Procurement target met** (312 3D files, 257 2D variants, 40 authored layouts). **Not yet fully production-approved:** source verification has been completed, but no local end-to-end build, runtime 3D visual inspection, texture/UV validation, ground-contact/occlusion QA, Safari/mobile profiling or 40-scene human signoff has been performed in this tooling environment.

The Scene Composer architecture can proceed using stable IDs, strict capability gating and the 40 authored layouts. **Do not enable arbitrary automatic 3D installations on the live map until the standalone previews and visibility checks pass.** When niche cuisine or music props are missing, prefer atmosphere-only changes rather than unsupported cultural motifs.

## Historical note

Earlier sections of this file tracked 208 or 288 models, 225 SVG variants and 30 unassembled recipes. Those numbers are superseded by the current inventory above. Missing visual QA is **not** superseded.
