// Node 26 + Chrome on macOS. All quiz/embedding responses are TEST FIXTURES.
// Start the app first; VIBENTA_QA_URL defaults to http://localhost:5174/.
// This does not verify Gemini quality, real venue rankings, or transit providers.
import { fallbackQuestion } from '../src/features/vibe/families.ts';
import { MODEL_KEY } from '../src/features/vibe/profile.ts';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
const OUT=process.env.VIBENTA_QA_OUTPUT??'/private/tmp/vibenta-city-quiz-inputs';mkdirSync(OUT,{recursive:true});
const chrome=spawn(process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--remote-debugging-port=9392',`--user-data-dir=${OUT}/chrome-${Date.now()}`,'--no-first-run','--no-default-browser-check','--use-angle=metal','--ignore-gpu-blocklist','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let targets;for(let i=0;i<60;i++){try{targets=await(await fetch('http://127.0.0.1:9392/json')).json();if(targets.some(t=>t.type==='page'))break;}catch{}await sleep(200);}
const ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
let id=0;const pending=new Map(),handlers=new Map(),errors=[],networkFailures=[],checks=[];
ws.onmessage=m=>{const a=JSON.parse(m.data);if(a.id){pending.get(a.id)?.(a);pending.delete(a.id);}handlers.get(a.method)?.(a.params);if(a.method==='Runtime.exceptionThrown')errors.push(a.params.exceptionDetails.exception?.description);if(a.method==='Runtime.consoleAPICalled'&&a.params.type==='error')errors.push(a.params.args.map(a=>a.value??a.description).join(' '));if(a.method==='Network.loadingFailed'&&!a.params.canceled)networkFailures.push(a.params.errorText);};
const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,a=>a.error?reject(Error(a.error.message)):resolve(a.result));ws.send(JSON.stringify({id:n,method,params}));});
const js=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description);return r.result.value;};
const check=(name,ok,detail)=>{checks.push({name,ok:!!ok,detail});console.log(ok?'PASS':'FAIL',name,detail??'');};
const click=sel=>js(`document.querySelector(${JSON.stringify(sel)}).click()`);
const shot=async name=>{if(process.argv.includes('--skip-screenshots'))return;let timer;try{const capture=await Promise.race([send('Page.captureScreenshot',{format:'png'}),new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Screenshot timed out: '+name)),20000))]);writeFileSync(`${OUT}/${name}.png`,Buffer.from(capture.data,'base64'));}finally{clearTimeout(timer)}};
const waitFor=async expression=>{for(let i=0;i<80;i++){if(await js(expression))return;await sleep(250);}throw Error('Timed out: '+expression);};


const inputs=['Need a fun night.','Jazz and candlelight.','Haunted but romantic.','Cozy rainy bookstore.','Cyberpunk nightlife.','Peaceful afternoon in Boston.','Christmas in Boston.','Somewhere energetic but intimate.','Surprise me.'];
const observations=[];
try {
 await send('Runtime.enable');await send('Page.enable');await send('Network.enable');
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:(process.env.VIBENTA_QA_URL??'http://127.0.0.1:5217/')+'?seed=424242'});
 await waitFor('!!window.vibentaCity&&!!window.vibentaDiscovery&&!!window.vibentaScene.map.loaded()');
 const neutral=await js('({source:vibentaScene.state().source,renderers:vibentaCity.stats().renderers})');
 check('neutral app has all four renderers',neutral.source==='neutral'&&neutral.renderers.length===4,neutral);
 await shot('neutral');
 for(let i=0;i<inputs.length;i++){
  await click('.vb-continue-btn');
  await js(`{const t=document.querySelector('.vb-vibe-story');t.value=${JSON.stringify(inputs[i])};t.dispatchEvent(new Event('input',{bubbles:true}));}`);
  await click('.vb-begin-quiz');
  await waitFor("vibentaOutingProfiles.getSnapshot()?.phase==='question'&&vibentaCity.composer.last()");
  await js("void map.jumpTo({center:[-71.066,42.355],zoom:16.5,pitch:55,bearing:10})");await sleep(3000);
  const observe=await js(`(()=>{const p=vibentaOutingProfiles.getSnapshot(),s=vibentaScene.state(),c=vibentaCity.composer.last(),r=vibentaCity.renderers;return {input:p.originalInput.text,phase:p.phase,generation:p.generation,embedding:p.embedding.status,sceneHash:s.hash,themes:s.context.themeEvidence,composition:c.composition.id,fidelity:c.plan.provenance.fidelity,signals:c.composition.interpretation,buildings:r.buildings.stats().appearance?.facades.map(f=>f.label),streets:r.streets.surfaces()?.recipe().roads,decor:r.decorations.decor()?.stats().cast,atmosphere:r.atmosphere.renderer()?.stats(),renderers:vibentaCity.stats().renderers.map(r=>({id:r.id,failures:r.failures,status:r.status})),listeners:vibentaScene.session.stats().listeners,ui:{identity:!!document.querySelector('link[href*="identity"]'),debug:!!document.querySelector('.scene-dev'),background:getComputedStyle(document.querySelector('.vb-discovery')).backgroundColor}}})()`);
  observations.push(observe);check(inputs[i]+' reaches composer and all renderers',observe.input===inputs[i]&&observe.phase==='question'&&observe.renderers.every(r=>r.failures===0)&&observe.listeners===1&&!observe.ui.debug, {themes:observe.themes,fidelity:observe.fidelity,generation:observe.generation});
  if(!/haunted|christmas|cyberpunk/i.test(inputs[i]))check(inputs[i]+' has no thematic props permission',observe.themes.length===0,observe.themes);
  await shot('input-'+i);
  await click('.vb-quiz-answer, .vb-media-card, .vb-media-option');await waitFor('vibentaOutingProfiles.getSnapshot()?.history.length===1');
  check(inputs[i]+' accepted answer continues same pipeline',await js('vibentaCity.composer.last()!==null&&vibentaOutingProfiles.getSnapshot().evidence.some(e=>e.source==="answer")'));
  if(i===0){
   await js("document.querySelector('.vb-quiz-correction').value='Actually, a peaceful quiet afternoon'");
   await js("[...document.querySelectorAll('.vb-live-quiz button')].find(b=>b.textContent==='Use my words').click()");
   await waitFor('vibentaOutingProfiles.getSnapshot()?.history.length===2');
   check('correction reaches shared profile',await js('vibentaOutingProfiles.getSnapshot().history.at(-1).response.kind==="correction"'));
  }
  await js("[...document.querySelectorAll('.vb-live-quiz button')].find(b=>b.textContent==='Show My Matches').click()");
  await sleep(1500);
  if(i===0){await shot('real-recommendations');observations.push(await js('({pins:document.querySelectorAll(".pin").length})'));}
  await js("[...document.querySelectorAll('.vb-live-quiz button')].find(b=>b.textContent==='Back to vibe description').click()");
  await click('.vb-back-btn');await js("[...document.querySelectorAll('.vb-step-footer button')].find(b=>b.textContent==='Clear all').click()");
  await waitFor('vibentaOutingProfiles.getSnapshot()===null');
  check('clear resets explicit theme '+i,await js('vibentaScene.state().context.themeEvidence.length===0'));
 }
 check('different inputs produce varied cities',new Set(observations.filter(o=>o?.composition).map(o=>o.composition)).size>=7);
 check('no uncaught exceptions',errors.length===0,errors);
} finally {writeFileSync(`${OUT}/results.json`,JSON.stringify({liveApi:true,geminiConfigured:false,checks,observations,errors,networkFailures},null,2));ws.close();chrome.kill('SIGTERM');}
if(checks.some(c=>!c.ok))process.exitCode=1;
