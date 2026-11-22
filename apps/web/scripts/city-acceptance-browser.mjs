// Rendered decoration relevance, transitions, undo, GPU recovery and live transit acceptance.
// Run against the ordinary application; VIBENTA_QA_URL and VIBENTA_QA_OUTPUT override defaults.
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

const URL_ = process.env.VIBENTA_QA_URL ?? 'http://localhost:5207/';
const OUT = process.env.VIBENTA_QA_OUTPUT ?? '/private/tmp/vibenta-city-main-acceptance';
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


const checks=[],audits=[],timeline=[];
const check=(name,ok,detail)=>{checks.push({name,ok:!!ok,detail});log(ok?'PASS':'FAIL',name,JSON.stringify(detail??''));};
const inputs=['Need a fun night.','Jazz and candlelight.','Haunted but romantic.','Cozy rainy bookstore.','Cyberpunk nightlife.','Peaceful afternoon in Boston.','Christmas in Boston.','Somewhere energetic but intimate.','Surprise me.'];
const settle=async()=>{await sleep(1900);await js('vibentaCity.renderers.streets.surfaces()?.flush()');await js('vibentaCity.renderers.decorations.decor()?.settled()');await sleep(100);};
try{
 await send('Runtime.enable');await send('Page.enable');await send('Network.enable');
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:URL_+'?seed=424242'});await waitFor('!!window.vibentaCity&&vibentaScene.map.loaded()');
 for(const [area,center] of [['common',[-71.066,42.355]],['backbay',[-71.0795,42.3505]],['downtown',[-71.059,42.3555]]]){
  await js(`void map.jumpTo({center:${JSON.stringify(center)},zoom:16.7,pitch:55,bearing:10})`);await sleep(1000);
  for(const input of inputs){
   await js(`vibentaCity.compose(${JSON.stringify(input)},'audit')`);await settle();
   const a=await js(`(()=>{const s=vibentaScene.state(),d=vibentaCity.renderers.decorations.decor()?.stats();return {evidence:s.context.themeEvidence,provenance:d?.provenance??[],shown:d?.shown,collisions:d?.collisions,renderers:vibentaCity.stats().renderers.map(r=>({id:r.id,failures:r.failures}))}})()`);
   audits.push({area,input,...a});check(area+' '+input+' decoration relevance',a.provenance.every(p=>p.evidence.length>0||p.setPiece)&&a.renderers.every(r=>r.failures===0),{themed:a.provenance.length,evidence:a.evidence});
   if(area==='common')await shot('common-'+inputs.indexOf(input));
  }
 }
 await js("vibentaCity.compose('jazz and candlelight','transition')");await settle();
 const before=await js('vibentaScene.state().hash');
 await js("vibentaCity.compose('cyberpunk nightlife','transition')");
 for(const delay of [0,150,350,800]){await sleep(delay);timeline.push({afterDelay:delay,...await js('({hash:vibentaScene.state().hash,city:vibentaCity.stats(),buildings:vibentaCity.renderers.buildings.stats(),streets:vibentaCity.renderers.streets.surfaces()?.stats()})')});await shot('transition-'+delay);}
 await js('vibentaCity.undo()');await settle();check('undo restores exact scene',await js('vibentaScene.state().hash')===before);
 await js("vibentaCity.compose('haunted Boston','rapid');vibentaCity.compose('Christmas in Boston','rapid');vibentaCity.compose('peaceful afternoon','rapid')");await settle();
 check('rapid interruption keeps latest theme authoritative',await js('vibentaScene.state().context.themeEvidence.length===0'));
 await js("vibentaCity.compose('cyberpunk nightlife','gpu')");await settle();
 const hash=await js('vibentaScene.state().hash');
 const supports=await js(`(()=>{const ext=map.painter.context.gl.getExtension('WEBGL_lose_context');if(!ext)return false;window.__restore=()=>ext.restoreContext();ext.loseContext();return true})()`);
 if(supports){await sleep(300);await js('window.__restore()');await sleep(3000);await settle();check('WebGL recovery preserves scene and all renderers',await js('vibentaScene.state().hash')===hash&&await js('vibentaCity.stats().renderers.every(r=>r.status==="ready"&&r.failures===0)'));await shot('gpu-restored');}
 await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await sleep(500);
 check('reduced motion reaches scene',await js('vibentaScene.state().context.reducedMotion&&!vibentaScene.state().motion.ambient'));
 await js(`vibentaTrip.dispatch({type:'navigateTo',destination:{label:'Kendall/MIT (real station)',location:{lat:42.3625,lng:-71.0862},source:'local_suggestion'},discoveryOrigin:{label:'Harvard (real station)',location:{lat:42.3736,lng:-71.119},source:'local_suggestion'}})`);
 await waitFor('vibentaTrip.getState().route.kind==="done"');await sleep(1200);
 const route=await js('vibentaTrip.getState().route');
 check('live MBTA route displayed over transformed city',route.result?.status==='ok'||route.status==='ok',route);
 await shot('live-mbta-over-city');
 check('no duplicate map layers',await js('new Set(map.getStyle().layers.map(l=>l.id)).size===map.getStyle().layers.length'));
 check('single scene listener after rapid changes, undo, recovery and navigation',await js('vibentaScene.session.stats().listeners===1'));
} catch(e){checks.push({name:'harness completed',ok:false,detail:String(e.stack??e)});log('FATAL',e)}finally{writeFileSync(`${OUT}/acceptance.json`,JSON.stringify({checks,audits,timeline,errors},null,2));ws.close();chrome.kill();}
if(checks.some(c=>!c.ok))process.exitCode=1;
