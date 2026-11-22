#!/usr/bin/env node
/**
 * Offline integrity/structure validation for imported scene-library assets.
 * Run from the repo root: node scripts/validate-scene-assets.mjs
 *
 * This checks disk files, Git blob identity, binary/glTF structure and
 * external resources. It does NOT imply visual, accessibility or GPU QA.
 */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = path.join(root, "apps/web/public");
const modelibrPath = path.join(publicRoot, "scene-assets/third-party/modelibr/manifest.v1.json");
const kaykitPath = path.join(publicRoot, "scene-assets/third-party/kaykit/manifest.v1.json");
const modelibr = JSON.parse(await fs.readFile(modelibrPath, "utf8"));
const kaykit = JSON.parse(await fs.readFile(kaykitPath, "utf8"));
const errs = [];
const ids = new Set();
let glbs = 0, gltfs = 0, bytes = 0;
function assert(value, message) { if (!value) errs.push(message); }
function safePublicPath(url) {
  if (typeof url !== "string" || !url.startsWith("/scene-assets/") || url.includes("..") || url.includes("\\")) throw Error("Invalid public asset path: " + url);
  const target = path.resolve(publicRoot, "." + url);
  if (!target.startsWith(publicRoot + path.sep)) throw Error("Asset path escapes public root: " + url);
  return target;
}
function verifyId(m) { assert(typeof m.id === "string" && m.id.length > 0 && !ids.has(m.id), "Duplicate/missing model ID: " + m.id); ids.add(m.id); }
const gitBlobSha = bytes => crypto.createHash("sha1").update(Buffer.from("blob " + bytes.length + "\0")).update(bytes).digest("hex");
for (const m of modelibr.models) {
  verifyId(m);
  try {
    const p = safePublicPath(m.uri), b = await fs.readFile(p); bytes += b.length;
    assert(b.length === m.bytes, m.id + " expected " + m.bytes + " bytes, got " + b.length);
    assert(b.length >= 20 && b.toString("ascii", 0, 4) === "glTF", m.id + " invalid GLB magic");
    if (b.length >= 20) {
      assert(b.readUInt32LE(4) === 2, m.id + " invalid GLB version");
      assert(b.readUInt32LE(8) === b.length, m.id + " GLB declared length mismatch");
      const len = b.readUInt32LE(12), kind = b.readUInt32LE(16);
      assert(kind === 0x4E4F534A && len > 0 && len <= b.length - 20, m.id + " invalid JSON chunk");
      if (kind === 0x4E4F534A && len > 0 && len <= b.length - 20) {
        try { const j = JSON.parse(b.toString("utf8", 20, 20 + len)); assert(j.asset?.version === "2.0", m.id + " glTF JSON not version 2"); assert(Array.isArray(j.meshes) && j.meshes.length > 0, m.id + " no meshes"); }
        catch (e) { errs.push(m.id + " JSON parse: " + e.message); }
      }
    }
    assert(gitBlobSha(b) === m.gitBlobSHA, m.id + " sha mismatch");
    glbs++;
  } catch (e) { errs.push(m.id + " " + e.message); }
}
for (const m of kaykit.models) {
  verifyId(m);
  try {
    const p = safePublicPath(m.uri), text = await fs.readFile(p, "utf8"), j = JSON.parse(text);
    assert(j.asset?.version === "2.0", m.id + " invalid glTF version");
    assert(Array.isArray(j.meshes) && j.meshes.length > 0, m.id + " missing meshes");
    const dir = path.dirname(p);
    const buffer = j.buffers?.[0];
    assert(buffer && buffer.uri === m.externalBuffer, m.id + " external buffer URI wrong");
    if (buffer?.uri) {
      const raw = await fs.readFile(path.join(dir, buffer.uri));
      assert(raw.length === buffer.byteLength, m.id + " buffer length mismatch");
    }
    const png = await fs.readFile(path.join(dir, m.sharedTexture));
    assert(png.length >= 8 && png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])), m.id + " invalid PNG atlas");
    assert(j.images?.some(x => x.uri === m.sharedTexture), m.id + " does not reference shared atlas");
    gltfs++;
  } catch (e) { errs.push(m.id + " " + e.message); }
}
assert(modelibr.models.length === modelibr.modelCount, "Modelibr manifest count mismatch");
assert(kaykit.models.length === kaykit.modelCount, "KayKit manifest count mismatch");
const report = { ok: errs.length === 0, glbsValidated: glbs, gltfsValidated: gltfs, totalValidated: glbs + gltfs, totalModelibrBytes: bytes, errors: errs };
console.log(JSON.stringify(report, null, 2));
if (errs.length) process.exitCode = 1;
