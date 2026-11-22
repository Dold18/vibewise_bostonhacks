# Vibenta — Curated food/music GLB acquisition

Status: **40 exact-named, publisher-verified candidate models across 10 packs; external GLBs NOT imported.** This is asset procurement, not a Scene Composer implementation.

## Sources and files
- `sources/curated-3dassets.v1.json`: exact titles and semantic tags for Japanese, Indian, Greek, Korean, French/cafe, Italian/street-food, jazz/classical, rock/live music, DJ/EDM/disco, and recording-studio/lo-fi contexts
- `sources/thematic-packs.v1.json`: broader 55-pack sourced library, with priority and license notes
- `sources/cuisine-music-coverage.v1.json`: independent cuisine/genre/vibe coverage and identified gaps
- `third-party/kaykit/`: **12 actually imported** KayKit glTF objects with .bin, textures and CC0 license files (already tracked)
- `scripts/import-3dassets-curated.mjs`: a developer-run downloader that uses the publisher's public pack API

## How to procure the 40 GLBs

From repository root, with a current Node.js runtime:

```bash
node scripts/import-3dassets-curated.mjs
node scripts/import-3dassets-curated.mjs --family japanese-dining
node scripts/import-3dassets-curated.mjs --download --family orchestra
node scripts/import-3dassets-curated.mjs --download --max-mb 12
```

Default behavior is **dry run**. Only `--download` retrieves actual GLB files. Use `--family <id>` and `--limit N` to reduce scope; the default total budget is 12 MiB and the per-file cap is 4 MiB.

On download, each output is stored under `third-party/3dassets/<family>/`, with a local `manifest.v1.json` containing source URL, license metadata, SHA-256, size, theme tags and QA status. A hardcoded allowed CDN host, CC0 metadata checks, exact title matching, glTF magic/version/length checks and download limits protect against incorrect files. Skipped/missing assets are reported explicitly, with a nonzero exit code.

**Do not treat a successful download as final browser QA.** Model rendering, scene composition, scale/orientation verification and performance testing are separate milestones. The publisher states these meshes are AI-generated; review aesthetics and provenance before including them in a production scene.

## Asset taxonomy

**Use orthogonal axes** (e.g. `cuisine=japanese`, `music=electronic`, `vibe=romantic`) and score models by direct semantic fit, not by presumed cultural stereotypes. The maps should never suggest a venue actually has the illustrated objects or offers a particular dish/music performance without verified data.

The future composer can place a small `context_hero` and `mood_accent` only when visibility and route safety allow. In navigation focus mode, optional props should disappear or be reduced enough to keep selected pins, MBTA stops, walking dashes, streets, UI hit areas and attribution readable.

## Current gaps

Cuisine-specific dish meshes are still required for Chinese, Thai, Vietnamese, Korean barbecue, Ethiopian, Mediterranean regional food, and several Mexican/Italian dishes. For music, expand toward reggae, regional Latin genres, K-pop-specific abstract stage aesthetics, ambient listening, and other performance genres. Source individual objects first and avoid accumulating entire packs by default.
