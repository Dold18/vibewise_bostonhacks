// Local configuration for the API process, with no machine-specific paths. Every file that exists is
// read, first value wins, and values already in the environment (a shell export, Vercel's project
// settings) always win over files:
//   1. VIBENTA_ENV_FILE, when set: an extra file kept outside the repository.
//   2. The repository-root .env: server keys (GEMINI_API_KEY, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, MBTA_API_KEY).
//   3. apps/web/.env: the browser's public values, so catalog search can fall back to
//      VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY when the root file doesn't name SUPABASE_*.
// Missing files are skipped; on Vercel none exist and process.env is already populated.
export function localEnvFiles(): Array<string | URL> {
  const files: Array<string | URL> = [new URL("../../../.env", import.meta.url), new URL("../.env", import.meta.url)];
  return process.env.VIBENTA_ENV_FILE ? [process.env.VIBENTA_ENV_FILE, ...files] : files;
}

export function loadLocalEnv(files = localEnvFiles()) {
  for (const file of files) {
    try { process.loadEnvFile(file); } catch { /* absent or unreadable: values may come from the environment */ }
  }
}
