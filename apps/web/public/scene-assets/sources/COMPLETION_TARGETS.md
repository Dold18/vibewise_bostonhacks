# Vibenta Scene Asset Library — Completion Gate v2

**Date:** 2026-11-21  
**Status:** procurement and design targets; none of the 3D props are enabled in the map yet

## Current verified GitHub inventory

| Asset inventory | Actual stored | Status |
|---|---:|---|
| Original v1 SVG effects/textures | 33 | Static vectors, not wired to renderer |
| Original v2 SVG atlas variants | 192 | Twelve 4×4 atlases, not wired |
| Original KayKit glTF models | 40 | Source byte integrity verified; visual/scale QA pending |
| Additional converted CC0 GLB models | **160** | 160/160 byte-identical to pinned third-party source Git blobs; QA pending |
| **Total stored 3D models** | **200** | **No 3D set pieces rendered** |
| **Total SVG + 3D items/variations** | **425** | Not interchangeable; 192 SVGs are atlas cells |
| Completed, placement-tested thematic installations | **0** | Concept recipes exist, but not composed |
| Further independently curated external GLB candidates | 40 | **NOT downloaded/imported**; overlaps possible |
| Source-pack leads | 55 | Metadata only, not downloadable runtime objects |
| Proposed context+vibe combinations | 28 | Conceptual recipes, not prebuilt geometry |

### New import specifics
- `../third-party/modelibr/manifest.v1.json`: **160** CC0 GLB models from **15** self-contained source packs, totaling **8,234,864 bytes (7.85 MiB)**. Formats are already single-file binary glTF.
- `../third-party/modelibr/gallery.html`: searchable thumbnail index for these 160 imported files. Thumbnails load externally from an upstream pinned revision; actual GLBs are stored in this repository.
- Official creator categories: Kenney Food/Fantasy/Graveyard/Nature/Holiday/Arcade/Market/Furniture/Pirate/Retro/City; Quaternius Sushi/Junk Food/Cyberpunk; The Base Mesh instrumental props.
- All 160 imported GLBs' Git blob SHAs and byte lengths match the conversion repository. Model headers were checked for GLB magic/version 2 during import.
- These are *publisher-derived converted models*. Compare their source creator pages and CC0 terms before production; do not claim they are original, unconverted publisher files.
- **Remaining QA:** model dimensions, orientation, visual correctness, missing textures, triangle counts, GLB structural validation, browser rendering, memory/graphics cost, touch device profiles, licensing snapshots.

## Stopping target before Scene Composer implementation

A credible broad initial library should have:

1. **250–350 distinct 3D props**, centered around **300**. With **200 now imported**, that is **50–150 more** (roughly **100 more** to hit 300). Do not count format copies, source links or thumbnails.
2. **30–50 reusable *actual composite installations*** with measured transforms, bounds, visual themes and navigation-safe behavior. Currently zero built. The previously proposed 28 compositions do not count.
3. **250–350 SVG/material/effect variations**; currently 225 generated. Aim for better cover across lighting, road material, atmospheric effects; do not add redundant swatches solely to increase the count.
4. Broad **cuisine** coverage: at least 20 families with several truly identifiable motif options, not only generic bowls/restaurant furniture.
5. Broad **music** coverage: at least 15 high-value genres with a recognizable array of relevant instruments/venue props/stage equipment. Current music props have a piano, acoustic guitar, pan flute, drum stick, violin bow and assorted stage supports, but are **insufficient** for jazz, EDM, rock, salsa, etc. in isolation.
6. At least 10 atmosphere-only motifs for a user's vibe when no genre/cuisine is selected (e.g. haunted, romantic, futuristic, playful, calm, moody, nostalgic).
7. Complete provenance, verified source and license, search tags, model origin, dimensions/anchor, GPU budget, collision footprint, preview QA, fallback and reduced-motion metadata for every active asset.

**Do not use 300 as an automatic trigger if the thematic coverage or QA criteria are not met.** Content breadth and selection quality outweigh raw model counts.

## Highest-value remaining procurement

| Priority | Gap | Suggested focus |
|---|---|---|
| 1 | **Music performance** | Complete guitar/drum/keyboard kits, saxophone, brass, DJ decks, mixers, microphones, regional percussion and disco installation props |
| 2 | **Distinct cuisines** | Korean barbecue, pho, banh mi, Thai dishes, Ethiopian injera, Indian thali/naan, Middle Eastern mezze, Greek dishes; robust Italian meal set |
| 3 | **Cultural care and specificity** | Only select cuisine/genre/holiday motifs for explicitly chosen or verified venue contexts; avoid generic cultural stereotypes |
| 4 | **Composite installations** | Build 30–50 stylized hero+accent bundles from already acquired models, with safe placement and a coherent visual language |
| 5 | **Visual coherence** | Make mixed Kenney, Quaternius, KayKit and The Base Mesh assets consistent via material/palette style normalization and device-appropriate LOD |

## Per-model acceptance checklist

- [ ] Actually imported, unique by semantic role, and licensed for the contemplated use (not merely sourced)
- [x] Source bytes match the referenced Git blob **for the 200 imported assets** (separate verification for KayKit and Modelibr imports)
- [ ] Actual GLB/glTF structural validation, renderability and texture/UV check
- [ ] Approved thumbnail/preview and consistent styling
- [ ] Measured scale, pivot, orientation, bounding box, triangle count, texture weight and draw calls
- [ ] Mobile/laptop/Safari performance budget
- [ ] Navigation overlays, selected venue, stations and attribution remain fully accessible
- [ ] Safe reduced-motion and focus-mode fallback
- [ ] No false statements about real venue features, food menus or performances

Once these criteria and composition coverage are met, begin the Scene Composer. Continue the library in targeted small updates afterward if real scene tests reveal gaps.
