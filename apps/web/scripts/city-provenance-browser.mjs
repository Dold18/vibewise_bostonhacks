// Back/forward-cache behavior and retained-memory regression checks.
// Run against the ordinary application; VIBENTA_QA_URL and VIBENTA_QA_OUTPUT override defaults.
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

const URL_ = process.env.VIBENTA_QA_URL ?? 'http://localhost:5207/';
const OUT = process.env.VIBENTA_QA_OUTPUT ?? '/private/tmp/vibenta-city-main-lifecycle';
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




const checks=[];const check=(name,ok,detail)=>{checks.push({name,ok:!!ok,detail});log(ok?'PASS':'FAIL',name,JSON.stringify(detail??''));};
try{
 await send('Runtime.enable');await send('Page.enable');
 await send('Page.navigate',{url:URL_+'?seed=424242'});await waitFor('!!window.vibentaCity&&vibentaScene.map.loaded()');
 await js(`document.querySelector('.vb-continue-btn').click();const t=document.querySelector('.vb-vibe-story');t.value='Jazz and candlelight';t.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.vb-begin-quiz').click()`);
 await waitFor('vibentaOutingProfiles.getSnapshot()?.embedding.status==="ready"');
 await js(`window.__profile=vibentaOutingProfiles.getSnapshot();vibentaOutingProfiles.publish({...__profile,version:__profile.version+10,qualifiers:['haunted','christmas']})`);await sleep(2400);
 const plain=await js('({themes:vibentaScene.state().context.themeEvidence,provenance:vibentaCity.renderers.decorations.decor()?.stats().provenance??[]})');
 check('model-only haunted and Christmas qualifiers authorize no props',plain.themes.length===0&&plain.provenance.length===0,plain);
 await shot('model-qualifiers-no-props');
 await js(`vibentaOutingProfiles.publish({...__profile,version:__profile.version+11,qualifiers:['christmas'],evidence:[...__profile.evidence,{id:'QA-explicit-answer',kind:'explicit',source:'answer',polarity:'want',text:'A haunted bookstore'}]})`);await sleep(2200);
 check('explicit answer authorizes only its theme',await js('JSON.stringify(vibentaScene.state().context.themeEvidence)===JSON.stringify(["spooky|haunted|answer"])'));
 await js('vibentaCity.undo()');await sleep(1200);
 check('undo cannot promote model qualifiers to explicit evidence',await js('vibentaScene.state().context.themeEvidence.length===0'));
 await js('vibentaCity.reseed(43)');await sleep(1200);
 check('reseed cannot promote model qualifiers to explicit evidence',await js('vibentaScene.state().context.themeEvidence.length===0'));
 check('no browser errors',errors.length===0,errors);
}finally{writeFileSync(`${OUT}/provenance.json`,JSON.stringify({fixture:'Adversarial model qualifiers and explicit-answer publisher fixture on a real quiz profile',checks,errors},null,2));ws.close();chrome.kill();}
if(checks.some(c=>!c.ok))process.exitCode=1;
