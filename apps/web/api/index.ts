// Vercel Function entry. vercel.json rewrites every /api/* request here; Express routes on the
// original path, so the same app serves production and local dev (server/index.ts).
import app from "../server/app.ts";

export default app;
