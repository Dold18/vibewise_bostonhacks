# City engine: one plan, independent renderers

Process, ownership and branches: [docs/CITY_ENGINE.md](../../../../../docs/CITY_ENGINE.md). Contract types: [`contracts.ts`](contracts.ts).

```
Scene Session (the one authority) ─ SceneState ─► CityPlanner (composition/) ─► enforcePolicy (engine)
                                                                                     │ CityPlan
                     ┌────────────────────┬────────────────────┬─────────────────────┤
                 buildings/            streets/           decorations/          atmosphere/
             (BuildingPlan)         (StreetPlan)        (DecorationPlan)      (AtmospherePlan)
```

## Writing a renderer

```ts
// features/city/atmosphere/index.ts
export function createAtmosphereRenderer(host: CityHostOptions): CityRenderer<'atmosphere'> {
  let ctx: RendererContext;
  return {
    id: 'atmosphere',
    section: 'atmosphere',
    // Only values you REALLY draw. Claiming a key also stops the legacy bridge drawing it.
    capabilities: { values: { 'air_and_atmosphere.rain': ['drizzle', 'light', 'cinematic'] } },
    init(c) { ctx = c; /* create DOM under ctx.overlay / layers on ctx.map, ids prefixed ctx.idPrefix */ },
    update({ section, env, transition }) {
      if (!section.enabled) return fadeOut(transition.durationMs);
      const rain = section.treatments.rain;          // Treatment | undefined
      // rain.style (family), rain.intensity 0..1, rain.scale, rain.tint, rain.assets (manifest files), rain.seed
      // env.mode.ambientMotion false ⇒ no continuous animation; env.budget.particles is your cap
    },
    usage: () => ({ particles: count, overlayElements: 1 }),
    dispose() { /* remove everything you created */ },
  };
}
```

## Rules

- **Read only your section and `env`.** Never import another section's module, `scene/intent`, Gemini or vibe code.
- **Continuous, not themes.** Branch on `treatment.style` for the family, then scale everything else continuously by `intensity`/`scale`/`tint`. Never switch on preset names.
- **Deterministic.** Use `seed.ts` (`createRandom`, `subSeed`, `unitHash`); no unseeded randomness. Place instances by `unitHash(seed, stableId) < density` so density changes only add/remove.
- **Assets** only via `frame.section…assets` / `ctx.assets` (manifest-backed). Decode SVGs with `ctx.assets.loadImage` (shared cache).
- **Lifecycle.** `update` is called only when your section/env changed, must be idempotent, and must transition over `transition.durationMs`. Throwing 3× in a row retires you and withdraws your capabilities.
- **Safety is already applied.** In navigation your section arrives disabled or capped; just obey it. Keep off roads, labels, pins and routes.
- **Budget.** Stay within `env.budget`; report `usage()`; the engine flags overruns in `vibentaCity.stats()`.

## Dev hooks (development builds)

- `vibentaScene.preset([['noir_nocturne', .6], ['neon_city', .4]])`, `.describe('rainy neon night')`, `.navigation(true)`
- `vibentaCity.plan()`, `vibentaCity.stats()`, `vibentaCity.reseed(42)`; `?seed=42` in the URL for a reproducible world.

`npx vitest run src/features/city`
