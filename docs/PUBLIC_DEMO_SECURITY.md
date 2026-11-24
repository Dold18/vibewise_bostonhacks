# Public demo security — Gemini billing protection

## Policy for the hosted VibeWise demo

**The public VibeWise deployment does not consume a team-owned Gemini API key.** The default server generator in [`apps/web/server/vibeApi.ts`](../apps/web/server/vibeApi.ts) rejects generation requests in Vercel runtimes (`VERCEL` is set) or whenever `NODE_ENV=production`, **even if** a `GEMINI_API_KEY` environment variable remains configured.

- `GET /api/vibe/status` reports `geminiConfigured: false` and `quizMode: "public-demo-fallback"` on public production deployments.
- `POST /api/vibe/generate` responds with an unavailable error rather than calling Gemini. The existing [client-side fallback quiz engine](../apps/web/src/features/vibe/liveEngine.ts) continues the experience with bounded local questions. It is less contextually creative than live Gemini.
- MiniLM embeddings, configured catalog search, map rendering, place exploration, saved locations, and supported MBTA routing are separate integrations and are **not intentionally disabled by this change**.
- The `createGeminiGenerator` implementation is retained for historical reproducibility, tests, and **explicitly enabled local development**; public requests cannot activate it by adding a key to request headers, URL parameters, or JSON bodies.

## Required deployment and credential actions

**Code protection is not a substitute for revocation.** A new GitHub commit cannot revoke an existing credential, and previous Vercel deployments may remain reachable until deployment is updated.

1. **Have the teammate who owns the Gemini key revoke/delete it immediately** in [Google AI Studio](https://aistudio.google.com/apikey) or the relevant Google Cloud project. Check usage and billing for unexpected consumption.
2. In Vercel, open the project's **Settings → Environment Variables**. Remove `GEMINI_API_KEY` from every relevant environment (**Production, Preview, Development**) and ensure no `VIBE_ENABLE_LOCAL_GEMINI` setting is enabled there. A model name (`VIBE_GEMINI_MODEL`) is not a secret but is unnecessary for the public demo.
3. **Redeploy** the GitHub commit containing this guard. Editing Vercel environment variables does not alter already-deployed immutable functions. Confirm that the production domain is using the new deployment.
4. Open [the public status endpoint](https://vibewise-bostonhacks.vercel.app/api/vibe/status) and check for `geminiConfigured: false` and `quizMode: "public-demo-fallback"`. Try a quiz and verify that locally generated questions appear. Check Google API usage after release.
5. Audit previews, alternate domains, and older deployments if they remain publicly reachable. Revoking the old key is the decisive protection across any still-running deployment.

**What this change cannot do automatically:** access the Google account, revoke the key at its provider, remove values from the Vercel dashboard, or prove that a redeploy has completed. Those controls belong to the team's provider accounts.

## Run the full Gemini experience privately with your own key

The repository includes a local opt-in so developers can still reproduce the hackathon's Gemini-backed quiz without relying on someone else's billing account.

```bash
cp .env.example .env
# Edit the ignored root .env; set your own GEMINI_API_KEY and:
# VIBE_ENABLE_LOCAL_GEMINI=true
cd apps/web
npm install
npm run dev:all
```

The local API binds to `127.0.0.1` by default. The opt-in works only when the server is **not** in a production runtime and the flag equals the literal string `true`. Never commit API keys or place them in `VITE_` variables.

The place catalog and transit integrations are configured independently. A local Gemini key alone does not supply Supabase catalog vectors or MBTA data.

## Should the site ask visitors for their own Gemini API key?

**Not as a launch or onboarding requirement.** A portfolio reviewer should be able to experience the map and fallback quiz immediately. Asking visitors to paste a secret into a team-hosted website creates unnecessary friction and a serious trust issue: the key could transit a server the visitor does not control. Even if a future key-entry feature is built with ephemeral storage, transparent consent and strict isolation would be needed.

For now, publish the **charge-free demo**, and let developers who need the full AI experience use their own local environment. A future user-owned credential flow should be separately threat-modeled and tested rather than introduced in a quick security patch.

## Verification

The [server test suite](../apps/web/src/features/vibe/__tests__/server.test.ts) includes a regression test that configures a synthetic Gemini key and the local opt-in flag, then runs the default API router in both Vercel and production environments. In both cases it expects a `503` for generation, a fallback-mode status, and **zero calls to Google's generation endpoint**.

This documentation does not claim the tests were executed in this documentation-editing environment. Historical product QA reports are separate from this security regression test.
