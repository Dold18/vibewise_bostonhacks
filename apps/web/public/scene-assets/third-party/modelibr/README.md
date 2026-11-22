# Vibenta — imported CC0 GLB source collection

**Status:** Asset files exist in this branch; no scene renderer or placement code has been added.

## What's actually in this folder

- **168 distinct imported GLB files**, stored under 15 pack directories. They total **8,407,240 bytes (~8.02 MiB)**.
- Every GLB was transferred byte-for-byte from the public [Papyszoo/CC0-Public-Domain-Models](https://github.com/Papyszoo/CC0-Public-Domain-Models) collection. That project packages converted assets originally by Kenney, Quaternius, and The Base Mesh. Their pack metadata and licensing claims are included in [manifest.v1.json](manifest.v1.json).
- Source revision is pinned in the manifest, and **168/168 Git blob SHAs plus file sizes match** the source. GLB magic/version headers were checked during import.
- The source pack pages identify these models as **CC0**; original creator websites are included per pack. Keep provenance and review license terms if using these files in production.
- Browser thumbnails for these 168 models are available in the source repository and linked by immutable revision from the manifest. They are **not** bundled in this repository.

## Open the gallery

When Vite is running for `apps/web`, visit:

`/scene-assets/third-party/modelibr/gallery.html`

The gallery supports text search and source-pack filtering and links the actual local GLBs. It uses lightweight **source thumbnails**, not a GLB renderer. Internet access is required for the upstream thumbnail images.

## Coverage added

| Collection | Imported | Purpose |
|---|---:|---|
| Kenney Food | 40 | Italian, Mexican, French bakery, Chinese dim sum, North African tajine, brunch, general dining |
| Quaternius Sushi Restaurant | 24 | Japanese food, ramen, sushi, and decorative restaurant fixtures |
| The Base Mesh | 8 | Piano, acoustic guitar, flute, instrument stands and studio supports |
| Kenney Graveyard | 8 | Haunted and gothic installation objects |
| Kenney Nature | 8 | Gardens, parks and romantic/outdoor accents |
| Kenney Holiday | 8 | Seasonal and explicitly selected celebrations |
| Kenney Fantasy Town | 8 | Storybook, romantic, fantasy market and architectural accents |
| Kenney Mini Arcade | 8 | Games, retro and playful nightlife |
| Kenney Retro Urban | 8 | Awning, old-town streetscape and retro architecture accents |
| Quaternius Junk Food | 8 | Pizza, dessert, retro diner and food variants |
| Kenney Mini Market | 8 | Markets, food displays and shopping |
| Kenney Furniture | 8 | Café/bar furniture, speakers, radio and listening lounges |
| Kenney Pirate | 8 | Coastal, nautical, harbor and adventurous decorations |
| Quaternius Cyberpunk | 8 | Futuristic and neon scene props |
| Kenney City Commercial | 8 | Stylized modern city and outdoor dining accents |
| **Total** | **168** | |

The **existing 40 KayKit models** remain separate under `../kaykit/`, giving Vibenta **208 total imported 3D props**. The prior **225 SVG assets/variants** are also separate from this count.

## Usage constraints

- Individual GLBs are *assets*, not working map decorations. Nothing should load until a future Scene Composer adapter selects and positions them.
- Search metadata is for convenience. Avoid cultural/genre stereotypes; food, music and occasion themes should derive from explicit user selections or reliable venue data.
- Fictional decorative props must not be confused with real Boston buildings, transportation, food menus or live event schedules.
- The eventual design calls for at most one contextual hero vignette plus one optional ambient accent.
- Keep street and station labels, destination pins, MBTA/walking route markings, accessibility and attribution unobstructed.
- Never autoplay music. Respect low-power devices and reduced-motion settings.
- Validate glTF meshes, textures, pivots, scale, material consistency, mobile performance and actual source licensing before calling these render-ready.

See the [completion target](../../sources/COMPLETION_TARGETS.md) and [cuisine/music coverage plan](../../sources/cuisine-music-coverage.v1.json).
