// City Changer integrated QA (Run 8) on the real Boston map with EVERY renderer enabled:
// building appearance, world surfaces, world decorations, atmosphere, composer-driven.
//
// Start the app first:  TRANSIT_API_PORT=8807 node server/index.ts   and   npx vite --port 5207
//   VIBENTA_QA_URL     default http://localhost:5207/
//   VIBENTA_QA_OUTPUT  default /private/tmp/vibenta-city-changer-qa
//   QA_MODE            smoke | worlds | seeds | continuity | navigation | perf | all   (default smoke)
//   QA_DPR             device scale factor (default 1)
//   QA_HEADED=1        run a visible (headed) Chrome window instead of headless
//
// Every world is captured from the SAME camera (center, zoom, pitch, bearing, viewport, navigation).
// Frame cost: synchronous map.redraw() + 1-pixel readPixels (waits for the GPU), so numbers are
// CPU+GPU per frame and not capped by vsync; plus rAF frame intervals during real camera motion.
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

const URL_ = process.env.VIBENTA_QA_URL ?? 'http://localhost:5207/';
const OUT = process.env.VIBENTA_QA_OUTPUT ?? '/private/tmp/vibenta-city-changer-qa';
const MODE = process.env.QA_MODE ?? 'smoke';
const DPR = Number(process.env.QA_DPR ?? 1);
const W = 1440, H = 900;
const SEED = Number(process.env.QA_SEED ?? 424242);
const PORT = 9600 + Math.floor(Math.random() * 300);
const PROFILE = `${OUT}/chrome-${Date.now()}`;
mkdirSync(OUT, { recursive: true });

const chrome = spawn(process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  ...(process.env.QA_HEADED ? [] : ['--headless=new']), `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--no-first-run', '--no-default-browser-check', '--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist',
  `--window-size=${W},${H}`, `--force-device-scale-factor=${DPR}`, '--enable-precise-memory-info',
  // A headed window that is unfocused or covered must still animate (macOS occlusion pauses rAF).
  '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 100; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (targets.some((t) => t.type === 'page')) break; } catch {}
  await sleep(200);
}
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
const errors = [];
ws.onmessage = (m) => {
  const a = JSON.parse(m.data);
  if (a.id) { pending.get(a.id)?.(a); pending.delete(a.id); }
  if (a.method === 'Runtime.exceptionThrown') errors.push(a.params.exceptionDetails.exception?.description ?? a.params.exceptionDetails.text);
  if (a.method === 'Runtime.consoleAPICalled' && (a.params.type === 'error' || a.params.type === 'warning'))
    errors.push(`${a.params.type}: ${a.params.args.map((x) => x.value ?? x.description).join(' ')}`.slice(0, 400));
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++id;
  pending.set(n, (a) => (a.error ? reject(Error(`${method}: ${a.error.message}`)) : resolve(a.result)));
  ws.send(JSON.stringify({ id: n, method, params }));
});
const log = (...a) => console.error(new Date().toISOString().slice(11, 19), ...a);
const js = async (expression, timeoutMs = 90000) => {
  let timer;
  const r = await Promise.race([
    send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }),
    new Promise((_, reject) => (timer = setTimeout(() => reject(Error(`evaluate timed out: ${expression.slice(0, 120)}`)), timeoutMs))),
  ]).finally(() => clearTimeout(timer));
  if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const waitFor = async (expression, tries = 240) => {
  for (let i = 0; i < tries; i++) { if (await js(expression).catch(() => false)) return; await sleep(250); }
  throw Error(`Timed out: ${expression}`);
};
const shot = async (name, clip) => {
  const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 82, ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
  writeFileSync(`${OUT}/${name}.jpg`, Buffer.from(data, 'base64'));
  return `${name}.jpg`;
};

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: false });
await send('Page.navigate', { url: `${URL_}?seed=${SEED}` });
await waitFor(`!!(window.vibentaCity && window.vibentaScene && window.vibentaScene.map && window.vibentaScene.map.loaded())`);
await sleep(1500);
log('app ready');

// In-page helpers: camera, settle (all renderers done), and a compact report of what is drawn.
await js(`(() => {
  const map = vibentaScene.map;
  const R = vibentaCity.renderers;
  const idle = () => new Promise((res) => { if (map.loaded() && !map.isMoving() && map.areTilesLoaded()) { map.once('idle', res); map.triggerRepaint(); } else map.once('idle', res); setTimeout(res, 8000); });
  window.__qa = {
    camera(c) { map.jumpTo({ center: c.center, zoom: c.zoom, pitch: c.pitch, bearing: c.bearing }); return idle().then(() => true); },
    async settle(ms = 2600) {
      await new Promise((r) => setTimeout(r, 250));
      for (let i = 0; i < 80; i++) { const d = R.decorations.decor(); if (d || !vibentaCity.plan()) break; await new Promise((r) => setTimeout(r, 100)); if (i > 20) break; }
      R.streets.surfaces()?.flush();
      const d = R.decorations.decor(); if (d) { try { await d.settled(); } catch {} }
      for (let i = 0; i < 60; i++) { const b = R.buildings.stats(); if (!b.appearance || (b.engine && b.engine.buildings > 0 && b.engine.textures.length >= 0)) break; await new Promise((r) => setTimeout(r, 100)); }
      await new Promise((r) => setTimeout(r, ms));
      await idle();
      return true;
    },
    report() {
      const plan = vibentaCity.plan();
      const sec = (s) => plan ? Object.fromEntries(Object.entries(plan.sections[s].treatments).map(([k, t]) => [k, t.style + '@' + t.intensity.toFixed(2)])) : {};
      const b = R.buildings.stats();
      const surf = R.streets.surfaces();
      const rec = surf?.recipe();
      const d = R.decorations.decor()?.stats();
      const atmo = R.atmosphere.renderer();
      const last = vibentaCity.composer.last();
      const st = vibentaScene.state();
      return {
        seed: vibentaCity.seed(),
        sceneHash: st.hash, planHash: plan?.hash ?? null,
        presets: st.presets, source: st.source, navigation: st.context?.navigation,
        grade: Object.fromEntries(['global_grade.palette_family','sky_and_horizon.sky_mode','lighting_and_shadows.light_color','cinematic_and_artistic.render_aesthetic','building_surfaces.wall_palette','building_surfaces.roof_palette'].map((k) => [k, st.resolved[k]])),
        sections: { buildings: sec('buildings'), streets: sec('streets'), decorations: sec('decorations'), atmosphere: sec('atmosphere') },
        buildings: { mounted: b.mounted, updates: b.updates, families: b.appearance?.facades.map((f) => f.label) ?? [], roofs: b.appearance?.roofs.map((r) => r.label) ?? [], strength: b.appearance?.strength ?? 0, night: b.appearance?.lighting.night ?? 0, engine: b.engine && { buildings: b.engine.buildings, triangles: b.engine.triangles, buildMs: Math.round(b.engine.buildMs), uploads: b.engine.uploads, uniformUpdates: b.engine.uniformUpdates, gpuDrawMs: b.engine.gpuDrawMs, textures: b.engine.textures.length, missing: b.engine.missingAssets, skippedSeamEdges: b.engine.skippedSeamEdges } },
        streets: rec && { presence: +rec.presence.toFixed(2), roads: rec.roads.minor + '/' + rec.roads.major, walk: rec.walk.material, ground: rec.ground.material, green: rec.green.material, lamps: rec.lamps.style + '@' + rec.lamps.intensity.toFixed(2), stats: surf.stats() },
        decor: d && { motifs: d.theme?.motifs, strength: d.theme?.strength, hidden: d.theme?.hidden, cast: d.cast, onScreen: d.onScreen, shown: d.shown ?? d.instances, collisions: d.collisions, timing: d.timing },
        atmosphere: atmo && { passes: atmo.plan().params ? Object.fromEntries(Object.entries(atmo.plan().params).filter(([, v]) => typeof v === 'number' && v > 0.01).map(([k, v]) => [k, +v.toFixed(2)])) : null, load: atmo.stats().plan.load, quality: atmo.stats().quality, layers: atmo.stats().layers },
        composer: last && { fidelity: last.plan.provenance.fidelity, overrides: last.plan.provenance.overrides, anchors: last.plan.provenance.anchors, unrealized: last.plan.provenance.unrealized.length, coherenceOk: last.plan.coherence.ok, confidence: last.plan.confidence, presence: last.plan.presence, compositionId: last.plan.compositionId },
        city: vibentaCity.stats().renderers.map((r) => ({ id: r.id, status: r.status, deliveries: r.deliveries, failures: r.failures, overBudget: r.overBudget })),
        disabled: st.disabled.length,
      };
    },
    async frameCost(n = 20) {
      const gl = map.painter.context.gl, px = new Uint8Array(4), t = [];
      for (let i = 0; i < n; i++) { const t0 = performance.now(); map.redraw(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); t.push(performance.now() - t0); }
      t.sort((a, b) => a - b);
      return { median: +t[Math.floor(n / 2)].toFixed(2), p90: +t[Math.floor(n * 0.9)].toFixed(2), max: +t[n - 1].toFixed(2) };
    },
    async motion(kind, ms = 3000) {
      const frames = []; let last = performance.now(), live = true;
      const loop = (now) => { frames.push(now - last); last = now; if (live) requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
      const c = map.getCenter(), z = map.getZoom(), b = map.getBearing();
      if (kind === 'pan') map.easeTo({ center: [c.lng + 0.006, c.lat + 0.002], duration: ms, easing: (x) => x });
      if (kind === 'orbit') map.easeTo({ bearing: b + 90, duration: ms, easing: (x) => x });
      if (kind === 'zoom') map.easeTo({ zoom: z - 1.2, duration: ms, easing: (x) => x });
      await new Promise((r) => setTimeout(r, ms + 150));
      live = false;
      map.jumpTo({ center: c, zoom: z, bearing: b });
      frames.shift();
      if (!frames.length) return { frames: 0, fps: 0, median: 0, p95: 0, max: 0, over50ms: 0 };
      const s = [...frames].sort((a, b2) => a - b2);
      const long = frames.filter((f) => f > 50).length;
      return { frames: frames.length, fps: +(1000 / (frames.reduce((a, b2) => a + b2, 0) / frames.length)).toFixed(1), median: +s[Math.floor(s.length / 2)].toFixed(1), p95: +s[Math.floor(s.length * 0.95)].toFixed(1), max: +s[s.length - 1].toFixed(1), over50ms: long };
    },
    memory() { const m = performance.memory; return m ? { usedMB: Math.round(m.usedJSHeapSize / 1048576), totalMB: Math.round(m.totalJSHeapSize / 1048576) } : null; },
  };
})()`);

const CAMERAS = {
  backbay: { center: [-71.0795, 42.3505], zoom: 16.6, pitch: 58, bearing: -28 },
  beacon: { center: [-71.0690, 42.3585], zoom: 17.0, pitch: 55, bearing: 20 },
  downtown: { center: [-71.0590, 42.3555], zoom: 17.2, pitch: 60, bearing: 30 },
  waterfront: { center: [-71.0505, 42.3600], zoom: 16.4, pitch: 55, bearing: -40 },
  common: { center: [-71.0660, 42.3550], zoom: 16.5, pitch: 55, bearing: 10 },
};
const VIBES = [
  ['neutral', null],
  ['jazz', 'nostalgic warm jazz evening'],
  ['synthwave', 'futuristic synthwave arcade'],
  ['haunted', 'haunted but romantic'],
  ['botanical', 'peaceful botanical afternoon'],
  ['playful', 'bright playful outing'],
  ['bookstore', 'cozy rainy bookstore atmosphere'],
  ['noir', 'dark cinematic noir'],
  ['contradictory', 'energetic but intimate'],
  ['cuisine', 'ramen and dumplings'],
];

const results = { url: URL_, seed: SEED, viewport: { W, H, DPR }, mode: MODE, worlds: [], errors };
const compose = async (text, outing) => {
  if (text === null) await js(`vibentaScene.clear()`);
  else await js(`void vibentaCity.compose(${JSON.stringify(text)}, ${JSON.stringify(outing ?? 'qa')})`);
};
const world = async (name, text, camName, extra = {}) => {
  const errBefore = errors.length;
  const t0 = Date.now();
  await compose(text, extra.outing ?? `qa-${name}`);
  await js(`__qa.settle(${extra.settleMs ?? 2600})`);
  const settleMs = Date.now() - t0;
  const report = await js(`__qa.report()`);
  const file = await shot(`${extra.prefix ?? ''}${camName}-${name}`);
  const entry = { name, text, camera: camName, file, settleMs, report, newErrors: errors.slice(errBefore) };
  results.worlds.push(entry);
  log(name, camName, `settle ${settleMs}ms`, `b:${report.buildings.families.join('|')}`, `s:${report.streets?.roads}`, `d:${JSON.stringify(report.decor?.onScreen)}`, `fid:${report.composer?.fidelity}`);
  return entry;
};

try {
  if (MODE === 'smoke') {
    await js(`__qa.camera(${JSON.stringify(CAMERAS.backbay)})`);
    await world('neutral', null, 'backbay');
    await world('bookstore', 'cozy rainy bookstore atmosphere', 'backbay');
    await world('synthwave', 'futuristic synthwave arcade', 'backbay');
  }
  if (MODE === 'worlds' || MODE === 'all') {
    for (const cam of (process.env.QA_CAMERAS ?? 'backbay,beacon,downtown,waterfront').split(',')) {
      await js(`__qa.camera(${JSON.stringify(CAMERAS[cam])})`);
      for (const [name, text] of VIBES) await world(name, text, cam);
      await compose(null);
    }
  }
  if (MODE === 'seeds' || MODE === 'all') {
    await js(`__qa.camera(${JSON.stringify(CAMERAS.backbay)})`);
    for (const seed of [11, 22, 33]) {
      await js(`vibentaCity.reseed(${seed})`);
      for (const [name, text] of [['jazz', 'nostalgic warm jazz evening'], ['botanical', 'peaceful botanical afternoon']]) await world(`${name}-seed${seed}`, text, 'backbay', { prefix: 'seeds-', outing: `seed-${name}` });
    }
    // Same input + same seed again ⇒ identical scene hash and identical buildings.
    await js(`vibentaCity.reseed(22)`);
    await world('jazz-seed22-repeat', 'nostalgic warm jazz evening', 'backbay', { prefix: 'seeds-', outing: 'seed-jazz' });
  }
  if (MODE === 'continuity' || MODE === 'all') {
    await js(`__qa.camera(${JSON.stringify(CAMERAS.backbay)})`);
    await js(`vibentaCity.reseed(${SEED})`);
    const steps = [
      ['c0-original', { text: ['cozy jazz evening'], progression: { answers: 1 } }],
      ['c1-minor', { text: ['cozy jazz evening', 'a little candlelit'], progression: { answers: 2 } }],
      ['c2-minor', { text: ['cozy jazz evening', 'a little candlelit', 'quiet corner table'], progression: { answers: 3 } }],
      ['c3-major', { text: ['cozy jazz evening', 'actually make it a neon synthwave arcade'], mood: ['energetic', 'futuristic'], progression: { answers: 4 } }],
    ];
    for (const [name, signals] of steps) {
      const errBefore = errors.length;
      await js(`void vibentaCity.compose(${JSON.stringify(signals)}, 'continuity')`);
      await js(`__qa.settle()`);
      const report = await js(`__qa.report()`);
      results.worlds.push({ name, signals, camera: 'backbay', file: await shot(`continuity-${name}`), report, newErrors: errors.slice(errBefore) });
      log(name, report.composer?.compositionId, report.buildings.families.join('|'));
    }
    for (const name of ['u1-undo', 'u2-undo']) {
      await js(`void vibentaCity.undo()`);
      await js(`__qa.settle()`);
      const report = await js(`__qa.report()`);
      results.worlds.push({ name, camera: 'backbay', file: await shot(`continuity-${name}`), report });
      log(name, report.sceneHash);
    }
  }
  if (MODE === 'navigation' || MODE === 'all') {
    await js(`__qa.camera(${JSON.stringify(CAMERAS.common)})`);
    await world('nav-before', 'futuristic synthwave arcade', 'common', { prefix: 'nav-', outing: 'nav' });
    await js(`vibentaScene.navigation('route')`);
    await js(`__qa.settle()`);
    results.worlds.push({ name: 'nav-route', camera: 'common', file: await shot('nav-common-route'), report: await js(`__qa.report()`) });
    await js(`vibentaScene.navigation(false)`);
    await js(`__qa.settle()`);
    results.worlds.push({ name: 'nav-restored', camera: 'common', file: await shot('nav-common-restored'), report: await js(`__qa.report()`) });
  }
  if (MODE === 'perf' || MODE === 'all') {
    const perf = {};
    for (const [cam, text] of [['downtown', 'futuristic synthwave arcade'], ['beacon', 'cozy rainy bookstore atmosphere']]) {
      await js(`__qa.camera(${JSON.stringify(CAMERAS[cam])})`);
      await compose(text, `perf-${cam}`);
      await js(`__qa.settle()`);
      const p = { static: await js(`__qa.frameCost(30)`) };
      for (const kind of ['pan', 'orbit', 'zoom']) { p[kind] = await js(`__qa.motion('${kind}', 3000)`); await js(`__qa.settle(800)`); }
      const t0 = Date.now();
      await compose('peaceful botanical afternoon', `perf-${cam}`);
      await js(`__qa.settle(0)`);
      p.transitionToSettledMs = Date.now() - t0;
      p.memory = await js(`__qa.memory()`);
      p.report = await js(`__qa.report()`);
      perf[cam] = p;
      log(cam, JSON.stringify({ static: p.static, pan: p.pan.fps, orbit: p.orbit.fps, zoom: p.zoom.fps }));
    }
    results.perf = perf;
  }
} catch (e) {
  results.fatal = String(e?.stack ?? e);
  log('FATAL', e);
} finally {
  writeFileSync(`${OUT}/report-${MODE}.json`, JSON.stringify(results, null, 2));
  log(`errors: ${errors.length}`);
  ws.close();
  chrome.kill();
  // Profiles are ~50-100 MB each; keep only the screenshots and the report.
  await new Promise((r) => chrome.once('exit', r));
  rmSync(PROFILE, { recursive: true, force: true });
}
