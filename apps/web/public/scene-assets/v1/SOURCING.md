# Scene material sourcing shortlist — verified candidates

> **Status:** source candidates only. These third-party materials have **not been downloaded or committed**. The 33 actual SVG files in `apps/web/public/scene-assets/v1` are original procedural artwork.
>
> **Policy:** Use only assets with an identified license and exact source URL; keep a per-file manifest with attribution/licensing evidence even for CC0. Prefer 512–1024 px optimized texture maps over massive source 8K files. For an actual 3D material renderer, import compressed albedo/normal/roughness maps rather than the site's preview sphere images.

## Architectural PBR materials

| Purpose | Candidate and direct page | License | Render integration |
|---|---|---|---|
| Weathered brick wall | [Poly Haven — Brick Wall 07](https://polyhaven.com/a/brick_wall_07) | CC0 | building façade custom material |
| Worn brick / rough masonry | [Poly Haven — Worn Brick Wall](https://polyhaven.com/a/worn_brick_wall) | CC0 | building façade custom material |
| Cream-painted brick | [Poly Haven — Whitewashed Brick](https://polyhaven.com/a/whitewashed_brick) | CC0 | warm minimalist/vintage façade |
| Contemporary wall cladding | [Poly Haven — Exterior Wall Cladding](https://polyhaven.com/a/exterior_wall_cladding) | CC0 | modern architecture material |
| Urban plaster/brick | [ambientCG — Bricks 105](https://ambientcg.com/view?id=Bricks105) | CC0 | warm/desaturated masonry |
| Concrete surface | [ambientCG — Concrete 049](https://ambientcg.com/view?id=Concrete049) | CC0 | concrete wall/surface |

## Pavement, stone, wet-ground illusions

| Purpose | Candidate and direct page | License | Render integration |
|---|---|---|---|
| Dark asphalt | [ambientCG — Asphalt 033](https://ambientcg.com/view?id=Asphalt033) | CC0 | road surface material |
| Worn asphalt | [Poly Haven — Asphalt 01](https://polyhaven.com/a/asphalt_01) | CC0 | gritty street material |
| Smooth asphalt | [Poly Haven — Clean Asphalt](https://polyhaven.com/a/clean_asphalt) | CC0 | modern streets |
| Aerial asphalt | [Poly Haven — Aerial Asphalt 01](https://polyhaven.com/a/aerial_asphalt_01) | CC0 | top-down scene detail |
| Mossy historic paving | [ambientCG — Paving Stones 139](https://ambientcg.com/view?id=PavingStones139) | CC0 | nostalgic/aged-street surface |
| Old cobblestone | [ambientCG — Paving Stones 151](https://ambientcg.com/view?id=PavingStones151) | CC0 | pedestrian street material |
| Modern paving | [ambientCG — Paving Stones 143](https://ambientcg.com/view?id=PavingStones143) | CC0 | sleek/modern surface |

## Wood and decorative sprites

| Purpose | Candidate and direct page | License | Render integration |
|---|---|---|---|
| Aged planks | [ambientCG — Wood 080](https://ambientcg.com/view?id=Wood080) | CC0 | illustrated building trim/wood texture |
| Weathered siding | [ambientCG — Wood Siding 003](https://ambientcg.com/view?id=WoodSiding003) | CC0 | façade custom material |
| Particle sprite family | [Kenney — Particle Pack](https://kenney.nl/assets/particle-pack) | CC0 | sprites for glow/sparks/dust |
| Smoke sprite family | [Kenney — Smoke Particles](https://kenney.nl/assets/smoke-particles) | CC0 | fog/mist overlay assets |

**License pages verified November 21, 2026:**
- ambientCG: https://docs.ambientcg.com/license/ states its downloadable material and preview files are CC0.
- Poly Haven: https://polyhaven.com/license states its downloadable textures/HDRIs/models are CC0; the website's sample/user-submitted render imagery has other restrictions and should not be scraped/copied as a texture.
- Kenney: https://kenney.nl/support says game assets on Kenney asset pages are public domain CC0.

## What the browser actually needs

- For basic MapLibre palette recoloring and 3D extrusions, **no PBR textures are necessary**.
- For stylized rain, sparks, grain, clouds and glow, the generated SVG assets in v1 can feed CSS/canvas/DOM effects after a renderer is implemented.
- For detailed brick/glass/stone façades, need **actual** UV/cube mapping and shader-backed 3D layers: a photo/PBR texture alone will not appear on existing MapLibre extrusions automatically.
- For wet roads/reflections, start with a stylized highlight overlay, then escalate to custom geometry-aware materials. Do not claim physically correct reflections without implementing them.
- For animated fog, snow and particles, choose a reusable sprite plus renderer that controls movement, density, color, opacity, wind speed and a performance budget.

## Procurement checklist (each imported material)

1. Record exact asset page, creator, license, source version/date.
2. Obtain original download (not a source preview sphere or screenshot).
3. Keep only required channels (albedo + optional normal/roughness).
4. Compress and resize to 512px or 1K initially; test WebP/KTX2 where applicable.
5. Ensure texture tiling, color space, and seam behavior are correct.
6. Add bytes, dimensions and linked `scene-effect-catalog` settings to a manifest.
7. Test scene in a browser before marking capability `implemented`.

## Asset availability honesty

The full Scene Composer proposal has **178 properties / 828 variations**, but many are **algorithmic render parameters rather than downloadable images**. The generated 33 SVG resources are only a starter asset pack. None are wired to map rendering yet, and the third-party PBR assets above are not yet in the repository.
