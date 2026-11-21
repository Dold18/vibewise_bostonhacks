# Discovery panel: initial preferences v1

A floating two-step discovery panel on the left of the Living Map.
**Step 1: Plan your outing** collects practical preferences (activity with
cuisine or activity-type multiselect, starting point, budget, and time).
**Continue to your vibe** switches to Step 2 without losing these values.
**Step 2: Find your vibe** provides a guided free-text field with selectable
examples and an accessible multi-photo drop zone with previews.

Photos are held as browser-local `File` objects only (maximum five JPG/PNG/WebP
files, each up to 8 MB). They are **not uploaded or analyzed yet**. Moving back
to Step 1 and forward again preserves both text and photos during the session.
Clear all removes them; refresh does not retain photos. `Save my vibe` collapses
the panel with a clear summary.

**Not included yet:** the adaptive Vibe Quiz, AI/image interpretation, or vibe
matching against map pins. This screen is the input foundation for those features.

## Mounting

`main.ts` (map-owned) mounts the panel as the primary left-hand interface. Callum's
slide-out sidebar, its ☰ button and its Location type dropdown were removed.

```ts
mountDiscoveryPanel(document.body, {
  placeCard: card,
  mapLayers: {
    available: CATEGORIES,                    // the map's own place categories
    onChange: ({ layerIds, detail }) => showCategories(/* those categories */, detail),
  },
});
```

The panel never touches map state directly. The map keeps doing all the
loading (tile POIs, Overpass) and drawing. The panel reads the map's DOM in
two ways:

- It watches `#place-card`'s `hidden` attribute. While a destination card is
  open, the panel collapses to a one-line summary, and it returns to its
  previous state when the card closes.
- It measures `#search-form` to sit just below it.

Both hooks are optional. The search bar and cards are temporary and will be
replaced later, so nothing here depends on them being present.

On phones (≤640px) the panel is a bottom sheet that starts collapsed.

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
panel.subscribe((prefs) => …); // returns an unsubscribe function, including local vibeImages changes
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
| `vibeImages` | Browser-local `File[]`, up to 5 JPG/PNG/WebP images of ≤8 MB each; never uploaded by this panel. |

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

The unit tests run in Node with no DOM (including image validation and state retention). DOM behaviour (keyboard, focus,
collapse/restore, mobile layout) was checked manually in Chrome.
