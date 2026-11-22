# Vibenta Two-Slot Scene Asset Compositions

This folder is **asset authoring / QA**, not the production Scene Composer or map runtime.

## Files

- `recipes.v1.json`: 30 original context + mood ingredient lists.
- `layouts.v1.json`: 40 two-slot composition definitions (the 30 original recipes plus 10 new ones), with 147 explicit asset placements, normalized preview transforms, yaw, target span, contextual activation rules and visibility fallbacks.
- `gallery.html`: interactive 3D composition preview that loads local imported GLBs and KayKit glTFs with Three.js. It draws the hero and ambient-accent slots in separate display areas and provides orbit/zoom inspection.

## Preview

From the GitHub repository root, run:

```bash
node scripts/validate-scene-assets.mjs
node scripts/validate-scene-layouts.mjs
cd apps/web
npm install
npm run dev
```

Then visit `http://localhost:5173/scene-assets/third-party/composites/gallery.html` (or the Vite URL shown in your terminal). The viewer loads pinned Three.js 0.181.0 modules from jsDelivr; internet is required for those modules. Source models are loaded from this app's static scene-assets directory.

Select a composition; orbit and zoom the two platforms. Check each model for silhouette, orientation, missing material, ground contact, clipping and visual coherence. Click **Mark inspected** or **Needs adjustment**, then export the JSON review file for the team. Review results are browser-local; **nothing is written back to the GitHub manifest automatically**. The visual review status stored in `layouts.v1.json` therefore remains `false` until independently signed off.

## Contract for the subsequent Scene Composer

The two slots are `hero_installation` and `ambient_accent`. The composer should select stable `assetId` values and apply its own deterministic placement, world-to-map scaling, collision checks, capability fallbacks and focus/reduced-motion policies. It must not treat preview-local positions as real Boston geography.

The existing assets show *fictional themed decoration*. Do not claim a dish is served at a venue, a musician is performing there, or a building/street object is physically present because it appears in a scene. Hide or reposition decorations if they obscure stations, destination selection, MBTA/walking lines, labels or attribution.

Do not auto-select culturally specific motifs from a person's identity. Only use food, genre or observance details when chosen by the user or supported by verified venue data. Consult `../../sources/coverage-readiness.v1.json`: some cuisines and genres have no distinctive imported 3D hero object, and in those cases a general atmosphere without specific props is the safe fallback.

## Verification boundary

Current GitHub manifest and tree audit: 312 model files present and metadata-consistent; 40 compositions reference imported IDs. This does **not** replace running the local scripts and visual QA. The 3D viewer has been authored, but a real browser/GPU run and a human review of all 40 installations have not yet been performed.
