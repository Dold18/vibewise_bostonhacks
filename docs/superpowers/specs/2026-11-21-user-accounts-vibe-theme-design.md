# User accounts and a vibe-reactive map theme — design

> **Status:** Draft for approval · 2026-11-21 · Map workstream, with Integration (accounts) and Vibe (signal producer)

## 1. Intent

Signed-in users get a map that looks like *them*. Every vibe signal the Vibe Engine produces for a user is recorded against their account. Over repeat visits, their most frequent vibes tint the map's palette and add subtle on-screen effects: cozy is warm and glowing, late-night is dark with faint stars, lively is bright with drifting sparkles. The point is a relationship: the app visibly gets to know you. Effects can be turned off in account settings.

"Most popular" means popular **with that user**, from their own history. It never means popular across all users.

## 2. Goals

1. Email + password sign-up, sign-in and sign-out through Supabase Auth, with the session kept across reloads.
2. An account control in the **top right** of the screen:
   - Signed out: a "Sign in" button that opens a small sign-in / create-account form.
   - Signed in: a round avatar button (the email's first letter) that opens an account panel with the email, top vibes so far, a **Map effects** on/off toggle, **Clear my vibe history**, and **Sign out**.
3. A private, owner-only history of vibe signals (`vibe_events`) and a per-user settings row (`profiles`).
4. A `recordVibe(...)` API that the Vibe Engine calls whenever it produces vibe scores for the signed-in user.
5. The user's taste, derived from that history, drives:
   - the map palette (base colors blended toward each top vibe's colors), and
   - an effects overlay (vignette, glow, grain, sparkles, stars).
   Both transition smoothly.
6. A dev-only hook to feed sample vibes in, so the theme can be shown before the Vibe Engine ships.

## 3. Non-goals

- Producing vibe signals. No vibe chips or quiz in this work. The Vibe Engine (Workstream C) is the only producer; until it ships, real users' history stays empty and their map stays plain.
- Google/OAuth sign-in, magic links, password reset by email. All of these need Supabase email delivery or OAuth credentials (see §6.1).
- Using the taste for ranking or filtering places. It is visual only, for now.
- Theming for signed-out visitors, or keeping history in the browser.
- Global or cross-user popularity, sharing profiles, group mode.
- Storing any location: no origin, no GPS, no movement history.

## 4. Anti-goals (failure even if it "works")

- **Lost readability:** themed labels or pins fall below WCAG 4.5:1 contrast against land.
- **Getting in the way:** effects block clicks or drags, or noticeably drop the frame rate while panning.
- **Losing map state:** a theme change wipes the route overlay, pins or 3D tilt.
- **Exposing data:** one user can read another user's history, or the history holds location.
- **Faking it:** a real user sees a theme built from made-up vibes. Sample vibes are dev-only and labeled.

## 5. Constraints (from the repo)

- Vite + vanilla TypeScript app in `apps/web`. MapLibre GL 6 on OpenFreeMap tiles. `@supabase/supabase-js` 2 is already a dependency.
- The browser uses only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (already in `apps/web/.env`). No new secrets.
- `src/catalog.ts` creates its own client with `persistSession: false`. Leave it alone. Accounts get a separate client with sessions on and its own `storageKey`, which avoids the "multiple GoTrueClient" clash.
- `supabase/config.toml` (local): email sign-up on, confirmations off, `site_url` is the Vite dev URL. The hosted project's settings are not in the repo and may require email confirmation; the UI must handle both cases.
- Migrations live in `supabase/migrations/` and follow the timestamp naming. The Supabase CLI is not installed locally (Docker is), so RLS is verified against the hosted project by hand.
- Ownership (docs/WORKSTREAMS.md):
  - `main.ts` and `mapStyle.ts` are map-owned. The map owner is driving this work.
  - New code goes in `src/features/account/**` and `src/features/vibeTheme/**`.
  - The vibe vocabulary keys come from DATA_MODEL.md §3 and must not be redefined.
- Tests: `npm test` (vitest, Node, no DOM) and `npm run build` (tsc + vite) from `apps/web`.

## 6. Design

### 6.1 Approaches considered

| Approach | Trade-off | Outcome |
|---|---|---|
| **1. Rebuild the palette and apply only what changed, plus a separate effects overlay** | Turns `mapStyle.ts` into a function of a palette. One source of truth for colors; the whole map shifts coherently; text contrast can be guarded. | **Chosen** by the user. |
| 2. Recolor chosen layers at runtime from a hand-kept list of layers to colors | Smaller change to `mapStyle.ts`, but the list drifts out of date as the style changes. | Rejected. |
| 3. CSS filters on the map canvas | Fastest, but tints labels and pins, hurts contrast, and doesn't feel like a different map. | Rejected. |

Sign-in method:

- **Chosen (proposal, not raised by the user): email + password.** It works without email delivery when confirmations are off.
- Magic links: rejected for now. Supabase's built-in email sending is heavily rate-limited on hosted projects, which is risky in a demo.
- Google OAuth: rejected for now. It needs OAuth credentials set up first.

### 6.2 Data (new migration `supabase/migrations/<ts>_create_accounts.sql`)

```sql
create table profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  effects_enabled boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table vibe_events (
  id            bigint generated by default as identity primary key,
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at    timestamptz not null default now(),
  source        text not null check (source in ('quiz', 'text', 'image', 'song', 'place', 'dev')),
  scores        jsonb not null,           -- {"cozy": 0.8, ...}; DATA_MODEL.md §3 keys, values in [0,1]
  vocab_version smallint not null default 1,
  place_id      text                      -- optional: a catalog place the signal came from
);
create index vibe_events_user_time_idx on vibe_events (user_id, created_at desc);
```

- **Profile creation:** a `security definer` trigger on `auth.users` insert creates the row. The client also upserts its own row on sign-in, in case the trigger was added after the user signed up.
- **RLS:** enabled on both tables. `profiles`: the owner can select, insert and update where `id = auth.uid()`. `vibe_events`: the owner can select, insert and delete where `user_id = auth.uid()`; nobody can update. `anon` gets no grants.
- **Scores check:** a check constraint (or a small SQL function) requires `scores` to be a non-empty JSON object, with every value a number in [0, 1]. The client validates first; the database is the backstop.
- **`dev` source:** dev-only `dev` rows must not leak into real use, so they are written only by the dev hook. "Clear my vibe history" removes them along with everything else.

### 6.3 Account module (`src/features/account/`)

- `client.ts`: the auth-enabled Supabase client. It is `null` when the env vars are missing; the UI then shows a disabled "Accounts unavailable" button with a tooltip.
- `session.ts`: an observable account store built on the existing `createStore` pattern. States:
  - `loading`
  - `signed_out`
  - `signed_in`, with `{ user, profile, taste }`
  - `error`
  It listens to `onAuthStateChange`. On sign-in it loads the profile and the newest 200 `vibe_events`.
- `recordVibe({ scores, source, placeId? })` is the Vibe Engine's entry point.
  - Returns `{ recorded: false, reason: 'signed_out' | 'invalid' | 'error' }` or `{ recorded: true }`.
  - It drops unknown keys and clamps values to [0, 1].
  - It updates the taste immediately with the new event, without waiting for a refetch.
- `taste.ts` (pure, unit-tested):
  - **Weighting:** each event's weight is `0.5 ^ (ageDays / 14)`, so a two-week half-life.
  - **Taste:** `taste[k]` is the weighted mean of `scores[k]` over **all** events, with a missing key counting as 0. A vibe that shows up often then beats one rare strong score. *(My call, from the builder check.)*
  - **Strength:** `min(1, Σweight / 5)`, so one or two signals give a gentle theme and about five recent ones give the full theme.
  - **Top vibes:** keys with `taste ≥ 0.35`, highest first, at most 3.
  - **Output shape:** the result is exposed as the CONTRACTS.md `VibeProfile` (`{ userId, tags }`), and the theme reads only `VibeProfile.tags`. The Vibe workstream can later replace this derivation with its own Vibe DNA without touching the theme. *(My call.)*
- **Sample (`dev`) rows:** production builds leave `source = 'dev'` rows out of the taste entirely. In dev builds they count, and the account panel shows an "Includes sample vibes" badge whenever they contribute. *(My call.)*
- **Email confirmation:** sign-up passes `emailRedirectTo: window.location.origin`, and the client keeps `detectSessionInUrl` on, so a confirmation link signs the user in when they land back on the map. If sign-up returns no session, the form shows "Check your email to confirm". *(My call.)*
- UI (`ui.ts` plus CSS):
  - A fixed button in the top right, at the same height as the search bar (top 12px, right 12px). It uses the app's existing surface, shadow and radius tokens.
  - Clicking it opens a popover anchored below.
  - **Signed-out form:** email, password, a "Sign in" / "Create account" switch, inline errors (wrong credentials, network, rate limit), and a "Check your email to confirm" state when the hosted project requires confirmation.
  - **Signed-in panel:**
    - the email
    - top vibes as labeled chips with a strength bar, or the empty state "Your map will start to reflect your vibes as you explore."
    - the Map effects toggle, which saves to `profiles` with an optimistic update
    - "Clear my vibe history", with an inline confirm; it deletes all of the user's `vibe_events`, after which the theme returns to base
    - "Sign out"
  - **Accessibility:** Escape and an outside click close the popover; focus moves into it and returns to the button. On phones (≤640px) the search bar narrows so the button still fits on the same row.

### 6.4 Theme (`src/features/vibeTheme/` and `mapStyle.ts`)

- `mapStyle.ts`: export `buildMapStyle(palette)` and `basePalette`. Keep `mapStyle = buildMapStyle(basePalette)` so current callers don't change. Move the sky, fog and light colors into the palette. Add `transition: { duration: 800, delay: 0 }` so paint changes animate.
- `palettes.ts`: for each of the 10 vibe keys, a set of target colors for some palette entries (not all of them). For example:
  - cozy: warm amber land, cream roads
  - late_night: a dark slate base
  - outdoor: richer greens
  - upscale: cream and muted gold
  - aesthetic: soft pastel shift
  - lively: saturated accents
  - quiet: desaturated cool
  - divey: worn warm grey
  - date_night: dusky rose
  - group_friendly: bright, sunny warmth
- `blendPalette(base, taste, strength)` (pure, tested):
  - Each top vibe pulls its target entries from the base color by `weight × strength × 0.95`, so a strong vibe restyles the map almost completely but never entirely. *(Raised from 0.6 on 2026-11-21 at the user's request: the themes weren't stylized enough, and late_night could barely ever go dark.)*
  - Vibes apply weakest first, so the strongest has the last word. If clashing vibes (late_night with a light one) can only be readable at strength 0, the strongest vibe is used alone.
  - Light vibes keep `land` bright (pins), so their character comes from buildings, roads, water, parks and sky, which get bold targets.
  - **Contrast guard** *(my call: the base map already misses 4.5:1 for pins and some labels, so pins get a relative bar)*:
    - The hard-coded label colors in `mapStyle.ts` (e.g. neighbourhood `#80868b`) move into the palette.
    - After blending, `textPrimary` must stay ≥ 4.5:1 and `textSecondary` ≥ 3:1 against `land`. If not, switch to the light-text set (light text, dark halo) and re-check.
    - Pins (DOM markers colored in `main.ts`) keep their colors. The weakest pin's contrast against the blended `land` must stay at or above the weakest pin's contrast on today's map (restaurant orange on `land`, about 2.6:1).
    - When the light-text set is active, pins get a white outline, and that outline is what gets measured.
    - If any check fails, the blend is weakened step by step until all checks pass; strength 0 is today's map, which always passes. *(Refined while planning: mid-grey land fails every pin color, so a per-pin rule would rule out dark themes entirely.)*
    - Tests cover every single vibe at full strength and pairs of vibes.
- `applyPalette(map, from, to)`:
  - Build both styles and call `setPaintProperty` only for paint values that differ, layer by layer. Then call `setSky` / `setLight` if those changed.
  - It does **not** use `map.setStyle`, which would remove the route overlay and the catalog pins' runtime layers.
  - The 3D building opacity driven by the tilt toggle is not a palette value, so it is never touched.
- **Effects overlay:**
  - One `div.vibe-effects` sits between the map canvas and the UI chrome, with `pointer-events: none` and `aria-hidden`.
  - It draws the **top two** vibes' effects, with opacity scaled by their weight × strength.
  - Effects are CSS gradients and animations only: no canvas, no images.
  - `prefers-reduced-motion` freezes all animation.
- `controller.ts`: subscribes to the account store and works out the theme to show:
  - signed out, effects off, or no history → the base palette and no effects;
  - otherwise → the blended palette and the effects.
  It applies the result once the map's `load` event has fired.

### 6.5 Wiring

- `main.ts` gets one call: `mountAccount(document.body, { map })`. That mounts the button and starts the theme controller. No other map logic changes.
- In dev builds only: `window.vibewiseAccount = { recordVibe, previewTaste }`.
  - `recordVibe(..., source 'dev')` writes real rows for the signed-in user.
  - `previewTaste({ cozy: 0.9 }, strength)` themes the map without writing anything, which is useful when not signed in.

### 6.6 Contracts and docs

- `recordVibe` takes vibe scores in the vocabulary that CONTRACTS.md's `VibeProfile.tags` already references. Add a **proposed** `VibeSignal` type to CONTRACTS.md as `{ scores, source, placeId? }` and log decision **P-014 · Proposed** in DECISIONS.md. Both need team ratification; the code ships against the proposal.
- Add the `profiles` and `vibe_events` tables to DATA_MODEL.md.

## 7. Verification

- **Unit (vitest):**
  - taste weighting, strength and top vibes
  - score validation (unknown keys, out-of-range values, non-numbers)
  - palette blending and the contrast guard, for all 10 vibes and pairs
  - `applyPalette` diffing: only changed paints are set; runtime layers are untouched
- **Build:** `npm run build`.
- **Applying the migration (decided):** install the Supabase CLI through npx in this session. The user logs in and links the hosted project themself, so no tokens pass through the agent. The agent then runs `supabase db push`. The hosted project has email confirmation **off** (decided), so sign-up signs users straight in. The "check your email" path stays as a fallback.
- **Taste ownership (decided):** this work ships its own taste calculation now, published as `VibeProfile`. The Vibe workstream may replace it later.
- **Manual, against the hosted project after the push:**
  1. Sign up, sign out, sign in, then reload with the session kept.
  2. Wrong password shows an error.
  3. Record dev vibes; the theme changes smoothly while a route is drawn, and the route stays.
  4. Toggle effects off and on.
  5. Clear history.
  6. A second account can't see the first account's rows: query `vibe_events` while signed in as B and get zero of A's rows.
  7. Check the mobile width.

## 8. Left to the builder

- Exact colors per vibe, and what each effect looks like, within the contrast guard and "subtle" spirit.
- Popover styling details and copy.
- Tuning the half-life, strength and threshold constants (keep them as named constants).
- Whether the score check lives in a SQL check constraint or a validation function.
