# Search and Navigation

Quick Tools Search and the Directions card share `ui/tripFields.ts` and the
existing discovery autocomplete (offline Boston locations, map places, saved
places). Typed text invalidates an endpoint until a coordinate-backed suggestion
is selected. Destination Enter submits Nominatim explicitly, never on typing.
Geolocation is requested only by the Use current location button.

`trip.ts` owns temporary endpoints and the request generation. Navigate prefers
the temporary user-selected start, then discovery origin, then an empty field.
Discovery preferences are never overwritten. Search alone never requests routes.
Navigate / Get Directions enter navigation; valid endpoint changes then reroute.
Requests abort on edits/exit and late results cannot replace a newer trip.

`routing.ts` calls the existing Express API through `transitRoute.ts`; no browser
import of the server transit engine. `itinerary.ts` labels scheduled rides,
straight-line walking estimates, transfer waits and last-train availability.
Known straight-line walking estimates appear as labeled, curved diagrammatic
connections, never as pedestrian paths. Unknown walking provenance is omitted.

Map focus is centralized in `features/map/focusMode.ts`: Search preserves pitch;
Navigation locks it to zero until exit. A basemap fill dims below routes.

The existing coordinate-based API differs from the proposed shared contract's
required destinationPlaceId. No shared contract was changed. The proposed
pedestrian-route: provenance prefix still needs the transit owner's agreement.

Preview: `cd apps/web && npm run dev:all` → http://localhost:5173.
Verification: `npm test`, `npx tsc --noEmit -p .`, `npm run build`.

## Compact Directions and focus

Navigate and Get Directions open the Directions card immediately. Missing-origin
navigation focuses Starting location. The user can collapse to a compact pill. Expansion
replaces the preferences card below Quick Tools; it never mounts a second side
panel. Collapse (including Escape) is a presentation action: it preserves the
request generation, route, hubs and 2D lock. Exit Navigation is a separate action
that aborts requests and removes all trip overlays. Both controls remain at the
card header while scrolling on desktop or mobile.

Search uses a 0.44 basemap overlay, Navigation 0.60, with reduced-motion support.
Unrelated DOM pins are invisible, inert and excluded from pointer hit testing;
category results continue updating independently from Search results. The style
currently has no destination-pin map layers to hide. Rail overlays keep provider
colors with a diffuse glow and a thin luminous center, without dark outlines.
Station names sit on light labels rather than black text halos. Marker glow is
scoped to focus modes; Discovery pins and origin markers have no glow. Verified pedestrian paths
use dark dashes with light casing and a subtle icy-blue glow. Known straight-line estimates use separate
blue-slate, widely spaced dashed arcs, labeled “Walk · estimate.” Expanded
Directions explains that these are not pedestrian directions; the collapsed
control retains a Walking estimates note. Unknown provenance stays text-only.

Route hub icons are keyed by station identity/coordinates and reused on panel
collapse/expansion. Distinct stations on either side of a walking transfer remain
separate; a shared physical transfer station is shown once. Actual station
endpoint coordinates take priority over route-shape endpoints when available.

Browser checks (macOS, Node 26, Chrome):
`node scripts/check-navigation-browser.mjs`. These intercept transit, Overpass and
Nominatim with labeled fixtures and save screenshots/results in
`/private/tmp/vibenta-refinement-qa`. Live API checks must be reported separately.
