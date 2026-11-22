# Vibewise design — V3 "Layered Sheets" in production

The approved Vibewise V3 identity (identity exploration commit `e4588f4`,
`design/identity-exploration/v3/` on branch `design/identity-exploration-20261122`)
is implemented here and applied across the application. The exploration
gallery stays the visual reference; nothing in production imports from it.

## Where things live

| Path | What |
| --- | --- |
| `vibewise/tokens.css` | Self-hosted fonts (Familjen Grotesk, Syne; SIL OFL), every V3 color/geometry/motion token (`--vw-*`), and the legacy names (`--surface`, `--text`, `--accent`, …) redefined in V3 terms. Imported first by `main.ts`. |
| `vibewise/icons/` + `icons.ts` | The 80 V3 SVGs (40 actions × detailed + optical cut), copied byte-for-byte. `vwIcon()` / `vwIconHtml()` render one cached copy per use; decorative by default (no `<title>`, `aria-hidden`). Optical cut at ≤24px. `CATEGORY_ICON` maps map categories to glyphs. |
| `vibewise/wordmarks/`, `art/aperture.svg`, `brand.ts` | Stacked / horizontal / compact wordmarks, the aperture artwork (quiz intro and completion only) and `hydrateIcons()` for static markup in `index.html`. |
| `vibewise/sheets.ts` | The V1 3C Button Cradle outline (verbatim port, checked against the exploration's own output in `__tests__/identity.test.ts`) and the V2 B sheet. `paintSheet()` draws the paper front and 6/7 coral backing from one path and redraws on resize. |
| `visualFoundation.ts` | Neutral map looks. **Carbon is the production default.** `?visual=oxide|ultramarine|light` compares looks in local development only. |

Component stylesheets stay next to their modules and read the tokens:
`discovery/discovery.css`, `features/vibe/ui/quiz.css`, `features/map/map-ui.css`,
`features/account/account.css`, `features/navigation/navigation.css`, `style.css`.

## Carbon and the scene system

`mapStyle.basePalette` remains the light reference palette that the scene compiler,
contrast guard, atmosphere and building engines are tuned against (their day/night
semantics read its lightness). The map *displays* `mapStyle.neutralPalette` (Carbon):
the initial style, the theme controller's plain state, account-taste tinting and the
scene session's `base` (`mountScene({ base: neutralPalette })`). Vibe scenes therefore
transition away from and back to Carbon with ordinary paint transitions; there is no
style reload and no second renderer.

## Rules worth keeping

- Change presentation, not behavior: handlers, ARIA, focus restoration and the
  text of buttons (QA scripts match on `textContent`) stay as they are.
- Decorative additions (answer spine, letter badges, slips, artwork) are `aria-hidden`.
- Expressive type (Syne) is for headings and questions only; addresses, routes,
  errors and form text stay in Familjen.
- Marker visuals never set `position`, `transform` or `transition` on the element
  MapLibre moves, and never override `--pin-scale`, `--pin-distance` or `--pin-rank`.

See `docs/v3-production-integration.md` for the component-by-component coverage.
