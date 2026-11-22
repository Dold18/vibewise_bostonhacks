# Vibenta Visual Foundation — live previews (design experiment)

The purpose of this branch is **art direction in the real UI and real 3D MapLibre map**, not a layout redesign. It is based on `feature/scene-map-integration` (draft PR #42) so the neutral baseline also feeds Scene Composer. All experiments are off unless explicitly requested in a local Vite development URL.

## Open each look

From `apps/web`:

```bash
npm install
npm run dev
```

Then, in the actual running browser:

| URL | Visual experiment |
| --- | --- |
| `http://localhost:5173/` | Existing interface and default map, unchanged |
| `http://localhost:5173/?visual=carbon` | Carbon — darker mineral streets/buildings, high contrast, acid-green UI |
| `http://localhost:5173/?visual=oxide` | Oxide — smoky slate/clay buildings, warmer architectural lighting, coral UI |
| `http://localhost:5173/?visual=ultramarine` | Ultramarine — deep blue-black map, steel-blue buildings, cool UI |

The `visual` parameter is deliberately **dev-only** (guarded by `import.meta.env.DEV`). Production builds ignore it. Invalid values do nothing. The preview changes are scoped to `html[data-visual-preview]`, which is only set when a valid preview is active.

Switch between the URLs to compare. Reloading is intentional: the first neutral map must initialize with the chosen base palette, which is also used by the Scene Composer neutral scene.

## What changes

- **Actual MapLibre basemap:** every color in the existing `basePalette` is replaced for the active preview. Buildings remain the existing 2.5D extrusions; road geometry, label layers, label placement, tile sources, 3D pitch, camera navigation and routes are unchanged. This is not a rendered image, static mockup or MapLibre style reload.
- **Existing UI components:** all existing panel positions and widgets remain. A scoped stylesheet changes typography, surfaces, outlines, selected states, buttons, and card treatments. Display typography is Barlow Condensed; readable interface typography is Space Grotesk. Fonts load for previews only.
- **Scene compatibility:** a selected preview is the neutral `basePalette` in development. The Scene Composer session already compiles its neutral and themed scenes from that base and applies them through `setScene` without calling `map.setStyle()`.

## What does *not* change

- Layout dimensions and placements; no changes to `index.html` layout.
- Map gesture handlers, zoom, pitch, 3D layer opacity handling, or markers.
- Discovery steps, answer state, user settings and recommendation logic.
- Production look or behavior when no preview is selected.
- The scene compiler's ability to run neutral/outing modes.

## Not included yet

The initial previews **do not** implement custom 3D building shaders, individually textured building faces, moving light sources, georeferenced 3D decorations, or interactive graphic effects. Those require separate map renderers and performance work after selecting a visual direction. Describing them as already implemented would be misleading.

## Critique checklist

Use the same map location and zoom for all three. Test:

1. Open map at the default tilted 3D Boston view.
2. Rotate, tilt down/up and zoom from neighborhood level to individual buildings.
3. Open the discovery panel and several dropdowns. Check readability and visual character.
4. Open a place card. Check hierarchy, body text and action buttons.
5. Display a transit route. Confirm route and labels still stand out.
6. Exercise a Scene Composer preset from the existing development console, and clear it. Confirm transitions preserve the map and pins.
7. Resize to mobile width. Confirm the drawer and floating controls still work.
8. Enable reduced-motion preferences and verify visual usability.

Look for: the map having real depth, the UI looking contemporary rather than sterile, distinct palette character, and the map still reading as a **usable** map rather than a wallpaper.

## Relevant code

- `src/design/visualFoundation.ts` — preview detection, complete map palettes, activation.
- `src/design/visualFoundation.css` — strictly scoped UI reskin.
- `src/design/visualFoundation.test.ts` — preview validation, unchanged neutral baseline, palette key coverage and label contrast.
- `src/mapStyle.ts` — one-line neutral palette adapter.
- `src/main.ts` — activates the preview before the map is created.

### Validation commands

```bash
npm run test
npm run build
```

The development pass should not be merged until it has been checked in a real browser. Code and static test assertions alone cannot establish that the new map's depth, visuals or controls look good. For production selection, the approved design should replace the opt-in preview architecture with deliberate neutral defaults and any appropriate Scene Composer token wiring.
