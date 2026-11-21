# Navigation: trip planner

The **Navigate** button on a destination popup opens "Plan a trip", an
overlay on top of the map. It's a separate mode, not part of the discovery
panel.

- `routing.ts`: the routing boundary.
  - `RouteEndpoint` is a label plus resolved `{lat, lng}`, a `source`, and an
    optional *real* `placeId`.
  - `RouteRequest` and `RouteResult` are navigation-specific types.
  - `RouteProvider` is the interface a routing service implements.
  - `createTransitRouteProvider(planTripLive)` adapts the transit
    workstream's engine.
- `routePlanner.ts`: planner state.
  - It's a pure reducer, separate from the discovery preferences: editing
    "From" never changes the saved starting point.
  - Routes are requested only on demand. Generation checks discard stale
    results.
- `ui/routePlannerView.ts`: the overlay.
  - The From/To fields reuse the discovery location field, with suggestions
    from map places, saved places and the offline Boston list.
  - Swap and close buttons.
  - A results area.

## Why not the shared `TransitRequest`
`docs/CONTRACTS.md` requires `TransitRequest.destinationPlaceId`. Planner
endpoints can be stations, landmarks or "current location", which have no
place id, and we don't invent one.

`RouteResult` reuses the contract's `TransitOption` unchanged. If the shared
contract should change instead (for example, making `destinationPlaceId`
optional), that needs both owners' approval. It isn't done here.

## Live routing is OFF (this milestone)
`main.ts` passes `provider: null`, so:
- the planner shows "MBTA routing isn't connected yet";
- "Find MBTA routes" is disabled;
- no MBTA request is ever made;
- nothing is drawn on the map.

`routing.ts` imports only transit **types**, so no transit code or data is
bundled.

To switch it on (with the transit teammate):

```ts
const { planTripLive } = await import('./features/transit/ride');
provider: createTransitRouteProvider(planTripLive),
```

Before doing that, settle these with the transit owner:
- **Rate limit:** without a key, MBTA allows 20 requests a minute in the
  browser. Any key must stay server-side.
- **Cancellation:** `planTripLive` can't be cancelled, so stale answers are
  ignored instead.
- **Drawing:** a route-overlay layer on the map is map-owned work.

Tests: `__tests__/routing.test.ts` and `__tests__/routePlanner.test.ts`.
