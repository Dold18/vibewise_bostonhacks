// Dev API server for the transit engine. The browser never imports the transit module; it
// POSTs to /api/transit/route (proxied here by Vite), and only this server-side file imports it.
// Run: `npm run server` (or `npm run dev:all` for Vite + this together). Needs Node >= 22.
import express from "express";
import { planTripLive } from "../src/features/transit/ride.ts";

try { process.loadEnvFile(new URL("../../../.env", import.meta.url)); } catch { /* no .env: MBTA keyless */ }

const isPoint = (p: unknown): p is { lat: number; lng: number } => {
  const o = p as { lat?: unknown; lng?: unknown } | null;
  return !!o && typeof o.lat === "number" && typeof o.lng === "number" &&
    Math.abs(o.lat) <= 90 && Math.abs(o.lng) <= 180;
};

const app = express();
app.use(express.json({ limit: "10kb" }));

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

const port = Number(process.env.TRANSIT_API_PORT ?? 8787);
app.listen(port, "127.0.0.1", () => console.log(`transit API on http://127.0.0.1:${port}`));
