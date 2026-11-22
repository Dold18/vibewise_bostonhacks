// The API's Express app, shared by the local dev server (server/index.ts) and the Vercel
// Function (api/index.ts). The browser never imports the transit module; it POSTs to
// /api/transit/route, and only this server-side code imports it.
import express from "express";
import { createVibeRouter } from "./vibeApi.ts";
import { loadLocalEnv } from "./env.ts";
import { planTripLive } from "../src/features/transit/ride.ts";

// Local runs read VIBENTA_ENV_FILE (if set), the repo-root .env and apps/web/.env (see env.ts).
// On Vercel there is no file: values come from the project's environment variables.
loadLocalEnv();

const isPoint = (p: unknown): p is { lat: number; lng: number } => {
  const o = p as { lat?: unknown; lng?: unknown } | null;
  return !!o && typeof o.lat === "number" && typeof o.lng === "number" &&
    Math.abs(o.lat) <= 90 && Math.abs(o.lng) <= 180;
};

const app = express();
// Behind Vercel's proxy the socket address is the proxy's, so every visitor would share one
// rate-limit bucket in vibeApi.ts. Trust X-Forwarded-For only when actually deployed there.
if (process.env.VERCEL) app.set("trust proxy", true);
app.use(express.json({ limit: "64kb" }));

app.post("/api/transit/route", async (req, res) => {
  const { origin, destination } = req.body ?? {};
  if (!isPoint(origin) || !isPoint(destination)) {
    res.status(400).json({ status: "error", message: "Body must be {origin:{lat,lng}, destination:{lat,lng}}." });
    return;
  }
  try {
    res.json(await planTripLive(origin, destination));
  } catch (e) {
    res.status(500).json({ status: "error", message: `Transit planner failed: ${(e as Error).message}` });
  }
});

app.use("/api/vibe", createVibeRouter());

export default app;
