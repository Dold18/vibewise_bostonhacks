// Visual QA for the Vibenta identity redesign: real headless-Chrome screenshots
// of the running app at several viewports, scenes and road zooms.
//
// Usage: start Vite (`npm run dev -- --host 127.0.0.1 --port 5196 --strictPort`), then
//   node scripts/visual-identity-browser.mjs [shotsFile.json]
// Env: VIBENTA_QA_URL (default http://127.0.0.1:5196/), VIBENTA_QA_OUTPUT,
//      CHROME_PATH, VIBENTA_QA_GL=swiftshader to force software GL.
// Network calls to Overpass/Nominatim are answered with empty TEST FIXTURES so
// screenshots are deterministic; map tiles and fonts load from their real hosts.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const URL_BASE = process.env.VIBENTA_QA_URL ?? 'http://127.0.0.1:5196/';
const OUT = process.env.VIBENTA_QA_OUTPUT ?? '/private/tmp/vibenta-identity-qa';
mkdirSync(OUT, { recursive: true });
const port = 9300 + Math.floor(Math.random() * 400);
const gl = process.env.VIBENTA_QA_GL === 'swiftshader'
  ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  : ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'];
const chrome = spawn(
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${OUT}/chrome-${Date.now()}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', ...gl, 'about:blank'],
  { stdio: 'ignore' },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 80; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.some((t) => t.type === 'page')) break; } catch {}
  await sleep(200);
}
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
const handlers = new Map();
const errors = [];
ws.onmessage = (m) => {
  const a = JSON.parse(m.data);
  if (a.id) { pending.get(a.id)?.(a); pending.delete(a.id); }
  handlers.get(a.method)?.(a.params);
  if (a.method === 'Runtime.exceptionThrown') errors.push(a.params.exceptionDetails.exception?.description ?? a.params.exceptionDetails.text);
  if (a.method === 'Runtime.consoleAPICalled' && a.params.type === 'error') errors.push(a.params.args.map((x) => x.value ?? x.description).join(' '));
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++id;
  pending.set(n, (a) => (a.error ? reject(Error(`${method}: ${a.error.message}`)) : resolve(a.result)));
  ws.send(JSON.stringify({ id: n, method, params }));
});
const js = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const shot = async (name) => {
  const c = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(c.data, 'base64'));
  console.log('shot', `${OUT}/${name}.png`);
};
const waitIdle = () => js(`new Promise(r=>{const m=window.vibentaScene?.map;if(!m)return r(false);let done=false;const fin=()=>{if(!done){done=true;r(true)}};m.once('idle',fin);m.triggerRepaint();setTimeout(fin,9000)})`);

handlers.set('Fetch.requestPaused', async (p) => {
  try {
    const u = p.request.url;
    const fixture = u.includes('overpass') ? { elements: [] } : u.includes('nominatim') ? [] : null;
    if (fixture) {
      await send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(fixture)).toString('base64') });
    } else await send('Fetch.continueRequest', { requestId: p.requestId });
  } catch (e) { errors.push(String(e)); }
});

await send('Page.enable');
await send('Runtime.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: '*overpass*' }, { urlPattern: '*nominatim*' }] });

const defaults = [
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'desktop-1366', width: 1366, height: 768 },
  { name: 'mobile-390', width: 390, height: 844, mobile: true },
  { name: 'mobile-360', width: 360, height: 640, mobile: true },
];
const shots = process.argv[2] ? JSON.parse(readFileSync(process.argv[2], 'utf8')) : defaults;

let loadedFor = '';
for (const s of shots) {
  await send('Emulation.setDeviceMetricsOverride', { width: s.width, height: s.height, deviceScaleFactor: s.scale ?? 1, mobile: !!s.mobile });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: s.reducedMotion === false ? 'no-preference' : 'reduce' }] });
  const url = URL_BASE + (s.query ?? '');
  const key = `${url}|${s.width}x${s.height}`;
  if (s.reload !== false || loadedFor !== key) {
    await send('Page.navigate', { url });
    for (let i = 0; i < 100; i++) { if (await js('!!window.vibentaScene?.map?.loaded?.()').catch(() => false)) break; await sleep(200); }
    await js('document.fonts?.ready.then(()=>true)');
    loadedFor = key;
  }
  for (const step of s.steps ?? []) {
    if (typeof step === 'number') await sleep(step);
    else await js(`(async()=>{await (${step});return true})()`);
  }
  await waitIdle();
  await sleep(s.settle ?? 600);
  if (s.probe) console.log('probe', s.name, JSON.stringify(await js(s.probe)));
  await shot(s.name);
}
writeFileSync(`${OUT}/errors.json`, JSON.stringify(errors, null, 2));
console.log(errors.length ? `console errors: ${errors.length} (see ${OUT}/errors.json)` : 'no console errors');
ws.close();
chrome.kill();
process.exit(0);
