# Vibenta Scene Asset Library — Completion Gate v1

**Date:** 2026-11-21  
**Status:** planning targets, not claims that files are already production-ready

## Current verified inventory
- 225 original SVG assets/visual variants (33 v1, 192 v2 atlas tiles).
- 40 actual imported original KayKit glTF models (each with binary, shared texture and CC0 license) across five packs.
- 40 **additional** curated GLB candidates across ten external packs, **not downloaded**.
- 55 sourced pack references and 28 conceptual compositions, **not built set pieces**.
- **0** completed, tested theme-specific hero+accent scene compositions and **0** map-integrated 3D objects.

## Recommended stopping point for a broad initial product
- **250–350 curated distinct 3D objects**, counting identifiable usable meshes only, not duplicate formats, binary dependencies, textures, or catalog links.
- **30–50 curated ready-to-place composite installations**, distinct from raw models.
- **250–350 SVG/material/atmospheric asset variants** in a searchable catalog (225 already authored, but visual browser QA and actual effect capability remain separate).
- **At least 20 cuisine/dining families** with 3+ visibly recognizable prop options when appropriate; include multiple specific cuisines rather than one generic `restaurant` category.
- **At least 15 high-value music/genre families** with 3+ relevant instrumental/stage/venue props per family where music is relevant. Reuse instruments across genres; differentiate moods by lighting, composition and styling.
- **At least 10 mood-only treatments** (romantic, moody, haunted, nostalgic, futuristic, playful, quiet, energetic, natural, refined) so a user need not select cuisine or music to get a distinctive scene.
- **At least 10 venue/occasion clusters**: café, fine dining, casual restaurant, bar, concert, club, park, theatre, market, celebration.
- Each of these needs usable metadata: semantic tags, source/licensing, model dimensions/orientation/anchor, complexity, device performance, animation and possible collisions.

At today's 40 imported meshes, reaching 250–350 means **210–310 more distinct 3D objects**. A practical center target is **300 total / 260 additional**. The separately curated 40 external GLB candidates reduce this shortfall **only after actual import and QA**.

## Proposed 300-prop allocation (reuse allowed across axes)
| Group | Planning quota | Current basis |
|---|---:|---|
| Cuisine and dining-specific hero/prop objects | 100 | 14 generic restaurant models; cuisine-specific coverage still sparse |
| Music instruments, stages, audio/visual equipment | 70 | External source packs found, no music-specific models imported yet |
| Reusable venue furniture, buildings-as-diagrams, parks, city accents | 65 | 8 furniture + 8 city models |
| Storytelling, fantasy, seasonal, haunted, futuristic, nonliteral objects | 65 | 6 haunted + 4 futuristic models |
| **Total target** | **300** | **40 imported currently** |

These quotas are allocation aids; crossing tags and reuse are expected. Do not mechanically fill with near-duplicates.

## Retrieval priorities (most impactful first)
1. **Import and visually inspect the 40 curated GLB candidates** for Japanese/Indian/Greek/Korean/French/street-food and jazz/classical/rock/DJ/lo-fi use cases; do not misrepresent sourcing as importing.
2. **Fill cuisine hero gaps:** pasta/pizza, tacos, dim sum/tea, Korean barbecue, pho/banh mi, Thai noodles/curry, thali/naan, Ethiopian injera, Greek mezze, Middle Eastern small plates, vegetarian, seafood, brunch, bakery.
3. **Fill music hero gaps:** guitar/bass/drums, sax/trumpet, piano/strings, DJ decks/speakers, regional percussion and acoustic instruments, retro turntable/disco fixtures, live mic/stage. No copyrighted band artwork or playback is required.
4. **Build 30–50 actual set-piece recipes** from tested primitives: one content-dependent hero vignette and one optional mood/lighting accent.
5. Verify consistent visual treatment and only choose the compatible subset of assets at runtime; expensive PBR and particle effects should be lazy-loaded, downsampled or skipped on mobile.

## Asset acceptance criteria (per item)
- [ ] Actually downloaded/committed (not just a pack link), licensable for redistribution, original URL and provenance recorded
- [ ] Correct glTF/GLB and texture references, valid byte length/hash
- [ ] Visually inspected with representative scene lights on light/dark map
- [ ] Geometry dimensions, pivot, orientation, material quality and scale verified
- [ ] File weight, triangles, draw calls and device performance within budget
- [ ] No factual map/venue claims or fabricated street geometry
- [ ] Supports one of two optional slots without occluding route paths, stops, destination pins, readable labels, map attribution or controls
- [ ] Safe fallback for focus mode and reduced motion

**Completion means coverage and quality, not raw asset count.** Once each core family has multiple truly usable visual choices and 30–50 compatible composite scenes are validated, stop broad procurement and build Scene Composer v1. Nonessential niche themes can remain future expansions.
