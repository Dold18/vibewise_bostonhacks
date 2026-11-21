# Shared Contracts — Vibenta
> **Status:** **Proposed v0.1 integration contract** for map/cards and transit. Review and accept together **before** independent implementation.
> Purpose: prevent different teammate/AI-agent implementations from inventing incompatible place IDs, coordinates, routes or callback payloads.

## 1. Universal conventions
- Use TypeScript interfaces (or equivalent runtime-validated JSON schemas) in a single shared module.
- Stable IDs are strings. Never use a displayed place name as the primary key.
- Internal points: `{ lat: number, lng: number }` (WGS84 decimal degrees).
- GeoJSON positions and polyline coordinate arrays: **`[longitude, latitude]`**, never the reverse.
- Dates/times: ISO 8601 strings with timezone offset where possible; show Boston-local times to users.
- Durations: integer seconds. Distances: meters. Money: USD cents when an exact amount is known.
- Never interpret missing price, student demographic or transit data as verified zero.
- Route geometry may be approximate depending on source; show uncertainty/provider notes.

## 2. Proposed canonical types
Copy these definitions into an actual shared TypeScript module before implementation. The code module will then be the compile-time source of truth; this document records its intent.

~~~ts
export type GeoPoint = { lat: number; lng: number };
export type PlaceCategory =
  | "restaurant" | "cafe" | "entertainment" | "nightlife"
  | "culture" | "attraction" | "event";

export type PriceBand = "$" | "$$" | "$$$" | "$$$$" | "unknown";

export interface Place {
  id: string;                    // canonical stable ID, e.g. "place_bos_001"
  name: string;
  category: PlaceCategory;
  location: GeoPoint;
  address: string;
  description?: string;
  priceBand: PriceBand;
  image?: {
    url: string;
    attribution?: string;
    source: "licensed" | "first_party" | "provider";
  };
  vibeTags: string[];            // initially curated; later from Vibe Engine
  studentDiscount?: {
    description: string;
    verifiedAt: string;         // ISO datetime
    sourceUrl?: string;
  };
  source?: {
    provider: string;
    providerPlaceId?: string;    // external ID is NOT our primary ID
    verifiedAt?: string;
  };
}

export interface TransitRequest {
  origin: GeoPoint;
  destination: GeoPoint;
  destinationPlaceId: string;    // ties result to currently selected card
  departureAt?: string;          // ISO datetime, defaults to now if omitted
}

export type TransitMode = "walk" | "subway" | "bus" | "commuter_rail" | "ferry" | "other";

export interface TransitLeg {
  mode: TransitMode;
  start: GeoPoint;
  end: GeoPoint;
  durationSec: number;
  distanceMeters?: number;
  geometry: [number, number][];  // [lng,lat], at least 2 points if provided
  instructions?: string;
  routeShortName?: string;       // e.g., "B", "Red", "1"
  routeColor?: string;           // "#RRGGBB", visual hint only
  fromStopName?: string;
  toStopName?: string;
  source?: string;
}

export interface TransitOption {
  id: string;
  durationSec: number;
  departureAt?: string;
  arrivalAt?: string;
  transfers: number;
  legs: TransitLeg[];
  fareCents?: number;            // undefined if unknown
}

export type TransitResponse =
  | {
      status: "ok";
      destinationPlaceId: string;
      options: TransitOption[];
      provider: string;
      retrievedAt: string;
      notes?: string[];
    }
  | {
      status: "no_route" | "error";
      destinationPlaceId: string;
      options: [];
      message: string;
      provider?: string;
      retrievedAt: string;
    };

export interface MapSelection {
  selectedPlaceId: string | null;
}

export interface VibeProfile {
  userId: string;
  tags: Record<string, number>;  // e.g. cozy: 0.8, electric: 0.1
  categories: PlaceCategory[];
  budgetCents?: number;
  origin?: GeoPoint;
  availableMinutes?: number;
}

export interface Recommendation {
  placeId: string;
  score: number;                 // normalized [0,1]
  reasons: string[];
}

// Proposed (DECISIONS.md P-014), not yet ratified.
// One vibe reading for the signed-in user, sent by the Vibe Engine to the
// account module's recordVibe(). Keys are the DATA_MODEL.md §3 vocabulary
// (VibeKey), values in [0,1]; unknown keys are dropped, out-of-range values clamped.
export interface VibeSignal {
  scores: Partial<Record<VibeKey, number>>;
  source: 'quiz' | 'text' | 'image' | 'song' | 'place' | 'dev';
  placeId?: string;              // a catalog Place.id the signal came from, if any
}
~~~

## 3. Map → Transit handshake
1. Catalog loads a `Place[]`, each with a stable `id`.
2. User clicks marker/card; map emits `onPlaceSelect(placeId: string)`.
3. Coordinator sets `selectedPlaceId`, clears stale route visual, and resolves `Place` from catalog.
4. If origin is unknown, ask for a starting point (do **not** assume Boston University or exact device location).
5. Coordinator creates `TransitRequest` using origin, place.location, and place.id.
6. Transit module computes/requests routes. It **does not control the map**.
7. Coordinator accepts result only if `destinationPlaceId === selectedPlaceId` and request is the latest. Late/stale results are ignored.
8. Map renders each leg geometry, differentiating walking/transit, and shows itinerary detail card.
9. If provider returns `no_route` or `error`, map explains it without inventing a route.

### 3.1 Tiered MBTA routing mapped onto the existing types (documentation only, no type change)
Proposed in D-007; spec in [PROJECT_BRIEF.md §9](../PROJECT_BRIEF.md).
- **Tier 1 (same route pattern):** one `TransitOption` with `transfers: 0`, legs walk → subway → walk.
- **Tier 2 (single transfer, deferred):** `transfers: 1`, legs walk → subway → subway → walk. Each subway leg carries its own `geometry`, `routeShortName`, `routeColor`, `fromStopName` and `toStopName`.
- **Tier 0 fallback (nothing is drawn as a transit line):** `status: "ok"` with one walk-to-stop leg, no transit leg, and `notes` carrying the nearest stop, next departures and, if applicable, "multi-leg trip, ~X min (schedule-derived estimate)". Departures must be omitted if `/predictions` is unavailable.
- Walk-leg `geometry` is approximate (a straight line unless a walking router is used). Mark it in the leg's `source`, e.g. `"approx: straight-line walk, ~80 m/min"` (see §1, approximate geometry).
- `geometry` is non-optional on every returned leg (at least 2 points). The "if provided" comment on `TransitLeg.geometry` means a leg without drawable geometry is not returned as a leg.
- A drawn option only exists if the service-running check passed; otherwise return the late-night/no-service message, not a route.

## 4. Suggested API boundary (only if using a backend)
The team may choose direct in-app service calls instead. This JSON shape is the agreed boundary in either design.

~~~http
POST /api/transit/route
Content-Type: application/json

{
  "origin": {"lat": 42.35, "lng": -71.11},
  "destination": {"lat": 42.36, "lng": -71.06},
  "destinationPlaceId": "place_bos_001"
}
~~~

Response: `TransitResponse` as above, with all leg coordinates normalized. `GET /api/places` may return `Place[]` if a backend is chosen. Route service may require a provider-specific API key **server-side**, never expose it in client code.

## 5. UI states to support
- `idle` — no place selected, no overlay.
- `origin_required` — destination selected but start location absent.
- `loading` — requested, old overlay removed or clearly stale.
- `ready` — 1+ real options with legs and details.
- `no_route` — no supported option found.
- `error` — network/provider/parse error; retry possible.

No mock route should be presented as real. Fixtures for offline development must be explicitly labeled “demo/sample.”

## 6. Contract acceptance checks
- All team members can inspect a `Place` object and find coordinates, category and price band without guessing names.
- Map demonstrates `onPlaceSelect("place_bos_001")`; transit adapter accepts the corresponding `TransitRequest`.
- Transit returns an `ok` result whose legs can be drawn using `geometry`; or a normalized error/no-route.
- A rapid second selection cannot display the first destination's route.
- Each route option shows duration and transfers; unknown fares remain blank.
- Real route and line labels are derived from provider data or verified fixtures.

## 7. Change control
After agreement, change this contract **together with** shared executable types, tests and consuming code in one PR. Require review by both map and transit owners for breaking changes; do not have agents independently rename types or fields.
