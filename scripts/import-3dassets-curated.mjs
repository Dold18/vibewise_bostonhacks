#!/usr/bin/env node
/**
 * Curated CC0 GLB importer for Vibenta Scene assets.
 *
 * Default: --dry-run.  To actually download:
 *   node scripts/import-3dassets-curated.mjs --download
 *   node scripts/import-3dassets-curated.mjs --download --family orchestra --limit 6
 *   node scripts/import-3dassets-curated.mjs --download --max-mb 12
 *
 * Read pack metadata from the publisher's public API; DO NOT scrape HTML.
 * Never import an entire pack accidentally: only the exact named models
 * in curated-3dassets.v1.json may be fetched.
 */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "apps/web/public/scene-assets/sources/curated-3dassets.v1.json");
const outputRoot = path.join(root, "apps/web/public/scene-assets/third-party/3dassets");
const config = JSON.parse(await fs.readFile(sourcePath, "utf8"));
const args = process.argv.slice(2);
function option(name, fallback) {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
}
const download = args.includes("--download");
const family = option("--family", null);
const limit = Number(option("--limit", "1000"));
const maxMB = Number(option("--max-mb", "12"));
if (!Number.isInteger(limit) || limit < 1 || !Number.isFinite(maxMB) || maxMB <= 0) {
  throw new Error("--limit must be a positive integer and --max-mb a positive number");
}
if (!["1.0.0"].includes(config.schemaVersion)) throw new Error("Unsupported source manifest version");
const families = config.families.filter((f) => !family || f.id === family);
if (!families.length) throw new Error("Unknown --family; see curated-3dassets.v1.json");
const maxBytes = Math.floor(maxMB * 1024 * 1024);
const maxPerFile = 4 * 1024 * 1024;
const timeoutMS = 25000;
let used = 0, count = 0;
const manifest = {
  schemaVersion: "1.0.0", provider: "3DAssets.dev",
  status: download ? "curated_import_execution" : "dry_run_no_files_downloaded",
  timestamp: new Date().toISOString(), request: { family, limit, maxMB },
  caveat: "Downloaded files are unreviewed; no 3D rendering or visual QA is implied.",
  files: [], skipped: [],
};

async function getResponse(url) {
  const resp = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMS),
    headers: { "Accept": "application/json,model/gltf-binary,application/octet-stream", "User-Agent": "VibentaSceneAssetImporter/1.0" },
  });
  if (!resp.ok) throw new Error("HTTP " + resp.status + " for " + url);
  return resp;
}
function findAsset(assets, expectedTitle, packTitle) {
  const exact = expectedTitle.toLowerCase().trim();
  const matches = assets.filter((a) => {
    const title = String(a.title || "").toLowerCase().trim();
    return title === exact || title === exact + " (" + packTitle.toLowerCase() + ")";
  });
  return matches.length === 1 ? matches[0] : null;
}
function checkedUrl(raw) {
  const u = new URL(raw);
  if (u.protocol !== "https:" || u.hostname !== "cdn.3dassets.dev" || !/^\/assets\/\d+\/v\d+\/model\.glb$/.test(u.pathname)) {
    throw new Error("Unapproved asset URL: " + raw);
  }
  return u.href;
}
function checkGLB(buf) {
  if (buf.length < 20 || buf.toString("ascii", 0, 4) !== "glTF") throw new Error("Not a binary glTF");
  if (buf.readUInt32LE(4) !== 2 || buf.readUInt32LE(8) !== buf.length) throw new Error("Invalid GLB v2 header or length");
}
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
for (const f of families) {
  if (count >= limit) break;
  const apiUrl = "https://3dassets.dev/api/v1/packs/" + encodeURIComponent(f.packSlug);
  const response = await getResponse(apiUrl);
  const payload = await response.json();
  const pack = payload.data;
  if (!pack || !Array.isArray(pack.assets) || pack.slug !== f.packSlug || pack.licenseLabel !== "CC0 1.0 Universal") {
    throw new Error("Publisher response has unexpected structure or license for " + f.packSlug);
  }
  for (const chosen of f.wanted) {
    if (count >= limit) break;
    const a = findAsset(pack.assets, chosen.title, pack.title);
    if (!a) {
      manifest.skipped.push({ family: f.id, title: chosen.title, reason: "missing_or_ambiguous_exact_title" });
      console.warn("MISSING", f.id, chosen.title);
      continue;
    }
    if (a.license?.slug !== "cc0-1.0") {
      manifest.skipped.push({ family: f.id, title: chosen.title, reason: "individual_license_not_CC0" });
      continue;
    }
    const assetUrl = checkedUrl(a.cdnUrl);
    const expectedSize = Number(a.stats?.fileSize);
    if (!Number.isInteger(expectedSize) || expectedSize <= 0 || expectedSize > maxPerFile || used + expectedSize > maxBytes) {
      manifest.skipped.push({ family: f.id, title: chosen.title, reason: "size_budget_or_unknown_size", expectedSize });
      continue;
    }
    const filename = slugify(chosen.title) + "-" + a.id + ".glb";
    const rel = f.id + "/" + filename;
    const entry = {
      id: "3dassets." + f.id + "." + a.id,
      title: chosen.title, packSlug: f.packSlug,
      assetPage: a.url, providerUrl: assetUrl,
      path: rel, tags: chosen.tags,
      license: "CC0-1.0", aiGenerated: a.aiGenerated === true,
      expectedBytes: expectedSize, triangles: a.stats?.triangles ?? null,
      meters: a.stats?.sizeMeters ?? null, glbV2Valid: false,
      sha256: null, status: download ? "pending" : "source_verified_pending_download",
    };
    if (!download) {
      console.log("PLAN", entry.id, entry.expectedBytes, chosen.title);
      manifest.files.push(entry); count++; used += expectedSize;
      continue;
    }
    try {
      const res = await getResponse(assetUrl);
      const arrayBuffer = await res.arrayBuffer();
      const buf = Buffer.from(arrayBuffer);
      if (buf.length > maxPerFile || used + buf.length > maxBytes) throw new Error("Actual bytes exceed limit");
      if (buf.length !== expectedSize) throw new Error("Unexpected file size (source changed)");
      checkGLB(buf);
      const dir = path.join(outputRoot, f.id);
      await fs.mkdir(dir, { recursive: true });
      const temp = path.join(dir, filename + ".tmp");
      const dest = path.join(dir, filename);
      await fs.writeFile(temp, buf);
      await fs.rename(temp, dest);
      entry.sha256 = crypto.createHash("sha256").update(buf).digest("hex");
      entry.glbV2Valid = true;
      entry.status = "imported_unreviewed";
      entry.bytes = buf.length;
      used += buf.length; count++;
      console.log("IMPORTED", entry.id, buf.length, dest);
      manifest.files.push(entry);
    } catch (err) {
      manifest.skipped.push({ family: f.id, title: chosen.title, reason: String(err.message || err) });
      console.warn("SKIPPED", f.id, chosen.title, String(err.message || err));
    }
  }
}
manifest.totalFiles = manifest.files.length;
manifest.totalBytes = used;
manifest.missing = manifest.skipped.filter((e) => e.reason === "missing_or_ambiguous_exact_title").length;
if (download) {
  await fs.mkdir(outputRoot, { recursive: true });
  await fs.writeFile(path.join(outputRoot, "manifest.v1.json"), JSON.stringify(manifest, null, 2) + "\n");
}
console.log(JSON.stringify({ mode: download ? "download" : "dry-run", picked: count, bytes: used, issues: manifest.skipped.length }, null, 2));
if (manifest.skipped.length) process.exitCode = 1;
