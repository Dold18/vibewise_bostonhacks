# Two-step discovery and Quick Tools

A floating "Plan your outing" panel on the left of the Living Map. It collects
the practical preferences (activity with a cuisine or activity-type
multi-select, starting point, budget, and time) plus an optional vibe text. It
also provides a tested filtering/ranking foundation for the map's places.

**Not included yet:** the Vibe Quiz, AI or vibe interpretation, and any change
to the map pins.

## Mounting

`main.ts` (map-owned) mounts the panel as the primary left-hand interface:

```ts
const discovery = mountDiscoveryPanel(document.body, {
  mapLayers: { available: CATEGORIES, onChange },  // Activity → map categories
  search: tripSearch, // injected root, focus, onOpen, onClose, destroy
  saved: { store, onSelect },
  directions: { panel: planner.root, control: planner.control },
  onRecenter,
});
```

- **Quick Tools.** An independent rounded card above the entire Discovery
  Preferences card, with Search / Saved / Recenter and an animated expansion.
  Opening tools never hides or restructures preferences or the vibe textbox.
  - Search receives its shared two-endpoint UI from navigation; the discovery
    panel imports no navigation module. Destination Enter runs Nominatim only
    on submit. Autocomplete picks preview the destination while Search stays
    open; choosing a broader search result closes Search and opens its popup.
  - Saved places stay in this browser (`saved.ts`, localStorage), with original
    attribution. Selecting one opens the normal popup, then closes Saved.
  - Recenter uses the stored discovery origin or Boston Common, without GPS.
- **Layout.**
  - The panel sits at the top-left. There is no separate search bar any more.
  - It's independent of map overlays. Opening or closing a destination popup
    never collapses or hides it. Expanded Directions temporarily replaces the
    preferences card, leaving its DOM and state mounted; collapsing Directions
    restores the exact step and sheet state. Only the user's minimize/expand buttons change it.
  - On phones it's a bottom sheet.
- **What the panel touches.** It never changes map state directly. The map
  subscribes with `subscribe()` / `getPreferences()`, for example for the
  starting-point marker.

## What the map loads (`mapLayers.ts`)

| Panel selection | Map categories (the map's existing `CATEGORIES`) |
|---|---|
| No activity yet | All five, from the loaded map tiles only (no network request) |
| Food & drinks | Restaurants, Coffee, Bars |
| Activities, no type chosen | Bars, Parks, Museums |
| Museums & galleries / Outdoors & parks / Nightlife | Museums / Parks / Bars; several types load the union |
| Live music, Sightseeing, Sports & recreation, Games & entertainment, Shopping, Student events | No layer yet. The choice is kept, the panel says so, and nothing is substituted. |
| Open to anything | All five |

- Each change is reported once, about 500 ms after the last one, and only
  when the set of categories changes. Ticking cuisines, or changing budget,
  timing, starting point or vibe, never triggers a map request.
- The map then sends **one** combined Overpass request for all chosen
  categories (`placesNearAny` in `osm.ts`) and aborts any older request, so a
  late response can't replace newer pins.

## Public API

```ts
const panel = mountDiscoveryPanel(container, options);
panel.getPreferences();        // InitialPreferences
panel.subscribe((prefs) => …); // returns an unsubscribe function
panel.destroy();

import { rankPlaces } from './discovery';
rankPlaces(places, prefs);     // { included, excluded }, each with per-filter status and notes
```

In dev builds the handle is also available as `window.vibentaDiscovery`.

## State (`preferences.ts`)

| Field | Representation |
|---|---|
| `activity` | `'food_drinks' \| 'activities' \| 'anything' \| null` |
| `cuisines` / `activityTypes` | Option ids. Non-empty only under the matching activity. Changing the activity clears both. |
| `origin` | `{ label, location: {lat, lng}, source, sourceRef?, accuracyMeters? }`, or null |
| `budget` | `{ choice, maxCentsPerPerson }` in USD cents. `null` cents means no limit; a `null` budget means not chosen. |
| `timing` | `{ kind, start, end?, timeZone: 'America/New_York', resolvedAt }`, ISO 8601 with Boston offset |
| `vibeText` | Free text, ≤500 characters. Stored only, never used for filtering. |

All changes go through `preferencesReducer`. `normalizePreferences(unknown)`
cleans untrusted input, e.g. state restored from storage.

## Timing definitions

- **Right now:** the moment the option is selected.
- **Tonight:** 7 PM to 3 AM Boston time. If it's already evening, the window
  starts now. Between midnight and 3 AM it means the rest of the current
  night.
- **Tomorrow:** the whole next Boston calendar day.
- **Pick date/time:** the inputs are read as Boston time whatever the device's
  time zone. Past, invalid and incomplete entries are rejected.

## Starting-point search

- `LocationSuggestionProvider` is the interface a live geocoder implements.
- v1 uses `createLocalSuggestionProvider(BOSTON_LOCATIONS)`. That is an offline
  list of 125 MBTA rapid-transit stations, 15 universities and 30 landmarks,
  and the UI labels it as offline.
- The list is generated by `scripts/build-boston-locations.mjs`:
  - Stations come from the MBTA V3 API.
  - Universities and landmarks are pinned OpenStreetMap elements, fetched
    through Overpass.
  - Every entry records its source id. Rerun the script to refresh the list;
    don't edit the data file by hand.
- Large OSM areas use the bounding-box centre, so treat those coordinates as
  approximate.
- **Do not** point the provider at public Nominatim. Its usage policy forbids
  client-side autocomplete. A live provider needs a team decision, and a
  keyed provider needs a server-side proxy.
- "Use current location" calls `navigator.geolocation`. It reports denial,
  unavailable position, timeouts, unsupported browsers and non-https pages,
  and never substitutes a made-up location. Positions outside Greater Boston
  are kept, with a warning.

## Filtering (`filter.ts`)

Each filter has one of these statuses for each place:

- `match`
- `mismatch`: the place is excluded.
- `unknown`: the place is kept and ranked lower.
- `not_applied`
- `unset`

Places are ranked by fewest unknowns, then straight-line distance from the
origin, then original order. That distance is labelled straight-line, not
travel time.

| Preference | Applied today? | Why |
|---|---|---|
| Activity | Yes | OSM `amenity`/`tourism`/`leisure`/`shop`/`historic` tags. Tile places use their subclass label. |
| Cuisines | Partly | OSM `cuisine` tag with synonyms. Untagged places count as unknown. |
| Activity types | Mostly | Student events have no data source, so that choice is saved but not applied. |
| Budget | No | No price data, and fares aren't integrated. Prices are shown as unknown and nothing is excluded. |
| Timing | No | `opening_hours` isn't parsed yet; that needs a parser such as opening_hours.js. |
| Vibe text | No | Reserved for the Vibe Engine. |

`rankPlaces` is **not yet wired to the map pins**. Pins are chosen by
category only, via `mapLayers.ts`. Connecting `rankPlaces` to pin visibility
and size (`PinLook` in `main.ts`) is the next step and needs the map owner.
The panel tells users that their other choices don't filter pins yet.

## Tests

```sh
npm test         # vitest run: reducer, Boston time, locations, filtering, layout, map layers, osm.ts
npm run build    # tsc && vite build
```

The tests run in Node with no DOM. DOM behaviour (keyboard, focus,
minimize/expand, mobile layout) was checked in headless Chrome.

## Two-step UI source and state

The vibe component, local image validation, seven example prompts and two-step
composition were selectively integrated from origin/main at bbadf36 (PR #28,
including the example breadth refinements). Upstream popup-driven collapse and
removal of Quick Tools/navigation were intentionally excluded.

Step 1 contains practical fields and Continue to your vibe. Step 2 has one
“What’s your vibe?” heading, the descriptive text field, seven examples and an
optional photo drop zone. Files stay in memory (up to five JPG/PNG/WebP images,
8 MB each). Nothing is uploaded or analyzed; previews use revoked-on-removal
object URLs. Back, Continue, and Directions preserve the original File objects.
The preference normalizer intentionally does not restore File objects from JSON.

The blue header, labels, selected fields and focus rings reinforce the existing
blue action styling. Only the user controls minimizing the discovery sheet.
