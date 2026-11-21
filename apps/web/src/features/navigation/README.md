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
Unverified walking geometry is omitted from the map.

Map focus is centralized in `features/map/focusMode.ts`: Search preserves pitch;
Navigation locks it to zero until exit. A basemap fill dims below routes.

The existing coordinate-based API differs from the proposed shared contract's
required destinationPlaceId. No shared contract was changed. The proposed
pedestrian-route: provenance prefix still needs the transit owner's agreement.

Preview: `cd apps/web && npm run dev:all` → http://localhost:5173.
Verification: `npm test`, `npx tsc --noEmit -p .`, `npm run build`.
