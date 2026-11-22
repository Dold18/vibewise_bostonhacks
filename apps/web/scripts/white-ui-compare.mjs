// Node 26 + Chrome on macOS. All quiz/embedding responses are TEST FIXTURES.
// Start the app first; VIBENTA_QA_URL defaults to http://localhost:5174/.
// This does not verify Gemini quality, real venue rankings, or transit providers.
import { fallbackQuestion } from '../src/features/vibe/families.ts';
import { MODEL_KEY } from '../src/features/vibe/profile.ts';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
const OUT=process.env.VIBENTA_QA_OUTPUT??'/private/tmp/vibenta-vibe-qa';mkdirSync(OUT,{recursive:true});
const chrome=spawn(process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--remote-debugging-port=9393',`--user-data-dir=${OUT}/chrome-${Date.now()}`,'--no-first-run','--no-default-browser-check','--use-angle=metal','--ignore-gpu-blocklist','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let targets;for(let i=0;i<60;i++){try{targets=await(await fetch('http://127.0.0.1:9393/json')).json();if(targets.some(t=>t.type==='page'))break;}catch{}await sleep(200);}
const ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
let id=0;const pending=new Map(),handlers=new Map(),errors=[],networkFailures=[],checks=[];
ws.onmessage=m=>{const a=JSON.parse(m.data);if(a.id){pending.get(a.id)?.(a);pending.delete(a.id);}handlers.get(a.method)?.(a.params);if(a.method==='Runtime.exceptionThrown')errors.push(a.params.exceptionDetails.exception?.description);if(a.method==='Runtime.consoleAPICalled'&&a.params.type==='error')errors.push(a.params.args.map(a=>a.value??a.description).join(' '));if(a.method==='Network.loadingFailed'&&!a.params.canceled)networkFailures.push(a.params.errorText);};
const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,a=>a.error?reject(Error(a.error.message)):resolve(a.result));ws.send(JSON.stringify({id:n,method,params}));});
const js=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description);return r.result.value;};
const check=(name,ok,detail)=>{checks.push({name,ok:!!ok,detail});console.log(ok?'PASS':'FAIL',name,detail??'');};
const click=sel=>js(`document.querySelector(${JSON.stringify(sel)}).click()`);
const shot=async name=>{if(process.argv.includes('--skip-screenshots'))return;let timer;try{const capture=await Promise.race([send('Page.captureScreenshot',{format:'png'}),new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Screenshot timed out: '+name)),20000))]);writeFileSync(`${OUT}/${name}.png`,Buffer.from(capture.data,'base64'));}finally{clearTimeout(timer)}};
const waitFor=async expression=>{for(let i=0;i<80;i++){if(await js(expression))return;await sleep(250);}throw Error('Timed out: '+expression);};


const replay=JSON.parse(readFileSync(new URL('./fixtures/city-catalog-replay.json',import.meta.url),'utf8'));
const ui=[];
handlers.set('Fetch.requestPaused',async p=>{try{
 let data;
 if(p.request.url.includes('/generate')){
  const c=JSON.parse(p.request.postData);const q=fallbackQuestion({...c,sessionId:'white-ui-fixed'});
  data={vibe_so_far:'TEST FIXTURE: Cozy rainy bookstore, with a quiet place to linger.',nextQuestion:q,qualifiers:[],continuation:'refine',reason:'TEST FIXTURE for matched UI comparison'};
 }else if(p.request.url.includes('/embed'))data={modelKey:MODEL_KEY,vector:Array.from({length:384},(_,i)=>i===0?1:0)};
 else if(p.request.url.includes('/search'))data=replay;
 else data=p.request.url.includes('nominatim')?[]:{elements:[]};
 await send('Fetch.fulfillRequest',{requestId:p.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:'*'}],body:Buffer.from(JSON.stringify(data)).toString('base64')});
 }catch(e){errors.push(String(e))}});
const capture=async name=>{await sleep(800);await shot(name);ui.push({name,tree:await js(`(()=>{const selectors=['.vb-tools-widget','.vb-discovery','.account-btn','.maplibregl-popup-content'];return selectors.flatMap(sel=>[...document.querySelectorAll(sel)].flatMap(root=>[root,...root.querySelectorAll('*')].filter(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height).map(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {tag:e.tagName,cls:e.className,text:e.childElementCount?'':e.textContent,rect:[r.x,r.y,r.width,r.height].map(x=>Math.round(x*10)/10),css:[s.color,s.backgroundColor,s.fontFamily,s.fontSize,s.fontWeight,s.padding,s.borderRadius,s.borderColor]}})))})()`)});};
try{
 await send('Runtime.enable');await send('Page.enable');await send('Network.enable');
 await send('Fetch.enable',{patterns:[{urlPattern:'*/api/vibe/*'},{urlPattern:'*overpass*'},{urlPattern:'*nominatim*'}]});
 for(const width of [1440,390]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:width===390?844:900,deviceScaleFactor:1,mobile:width===390});
  await send('Page.navigate',{url:(process.env.VIBENTA_QA_URL??'http://127.0.0.1:5217/')+'?seed=424242'});
  await waitFor('!!window.vibentaScene&&!!window.vibentaDiscovery&&vibentaScene.map.loaded()');
  await capture(width+'-landing');if(width===390)await click('.vb-summary-btn');
  await click('.vb-continue-btn');await capture(width+'-discovery');
  await js(`{const t=document.querySelector('.vb-vibe-story');t.value='Cozy rainy bookstore';t.dispatchEvent(new Event('input',{bubbles:true}));}`);await click('.vb-begin-quiz');
  await waitFor("vibentaOutingProfiles.getSnapshot()?.phase==='question'&&vibentaOutingProfiles.getSnapshot()?.embedding.status==='ready'");await sleep(2200);await capture(width+'-quiz');
  await js("[...document.querySelectorAll('.vb-live-quiz button')].find(b=>b.textContent==='Show My Matches').click()");
  await waitFor(`Array.from(document.querySelectorAll('.pin')).some(e=>e.getAttribute('aria-label')===${JSON.stringify(replay.results[0].name)})`);
  await capture(width+'-recommendations');
  await js(`Array.from(document.querySelectorAll('.pin')).find(e=>e.getAttribute('aria-label')===${JSON.stringify(replay.results[0].name)}).click()`);
  await waitFor("!!document.querySelector('.maplibregl-popup-content')");await capture(width+'-venue');
 }
}finally{writeFileSync(`${OUT}/ui.json`,JSON.stringify({fixtures:'Gemini and MiniLM mocked; catalog replays 3 real API records, not live rankings',ui,errors,networkFailures},null,2));ws.close();chrome.kill('SIGTERM');}
