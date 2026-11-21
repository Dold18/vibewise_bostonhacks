# User Accounts and Vibe-Reactive Map Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Email/password Supabase accounts, with a top-right account control. Each user's private vibe history tints the map palette and adds effects, and users can turn the effects off.

**Architecture:**
- Pure, unit-tested modules do the logic:
  - vibe score validation
  - decayed taste
  - palette blending with a contrast guard
  - paint diffing
  - effect selection
  - an account store over an injectable backend interface
- Thin DOM and Supabase adapters sit around them and are verified by hand in the browser.
- The map style becomes a function of a palette. Theme changes are applied as `setPaintProperty` diffs, so runtime layers (route, pins) survive.

**Tech Stack:** Vite 8 + vanilla TypeScript 7, MapLibre GL 6, `@supabase/supabase-js` 2 (already installed), vitest 5 (Node, no DOM), Supabase Postgres + Auth, Supabase CLI 3.2.0 via npx.

**Spec:** `docs/superpowers/specs/2026-11-21-user-accounts-vibe-theme-design.md`

## Global Constraints

- All app paths below are relative to `apps/web/` unless they start with `supabase/` or `docs/`. Run `npm test` / `npm run build` from `apps/web/`.
- Work on a new branch, `feature/accounts-vibe-theme`, cut from the current `maps-supabase` HEAD. Never commit to `main`.
- Commit messages carry **no** Claude / Co-Authored-By attribution lines (user preference).
- The vibe vocabulary is exactly DATA_MODEL.md §3, in this order: `cozy, lively, upscale, divey, aesthetic, quiet, date_night, group_friendly, late_night, outdoor`. `vocab_version` is `1`.
- Scores are numbers in [0, 1].
- Browser env is only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. No new secrets. Never print their values.
- The account Supabase client uses `auth: { persistSession: true, detectSessionInUrl: true, storageKey: 'vibenta-auth' }`. Do not change `src/catalog.ts`.
- Constants (named, exported from the module that owns them):
  - `HALF_LIFE_DAYS = 14`
  - `FULL_STRENGTH_WEIGHT = 5`
  - `TOP_VIBE_THRESHOLD = 0.35`
  - `MAX_TOP_VIBES = 3`
  - `HISTORY_LIMIT = 200`
  - `MAX_SHIFT = 0.6`
  - `EFFECT_VIBES = 2`
  - `THEME_TRANSITION_MS = 800`
- Contrast bars:
  - `textPrimary` vs `land` ≥ 4.5
  - `textSecondary` vs `land` ≥ 3
  - the weakest pin edge vs `land` ≥ the weakest pin vs base `land` (computed, about 2.6)
- No location is ever written to `vibe_events` or `profiles`.
- `source = 'dev'` rows count toward taste only when `import.meta.env.DEV` is true.
- Copy, fixed by the spec:
  - "Sign in"
  - "Create account"
  - "Check your email to confirm"
  - "Accounts unavailable"
  - "Your map will start to reflect your vibes as you explore."
  - "Map effects"
  - "Clear my vibe history"
  - "Includes sample vibes"
  - "Sign out"

## Review Focus

1. **Signing in on a slow network with the map already themed by a previous account.** Switching accounts must drop the old taste before the new one loads, with no flash of the old user's theme. Test: `session.test.ts` › "sign-out then sign-in as another user never exposes the first user's events".
2. **Stale async results.** `recordVibe` or `loadEvents` can finish after a sign-out. A late result must not resurrect a signed-in state. Test: `session.test.ts` › "events that resolve after sign-out are ignored".
3. **Theme change while a route is drawn or 3D is tilted.** Only base style layers may be repainted, and `building-3d` opacity is never touched. Test: `apply.test.ts` › "ignores layers not in the built style and never sets fill-extrusion-opacity".
4. **Malformed scores from a future producer** (NaN, strings, nested objects, unknown keys, empty object, values like 1.2 or -0.1). These are cleaned or rejected client-side, and the DB check is the backstop. Test: `vibes.test.ts` cases.
5. **Every vibe and every pair at full strength stays readable.** Test: `blend.test.ts` › "all single vibes and pairs satisfy the contrast bars".

---

### Task 1: Branch, schema migration and docs

**Files:**
- Create: `supabase/migrations/20261121180000_create_accounts.sql`
- Modify: `docs/DATA_MODEL.md` (new section "User accounts" listing both tables), `docs/CONTRACTS.md` (add a proposed `VibeSignal`), `docs/DECISIONS.md` (add `P-012 · Proposed · User accounts and vibe-reactive theme`)

**Interfaces:**
- Produces:
  - Table `profiles(id uuid pk → auth.users on delete cascade, effects_enabled boolean not null default true, created_at, updated_at)`.
  - Table `vibe_events(id bigint identity pk, user_id uuid not null default auth.uid() → auth.users on delete cascade, created_at timestamptz default now(), source text check in ('quiz','text','image','song','place','dev'), scores jsonb not null, vocab_version smallint not null default 1, place_id text)`.
  - Index `(user_id, created_at desc)`.

- [ ] **Step 1: Create the branch.** Run `git switch -c feature/accounts-vibe-theme`. Expected: `Switched to a new branch`.
- [ ] **Step 2: Write the migration.** It must contain:
  - `public.is_valid_vibe_scores(s jsonb) returns boolean`: `immutable`, `language sql`. True iff `s` is a non-empty object whose every key is in the vocabulary and every value is a JSON number in [0, 1]. Used in `check (public.is_valid_vibe_scores(scores))`.
  - Both tables and the index.
  - `public.handle_new_user()`: `security definer set search_path = ''`. Inserts `(new.id)` into `public.profiles` with `on conflict do nothing`. Fired by trigger `on_auth_user_created after insert on auth.users`. A backfill `insert into public.profiles (id) select id from auth.users on conflict do nothing`.
  - `updated_at` trigger on `profiles`.
  - RLS enabled on both tables. Policies use `to authenticated`:
    - profiles: select, insert, update `using/with check (id = (select auth.uid()))`
    - vibe_events: select, insert, delete `using/with check (user_id = (select auth.uid()))`
  - Grants: `revoke all on public.profiles, public.vibe_events from anon;` `grant select, insert, update on public.profiles to authenticated;` `grant select, insert, delete on public.vibe_events to authenticated;` `revoke update on public.vibe_events from authenticated;`
- [ ] **Step 3: Write the docs.**
  - DATA_MODEL.md: the two tables and the RLS summary.
  - CONTRACTS.md: under §2, add
    `export interface VibeSignal { scores: Partial<Record<VibeKey, number>>; source: 'quiz' | 'text' | 'image' | 'song' | 'place' | 'dev'; placeId?: string }`
    marked **Proposed (P-012)**.
  - DECISIONS.md: P-012, with context, decision (from the spec §6), implications (VibeProfile.tags produced by the account module until Vibe workstream replaces it), and revisit trigger.
- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261121180000_create_accounts.sql docs/DATA_MODEL.md docs/CONTRACTS.md docs/DECISIONS.md docs/superpowers/specs/2026-11-21-user-accounts-vibe-theme-design.md docs/superpowers/plans/2026-11-21-user-accounts-vibe-theme.md
git commit -m "feat(db): add profiles and vibe_events with owner-only RLS"
```

(The SQL is exercised against the hosted project in Task 9.)

---

### Task 2: Vibe vocabulary and score validation

**Files:**
- Create: `src/features/account/vibes.ts`
- Test: `src/features/account/__tests__/vibes.test.ts`

**Interfaces:**
- Produces:
  - `VIBE_KEYS` (readonly tuple, vocabulary order)
  - `type VibeKey`
  - `type VibeScores = Partial<Record<VibeKey, number>>`
  - `VIBE_LABELS: Record<VibeKey, string>` (e.g. `date_night: 'Date night'`)
  - `VIBE_SOURCES` tuple and `type VibeSource`
  - `normalizeScores(input: unknown): VibeScores | null`

- [ ] **Step 1: Write the failing tests.**
  - `normalizeScores({ cozy: 0.8, lively: 0.2 })` → `{ cozy: 0.8, lively: 0.2 }`
  - Unknown keys dropped: `{ cozy: 0.5, electric: 0.9 }` → `{ cozy: 0.5 }`
  - Clamping: `{ cozy: 1.2, quiet: -0.1 }` → `{ cozy: 1, quiet: 0 }`
  - Non-finite or non-number values dropped: `{ cozy: NaN, quiet: '0.4', outdoor: Infinity, upscale: { a: 1 } }` → `null`
  - `null` for `{}`, `null`, arrays, strings, and objects with only unknown keys
  - `VIBE_KEYS` equals the 10 keys in Global Constraints order
- [ ] **Step 2: Run the tests to make sure they fail.** Run `npx vitest run src/features/account/__tests__/vibes.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `vibes.ts`.**
- [ ] **Step 4: Run the tests to make sure they pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(account): vibe vocabulary and score validation`

---

### Task 3: Taste from history

**Files:**
- Create: `src/features/account/taste.ts`
- Test: `src/features/account/__tests__/taste.test.ts`

**Interfaces:**
- Consumes: `VIBE_KEYS`, `VibeKey`, `VibeScores`, `VibeSource` (Task 2).
- Produces:
  - `interface VibeEvent { id: number; createdAt: string; source: VibeSource; scores: VibeScores; placeId: string | null }`
  - `interface Taste { profile: { userId: string; tags: Record<VibeKey, number> }; strength: number; topVibes: { key: VibeKey; score: number }[]; hasSample: boolean }`. `profile` is `Pick<VibeProfile, 'userId' | 'tags'>` from CONTRACTS.md; say so in a comment.
  - `computeTaste(userId: string, events: VibeEvent[], now: Date, opts: { includeDev: boolean }): Taste`
  - `topVibesOf(tags: Record<VibeKey, number>): { key: VibeKey; score: number }[]`. Keys ≥ `TOP_VIBE_THRESHOLD`, sorted descending, ties broken by `VIBE_KEYS` order, at most `MAX_TOP_VIBES`.
  - Exported constants: `HALF_LIFE_DAYS`, `FULL_STRENGTH_WEIGHT`, `TOP_VIBE_THRESHOLD`, `MAX_TOP_VIBES`.

The algorithm, as specified:
- `w = 0.5 ** (ageDays / HALF_LIFE_DAYS)`, with `ageDays = max(0, (now - createdAt) / 86_400_000)`.
- `tags[k] = Σ w·(scores[k] ?? 0) / Σ w` over the included events.
- `strength = min(1, Σw / FULL_STRENGTH_WEIGHT)`.
- No included events → every tag 0, strength 0, no top vibes.

- [ ] **Step 1: Write the failing tests.**
  - "empty history": all 10 tags 0, `strength` 0, `topVibes` `[]`, `hasSample` false.
  - "missing keys count as 0, so frequent beats rare-strong": 1× `{cozy: 1}` + 20× `{lively: 0.6}`, all at `now`. Expect `tags.lively ≈ 0.571`, `tags.cozy ≈ 0.048`, and `topVibes[0].key === 'lively'`.
  - "half-life": one event 14 days old has weight 0.5 → `strength === 0.1`.
  - "strength saturates": 6 events at `now` → `strength === 1`.
  - "dev rows excluded when includeDev is false and flagged when true": `hasSample` true only when included dev rows exist.
  - "future timestamps count as age 0".
  - `topVibesOf` threshold (0.35 in, 0.34 out), limit 3, tie order.
- [ ] **Step 2: Run the tests to make sure they fail.** Run `npx vitest run src/features/account/__tests__/taste.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `taste.ts`.**
- [ ] **Step 4: Run the tests to make sure they pass.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(account): decayed vibe taste`

---

### Task 4: Palette-driven map style and shared pin colors

**Files:**
- Modify: `src/mapStyle.ts`
- Create: `src/pinColors.ts`
- Modify: `src/main.ts:47-54` (replace the `CATEGORY_COLORS` literal with `import { PIN_COLORS as CATEGORY_COLORS } from './pinColors'`)
- Test: `src/mapStyle.test.ts`

**Interfaces:**
- Produces:
  - `type Palette = Record<PaletteKey, string>`, where `PaletteKey` is the existing palette keys plus:
    - `aeroway` (#e4e6ea)
    - `runway` (#d4d7dc)
    - `building3dMid` (#e2e0e6)
    - `building3dHigh` (#d9dbe6)
    - `neighbourhoodLabel` (#80868b)
    - `sky` (#bcd9f7)
    - `horizon` (#e9f2fb)
    - `light` (#ffffff)
  - `basePalette: Palette` holds exactly today's values, so the base map renders unchanged.
  - `buildMapStyle(p: Palette): StyleSpecification`, with the fog using `p.land` and top-level `transition: { duration: THEME_TRANSITION_MS, delay: 0 }`.
  - `export const THEME_TRANSITION_MS = 800`.
  - `export const mapStyle = buildMapStyle(basePalette)`.
  - Keep exports `BUILDING_3D_LAYER` and `BUILDING_3D_OPACITY`.
  - `src/pinColors.ts`: `export const PIN_COLORS: Record<string, string>`, the six existing entries copied verbatim.

- [ ] **Step 1: Write the failing tests.**
  - "every color in the built style comes from the palette": walk `JSON.stringify(buildMapStyle(basePalette))` for `#rrggbb` strings and assert each is one of `Object.values(basePalette)`.
  - "buildMapStyle reflects palette changes": `buildMapStyle({ ...basePalette, land: '#000000' })` has a background layer with `'background-color': '#000000'` and `sky['fog-color'] === '#000000'`.
  - "style has the theme transition": `.transition.duration === 800`.
- [ ] **Step 2: Run the tests to make sure they fail.** Run `npx vitest run src/mapStyle.test.ts`. Expected: FAIL (`buildMapStyle` not exported).
- [ ] **Step 3: Refactor `mapStyle.ts`.** Wrap the `layers` array and the style object in `buildMapStyle(p)` and replace the hard-coded hexes with the new keys. Create `pinColors.ts` and switch `main.ts` to import it.
- [ ] **Step 4: Run all tests and the build.** Run `npm test && npm run build`. Expected: all PASS, build succeeds.
- [ ] **Step 5: Commit** `refactor(map): build the map style from a palette`

---

### Task 5: Vibe palettes, blending and contrast guard

**Files:**
- Create:
  - `src/features/vibeTheme/color.ts`
  - `src/features/vibeTheme/palettes.ts`
  - `src/features/vibeTheme/blend.ts`
- Test:
  - `src/features/vibeTheme/__tests__/color.test.ts`
  - `src/features/vibeTheme/__tests__/blend.test.ts`

**Interfaces:**
- Consumes: `Palette`, `basePalette` (Task 4); `PIN_COLORS` (Task 4); `VIBE_KEYS`, `VibeKey` (Task 2); `topVibesOf` (Task 3).
- Produces:
  - `color.ts`:
    - `mix(a: string, b: string, t: number): string`: sRGB channel lerp, lowercase `#rrggbb`.
    - `contrastRatio(a: string, b: string): number`: WCAG 2.x relative luminance.
  - `palettes.ts`:
    - `VIBE_PALETTES: Record<VibeKey, Partial<Palette>>`. Builder's choice of colors, following the spec §6.4 character list.
    - `LIGHT_TEXT: Pick<Palette, 'textPrimary' | 'textSecondary' | 'halo' | 'neighbourhoodLabel' | 'waterLabel'>` (light text, dark halo).
  - `blend.ts`:
    - `export const MAX_SHIFT = 0.6`
    - `interface BlendResult { palette: Palette; darkMode: boolean; appliedStrength: number }`
    - `blendPalette(base: Palette, tags: Record<VibeKey, number>, strength: number): BlendResult`

`blendPalette` algorithm (not determined by the signature):

```
top = topVibesOf(tags)
for s from strength down to 0 in steps of 0.05 (always try s = 0 last):
  for each palette key K:
    defining = top vibes whose VIBE_PALETTES entry has K
    if none: K = base[K]
    else:
      target = per-channel weighted average of their K colors, weights = scores
      amount = MAX_SHIFT * s * max(score over defining)
      K = mix(base[K], target, amount)
  if textPrimary/textSecondary pass the bars on land
     and the weakest PIN_COLORS contrast on land ≥ the base floor:
       return { palette, darkMode: false, appliedStrength: s }
  swap in LIGHT_TEXT; pin edge = '#ffffff'
  if the same checks pass: return { palette, darkMode: true, appliedStrength: s }
```

At s = 0 the base palette is returned with `darkMode` false. The base floor is `min(contrastRatio(pin, base.land))` over `PIN_COLORS`, computed once.

- [ ] **Step 1: Write the failing tests.**
  - color: `mix('#000000', '#ffffff', 0.5) === '#808080'`; `contrastRatio('#000000', '#ffffff') ≈ 21`; `contrastRatio('#3c4043', '#f3f3f0') > 4.5`.
  - blend:
    - "strength 0 returns base": the result equals `basePalette`, `darkMode` false.
    - "no top vibes returns base": every tag 0.2.
    - "cozy at full strength changes land toward its target": `land !== base.land`.
    - "never moves more than MAX_SHIFT": for every key, the per-channel distance from base ≤ `0.6 × |target - base| + 1`.
    - "all single vibes and pairs satisfy the contrast bars": for each vibe and each unordered pair at score 1 and strength 1, assert textPrimary ≥ 4.5, textSecondary ≥ 3, and the weakest pin edge ≥ base floor − 1e-6 (edge `#ffffff` when `darkMode`).
    - "late_night at full strength yields darkMode or a reduced appliedStrength": documents the guard rather than a color.
- [ ] **Step 2: Run the tests to make sure they fail.** Run `npx vitest run src/features/vibeTheme`. Expected: FAIL.
- [ ] **Step 3: Implement the three modules.** Tune `VIBE_PALETTES` so that most single vibes keep `appliedStrength ≥ 0.6`. Log a table of `appliedStrength` per vibe in a scratch run to check.
- [ ] **Step 4: Run the tests to make sure they pass.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(theme): vibe palettes with contrast-guarded blending`

---

### Task 6: Applying a palette to the live map, and effect selection

**Files:**
- Create:
  - `src/features/vibeTheme/apply.ts`
  - `src/features/vibeTheme/effects.ts`
  - `src/features/vibeTheme/effects.css`
- Test:
  - `src/features/vibeTheme/__tests__/apply.test.ts`
  - `src/features/vibeTheme/__tests__/effects.test.ts`

**Interfaces:**
- Consumes: `buildMapStyle`, `Palette` (Task 4); `VibeKey`, `VIBE_KEYS` (Task 2); `topVibesOf` (Task 3).
- Produces:
  - `apply.ts`:
    - `interface PaintChange { layerId: string; property: string; value: unknown }`
    - `diffPaint(from: StyleSpecification, to: StyleSpecification): PaintChange[]`: compare `paint` objects by layer id with `JSON.stringify` equality.
    - `interface PaintTarget { setPaintProperty(id: string, prop: string, value: unknown): void; setSky(sky: unknown): void; setLight(light: unknown): void; getLayer(id: string): unknown }`
    - `applyPalette(map: PaintTarget, from: Palette, to: Palette): void`: build both styles, `diffPaint`, skip layers where `map.getLayer(id)` is falsy, never set `fill-extrusion-opacity`, and call `setSky` / `setLight` only when they differ.
  - `effects.ts`:
    - `export const EFFECT_VIBES = 2`
    - `effectLayers(tags: Record<VibeKey, number>, strength: number): { key: VibeKey; opacity: number }[]`: the first `EFFECT_VIBES` of `topVibesOf(tags)`, `opacity = score × strength`, rounded to 2 decimals.
    - `mountEffects(container: HTMLElement): { render(layers: { key: VibeKey; opacity: number }[], darkMode: boolean): void; destroy(): void }`
      - Creates `div.vibe-effects[aria-hidden=true]` inserted right after the map canvas inside `map.getCanvasContainer()`, so it sits under the markers.
      - One child `div.vibe-effect.vibe-effect--<key>` per layer, with `style.opacity`.
      - Toggles `document.body.classList` `vibe-dark` on `darkMode`.
  - `effects.css`:
    - `.vibe-effects { position:absolute; inset:0; pointer-events:none; }`
    - one rule per vibe key: CSS gradients and keyframes only, with `transition: opacity 800ms`
    - `@media (prefers-reduced-motion: reduce) { .vibe-effect { animation: none !important } }`
    - `.vibe-dark .pin path { stroke: #fff; stroke-width: 1.5 }`

- [ ] **Step 1: Write the failing tests.**
  - "diffPaint returns only changed paints": base vs `{ ...basePalette, land: '#000000' }` includes the `background` layer change, and every change's value differs from `from`.
  - "identical palettes produce no changes".
  - "ignores layers not in the built style and never sets fill-extrusion-opacity": a fake `PaintTarget` records calls. `getLayer` returns undefined for `'water'` → no call for `water`. No recorded prop is `fill-extrusion-opacity`.
  - "setSky only when sky colors change".
  - effects: two layers max, ordered by score, opacity = score × strength; empty when no top vibes.
- [ ] **Step 2: Run the tests to make sure they fail.** Run `npx vitest run src/features/vibeTheme`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement `apply.ts`, `effects.ts` and `effects.css`.**
- [ ] **Step 4: Run the tests to make sure they pass.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(theme): paint-diff palette application and vibe effects`

---

### Task 7: Account store over an injectable backend

**Files:**
- Create:
  - `src/features/account/backend.ts`
  - `src/features/account/session.ts`
- Test: `src/features/account/__tests__/session.test.ts`

**Interfaces:**
- Consumes: `createStore` (`src/discovery/store.ts`); `normalizeScores`, `VibeScores`, `VibeSource` (Task 2); `computeTaste`, `Taste`, `VibeEvent` (Task 3).
- Produces (`backend.ts`):

```ts
export interface AccountUser { id: string; email: string }
export interface AccountProfile { effectsEnabled: boolean }
export interface AccountBackend {
  getUser(): Promise<AccountUser | null>;
  onAuthChange(cb: (user: AccountUser | null) => void): () => void;
  signIn(email: string, password: string): Promise<{ error?: string }>;
  signUp(email: string, password: string): Promise<{ error?: string; needsConfirmation?: boolean }>;
  signOut(): Promise<void>;
  loadProfile(userId: string): Promise<AccountProfile>;              // upserts a missing row
  saveEffectsEnabled(userId: string, enabled: boolean): Promise<void>;
  loadEvents(limit: number): Promise<VibeEvent[]>;                    // newest first
  insertEvent(e: { scores: VibeScores; source: VibeSource; placeId?: string }): Promise<VibeEvent>;
  deleteAllEvents(userId: string): Promise<void>;
}
export function createSupabaseBackend(client: SupabaseClient): AccountBackend;
export function createAccountClient(): SupabaseClient | null; // env as catalog.ts, auth options from Global Constraints
```

`signUp` passes `options.emailRedirectTo = window.location.origin`. `needsConfirmation` is `!data.session`. Map Supabase errors to short user copy: invalid credentials, rate limited, network, or else the message.

- Produces (`session.ts`):

```ts
export type AccountState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'signed_out'; error?: string; notice?: 'confirm_email' }
  | { status: 'signed_in'; user: AccountUser; profile: AccountProfile; events: VibeEvent[]; taste: Taste; error?: string };
export type RecordResult = { recorded: true } | { recorded: false; reason: 'signed_out' | 'invalid' | 'error' };
export interface AccountStore {
  getState(): AccountState;
  subscribe(listener: (s: AccountState) => void): () => void;
  start(): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  setEffectsEnabled(enabled: boolean): Promise<void>;   // optimistic; reverts and sets error on failure
  clearHistory(): Promise<void>;
  recordVibe(signal: { scores: unknown; source: VibeSource; placeId?: string }): Promise<RecordResult>;
}
export const HISTORY_LIMIT = 200;
export function createAccountStore(backend: AccountBackend | null, opts: { includeDev: boolean; now?: () => Date }): AccountStore;
```

Behavior:
- `backend === null` → `unavailable`.
- Each auth change bumps a generation counter. Async results from an older generation are dropped.
- Leaving `signed_in` discards `events` and `taste` immediately.
- `recordVibe` appends the inserted event and recomputes taste without refetching.

- [ ] **Step 1: Write the failing tests** with an in-memory fake `AccountBackend` (deferred promises for ordering):
  - "null backend is unavailable"
  - "start with no user → signed_out"
  - "sign-in loads profile and events and computes taste"
  - "signUp needing confirmation → signed_out with notice confirm_email"
  - "sign-in error surfaces as signed_out.error"
  - "recordVibe while signed out → { recorded:false, reason:'signed_out' } and no insert"
  - "recordVibe with invalid scores → reason 'invalid'"
  - "recordVibe updates taste immediately"
  - "insert failure → reason 'error', state unchanged"
  - "setEffectsEnabled is optimistic and reverts on failure"
  - "clearHistory empties events and taste strength becomes 0"
  - "events that resolve after sign-out are ignored"
  - "sign-out then sign-in as another user never exposes the first user's events": capture every emitted state and assert none pairs user B with A's event ids
  - "includeDev false ignores dev rows in taste"
- [ ] **Step 2: Run the tests to make sure they fail.** Run `npx vitest run src/features/account/__tests__/session.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `session.ts` and `backend.ts`.** `backend.ts` is not unit-tested; it is verified in Task 9.
- [ ] **Step 4: Run the tests and the build.** Run `npm test && npm run build`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(account): account store and Supabase backend`

---

### Task 8: Theme controller, account UI and wiring

**Files:**
- Create:
  - `src/features/vibeTheme/controller.ts`
  - `src/features/account/ui.ts`
  - `src/features/account/account.css`
  - `src/features/account/index.ts`
- Test: `src/features/vibeTheme/__tests__/controller.test.ts`
- Modify:
  - `src/main.ts`: one import, plus one call after the discovery panel mounts: `mountAccount(document.body, { map })`
  - `src/style.css`: in the ≤640px block, `.search-wrap { width: calc(100% - 60px) }` so the button fits

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `controller.ts`:
    - `interface ThemeTarget { tags: Record<VibeKey, number>; strength: number }`
    - `themeFor(state: AccountState): ThemeTarget | null`: null unless signed in with `profile.effectsEnabled`, at least one event, and `taste.strength > 0`.
    - `startThemeController(map: MapLibreMap, store: AccountStore): { preview(tags: VibeScores, strength: number): void; destroy(): void }`
      - Applies the theme after `map.loaded()` or the `load` event.
      - Keeps the current palette and moves to `blendPalette(basePalette, target.tags, target.strength).palette` via `applyPalette`. It goes back to `basePalette` when the target is null.
      - Renders `effectLayers(target.tags, appliedStrength)` and `darkMode`.
      - `preview` overrides the store target until the next store change.
  - `index.ts`: `mountAccount(container: HTMLElement, opts: { map: MapLibreMap }): { store: AccountStore; destroy(): void }`
    - Creates the client, backend and store with `includeDev: import.meta.env.DEV`. Calls `start()`, mounts the UI and starts the controller.
    - In DEV only, assigns `window.vibentaAccount = { recordVibe: (scores: unknown) => store.recordVibe({ scores, source: 'dev' }), previewTaste: controller.preview }`.
    - Re-exports `recordVibe` access for the Vibe Engine via the returned `store`.
  - `ui.ts`:
    - `mountAccountUi(container: HTMLElement, store: AccountStore): () => void`
    - Builds `button.account-btn` fixed at top 12px, right 12px, height 48px, using `--surface`, `--shadow` and `--radius`. It shows "Sign in", or the uppercase first letter of the email with an `aria-label` of "Account: <email>". When unavailable it is disabled with the title "Accounts unavailable".
    - Builds `div.account-popover[role=dialog][aria-label=Account]` with the spec §6.3 contents and copy.
    - Behavior: Escape and an outside click close the popover; focus goes to the first field or control on open and back to the button on close. "Clear my vibe history" asks for an inline confirm (a second button) first. "Includes sample vibes" shows when `taste.hasSample`. Each top-vibe chip has a bar whose width is `score × 100%`.

- [ ] **Step 1: Write the failing test** `controller.test.ts` for `themeFor`:
  - null for `loading`, `unavailable` and `signed_out`
  - null when `effectsEnabled` is false
  - null with no events
  - a target equal to `{ tags: taste.profile.tags, strength: taste.strength }` otherwise
- [ ] **Step 2: Run the test to make sure it fails.** Run `npx vitest run src/features/vibeTheme/__tests__/controller.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the controller, UI, CSS and index, and wire up `main.ts` and `style.css`.**
- [ ] **Step 4: Run all tests and the build.** Run `npm test && npm run build`. Expected: PASS.
- [ ] **Step 5: Check in the browser without the schema** (works before Task 9). Start the dev server (`preview_start`), then check that:
  - the button renders top right and doesn't overlap search at desktop or 375px width
  - the sign-in popover opens and closes with Escape, an outside click and focus return
  - `window.vibentaAccount.previewTaste({ cozy: 0.9 }, 1)` visibly re-tints the map with a smooth transition, then `previewTaste({ late_night: 1 }, 1)`, then `previewTaste({}, 0)` returns it to base
  - effects don't block a map drag or a pin click
  - a drawn route survives a theme change
  - the console has no errors
- [ ] **Step 6: Commit** `feat(account): top-right account UI and vibe theme controller`

---

### Task 9: Push the schema and verify end to end

**Files:** none (unless verification finds bugs).

- [ ] **Step 1: The user authenticates the CLI.** Ask the user to run these themself, in a terminal in the repo root. Tokens and the database password must not pass through the agent.

```powershell
npx supabase@3.2.0 login
```
```powershell
npx supabase@3.2.0 link --project-ref <their project ref>
```

- [ ] **Step 2: Check the migration history.** Run `npx supabase@3.2.0 migration list`.
  - Expected: `20261121180000` is local-only.
  - If `20261121120000` (restaurants) also shows as local-only, the table was created outside the CLI. **Ask the user** before running `npx supabase@3.2.0 migration repair --status applied 20261121120000`, because otherwise `db push` would try to recreate `restaurants`.
- [ ] **Step 3: Push.** Run `npx supabase@3.2.0 db push`. Expected: it applies `20261121180000_create_accounts.sql` with no errors.
- [ ] **Step 4: Verify in the browser against the hosted project.** Use test accounts generated in-session, recorded in the scratchpad and not in chat:
  1. Sign up account A: signed in straight away (confirmations off), and the empty-state copy shows.
  2. Reload: still signed in.
  3. Sign out, then sign in with a wrong password: an inline error.
  4. Sign in, then run `vibentaAccount.recordVibe({ cozy: 0.9, quiet: 0.6 })` ×3. The map tints, the chips show Cozy and Quiet, and the "Includes sample vibes" badge shows.
  5. Toggle "Map effects" off: the base map returns. Reload: it stays off. Toggle it back on.
  6. Draw a route, then record another vibe: the route stays.
  7. Sign up account B: base map, no chips. In devtools, run `await (await import('/src/features/account/client.ts')).createAccountClient().from('vibe_events').select('*')` → `[]` (RLS).
  8. Back in A, "Clear my vibe history": the base map returns and the chips are gone.
  9. Mobile width 375px: layout OK.
- [ ] **Step 5: Run the final suite.** Run `npm test && npm run build`. Expected: PASS. Fix anything found and commit with a `fix(...)` message.
