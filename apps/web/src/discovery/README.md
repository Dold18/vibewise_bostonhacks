# Two-step discovery and Quick Tools

A floating two-step discovery panel on the left of the Living Map.
**Step 1: Plan your outing** collects practical preferences (activity with
cuisine or activity-type multiselect, starting point, budget, and time).
**Continue to your vibe** switches to Step 2 without losing these values.
**Step 2: Find your vibe** provides a guided free-text field with selectable
examples and an accessible one-photo attachment (drop zone, thumbnail, remove).
Adding a photo requires signing in; a line shows how many of today's 5 photo
reads are left.

The photo is held as a browser-local `File` object (one JPG/PNG/WebP file, up to
8 MB) until the quiz starts. Moving back to Step 1 and forward again preserves
both text and photo during the session.
Clear all removes them; refresh does not retain the photo. `Save & start quiz` in
the footer starts the quiz too.

**Start vibe quiz** starts the adaptive questionnaire within Step 2. Text and
answers go to the server's Gemini integration. If a photo is attached and the
user is signed in, the photo client first sends it to `/api/vibe/describe-image`,
which asks Google Gemini for a short text description. Vibenta doesn't store the
photo. The description joins the vibe text as a `Photo:` line. While it is read the button shows "Reading your photo…"; on
failure the user stays on Step 2 with their draft and the error. Back/resume,
answer revision and Clear all preserve or reset the same in-memory session.
The versioned publisher feeds the existing Scene Composer and compatible catalog
recommendations. Missing Gemini uses labeled local questions; missing or
incompatible embeddings leave pins unranked.

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
| No activity yet | All five: catalog food/drink with loaded tile POIs for other categories |
| Food & drinks | Restaurants, Coffee, Bars |
| Activities, no type chosen | Bars, Parks, Museums |
| Museums & galleries / Outdoors & parks / Nightlife | Museums / Parks / Bars; several types load the union |
| Live music, Sightseeing, Sports & recreation, Games & entertainment, Shopping, Student events | No layer yet. The choice is kept, the panel says so, and nothing is substituted. |
| Open to anything | All five |

- Each change is reported once, about 500 ms after the last one, and only
  when the set of categories changes. Ticking cuisines, or changing budget,
  timing, starting point or vibe, never triggers a map request.
- Food/drink categories use Supabase when configured and available. Other
  categories use loaded tile POIs first and, for full discovery, one combined
  Overpass request (`placesNearAny`). If the catalog is unavailable, full
  discovery falls back to Overpass for food/drink too. Stale responses are
  ignored; meaningful map moves refresh the same categories without closing
  the popup. Refreshed catalog details also update an already-open popup.

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
| Cuisines | Yes | Browsing pins use catalog cuisine tags or the OSM `cuisine` tag. Untagged venues are excluded when a specific cuisine filter is active. Other keeps cuisine unrestricted. |
| Activity types | Mostly | Student events have no data source, so that choice is saved but not applied. |
| Budget | Yes | Browsing pins use the selected catalog price-band ceiling. A ceiling excludes places with unknown price bands. Transit fares are outside this filter. |
| Timing | No | `opening_hours` isn't parsed yet; that needs a parser such as opening_hours.js. |
| Vibe text | Through the adaptive quiz | Refine this vibe starts semantic ranking. Show My Matches requests final restaurant matches using the same budget and cuisine choices. |

Activity determines the map layers. Budget and cuisine narrow pins within those
layers before the adaptive quiz. The quiz uses `rankPlaces` to prepare candidates
for provisional semantic ranking. The origin provides location context and does
not set a search radius.

## Tests

```sh
npm test         # vitest run: reducer, Boston time, locations, filtering, layout, map layers, osm.ts
npm run build    # tsc && vite build
```

The tests run in Node with no DOM. DOM behaviour (keyboard, focus,
minimize/expand, mobile layout) was checked in headless Chrome.

## Integrated UI and state

Quick Tools remains a compact widget above the complete Preferences widget.
Search and device-local Saved views open inside Quick Tools. Place selection
opens one MapLibre destination popup; only Navigate (or Get directions in Search)
starts the dedicated planner. Navigation flattens the map north-up and restores
the previous discovery camera on exit. Prices retain their source/estimate labels,
deals retain source and freshness information, and catalog attribution stays visible.
The catalog, fallback discovery, account theme and scene composer remain independent
of the panel. Walking estimates are labeled in the itinerary and as diagrammatic
map connectors, never as verified pedestrian paths.

Step 1 contains practical fields and Continue to your vibe. Step 2 has one
“What’s your vibe?” heading, the descriptive text field, seven examples and an
optional one-photo attachment. The file stays in memory (one JPG/PNG/WebP image,
up to 8 MB) and is sent for a text description only when the quiz starts; `vibeImages.ts`
only validates and never uploads. Thumbnails use object URLs revoked once no
attachment shows the file. Back, Continue, and Directions preserve the original File objects.
The preference normalizer intentionally does not restore File objects from JSON.

The blue header, labels, selected fields and focus rings reinforce the existing
blue action styling. Only the user controls minimizing the discovery sheet.
