// Local dev API server. Vite proxies /api here (see vite.config.ts); in production the same
// app runs as a Vercel Function instead (api/index.ts).
// Run: `npm run server` (or `npm run dev:all` for Vite + this together). Needs Node >= 22.
import app from "./app.ts";

const port = Number(process.env.TRANSIT_API_PORT ?? 8787);
app.listen(port, "127.0.0.1", () => console.log(`transit API on http://127.0.0.1:${port}`));
