// Node 26 + Chrome on macOS. All quiz/embedding responses are TEST FIXTURES.
// Start the app first; VIBENTA_QA_URL defaults to http://localhost:5174/.
// This does not verify Gemini quality, real venue rankings, or transit providers.
import { sessionBQuestion } from '../src/features/vibe/sessionB.ts';
import { fallbackQuestion } from '../src/features/vibe/families.ts';
import { MODEL_KEY } from '../src/features/vibe/profile.ts';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
const OUT=process.env.VIBENTA_QA_OUTPUT??'/private/tmp/vibenta-session-b-qa';mkdirSync(OUT,{recursive:true});
const chrome=spawn(process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--remote-debugging-port=9387',`--user-data-dir=${OUT}/chrome-${Date.now()}`,'--no-first-run','--no-default-browser-check','--use-angle=swiftshader','--enable-unsafe-swiftshader','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let targets;for(let i=0;i<60;i++){try{targets=await(await fetch('http://127.0.0.1:9387/json')).json();if(targets.some(t=>t.type==='page'))break;}catch{}await sleep(200);}
const ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
let id=0;const pending=new Map(),handlers=new Map(),errors=[],networkFailures=[],checks=[];
ws.onmessage=m=>{const a=JSON.parse(m.data);if(a.id){pending.get(a.id)?.(a);pending.delete(a.id);}handlers.get(a.method)?.(a.params);if(a.method==='Runtime.exceptionThrown')errors.push(a.params.exceptionDetails.exception?.description);if(a.method==='Runtime.consoleAPICalled'&&a.params.type==='error')errors.push(a.params.args.map(a=>a.value??a.description).join(' '));if(a.method==='Network.loadingFailed'&&!a.params.canceled)networkFailures.push(a.params.errorText);};
const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,a=>a.error?reject(Error(a.error.message)):resolve(a.result));ws.send(JSON.stringify({id:n,method,params}));});
const js=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description);return r.result.value;};
const check=(name,ok,detail)=>{checks.push({name,ok:!!ok,detail});console.log(ok?'PASS':'FAIL',name,detail??'');};
const click=sel=>js(`document.querySelector(${JSON.stringify(sel)}).click()`);
const shot=async name=>{let timer;try{const capture=await Promise.race([send('Page.captureScreenshot',{format:'png'}),new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Screenshot timed out: '+name)),20000))]);writeFileSync(`${OUT}/${name}.png`,Buffer.from(capture.data,'base64'));}finally{clearTimeout(timer)}};
const waitFor=async expression=>{for(let i=0;i<80;i++){if(await js(expression))return;await sleep(250);}throw Error('Timed out: '+expression);};

let generationFailure=false,blockedImages=false;
const embeddingTexts=[];
handlers.set('Fetch.requestPaused',async p=>{
 try {
  if(p.request.url.includes('/quiz-scenes/')) {await send(blockedImages?'Fetch.failRequest':'Fetch.continueRequest',blockedImages?{requestId:p.requestId,errorReason:'BlockedByClient'}:{requestId:p.requestId});return;}
  let code=200,data;
  if(p.request.url.includes('/api/vibe/generate')){
   const c=JSON.parse(p.request.postData);await sleep(100);code=generationFailure?503:200;
   data=generationFailure?{error:'TEST FIXTURE Gemini failure'}:{vibe_so_far:'TEST FIXTURE contextual reading: '+c.originalInput.text+' '+c.evidence.map(e=>e.text).join('. '),nextQuestion:sessionBQuestion(c)??fallbackQuestion(c),qualifiers:[],continuation:'refine',reason:'TEST FIXTURE additional detail'};
  } else if(p.request.url.includes('/api/vibe/embed')) {embeddingTexts.push(JSON.parse(p.request.postData).text);data={modelKey:MODEL_KEY,vector:Array.from({length:384},(_,i)=>i===0?1:0)};}
  else data=p.request.url.includes('nominatim')?[]:{elements:[]};
  await send('Fetch.fulfillRequest',{requestId:p.requestId,responseCode:code,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify(data)).toString('base64')});
 }catch(e){errors.push(String(e));}
});
const profile=()=>js('vibentaOutingProfiles.getSnapshot()');
const btn=label=>js(`(()=>{const b=[...document.querySelectorAll('.vb-live-quiz button')].find(b=>b.textContent===${JSON.stringify(label)});if(!b)throw Error('Missing button '+${JSON.stringify(label)});b.click()})()`);
async function open(width=1440) {
 await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 await send('Emulation.setDeviceMetricsOverride',{width,height:width===390?844:1000,deviceScaleFactor:1,mobile:width===390});
 await send('Page.navigate',{url:process.env.VIBENTA_QA_URL??'http://localhost:5176/'});await waitFor('!!window.vibentaDiscovery&&!!window.vibentaOutingProfiles');
 if(width===390)await click('.vb-summary-btn');await click('.vb-continue-btn');
 await js(`{const t=document.querySelector('.vb-vibe-story');t.value="Coffee. Brain's fried.";t.dispatchEvent(new Event('input',{bubbles:true}));}`);await click('.vb-begin-quiz');
 // DOM presence alone misses regressions where the V2 stage is hidden or offscreen.
 await waitFor(`(()=>{const quiz=document.querySelector('.vb-live-quiz'),scene=quiz?.querySelector('[data-scene-step="B1"]');if(!quiz||!scene||quiz.closest('[hidden]'))return false;const r=scene.getBoundingClientRect();return getComputedStyle(quiz).display!=='none'&&r.height>0&&r.width>0&&r.top<innerHeight&&r.bottom>0})()`);
}
const stage=step=>waitFor(`document.querySelector('[data-scene-step="${step}"]')`);
async function b1(width=1440){await open(width);await stage('B1');}
async function select(scene){await click(`[data-inspect="${scene}"]`);await click(`[data-commit="${scene}"]`);await stage('B2');}
try {
 await send('Runtime.enable');await send('Page.enable');await send('Page.bringToFront');await send('Network.enable');await send('Emulation.setFocusEmulationEnabled',{enabled:true});
 await send('Fetch.enable',{patterns:[{urlPattern:'*/api/vibe/*'},{urlPattern:'*/quiz-scenes/*'},{urlPattern:'*overpass*'},{urlPattern:'*nominatim*'}]});
 for(const width of [1440,390])for(const scene of ['bakery','nook'])for(const decision of ['stay','leave']){
  await b1(width);await waitFor("vibentaOutingProfiles.getSnapshot()?.embedding.status==='ready'");const before=await profile();
  const mapBefore=await js("JSON.stringify(map.getStyle().layers.map(l=>[l.id,l.paint]))");await js(`document.querySelector('[data-inspect="${scene}"]').focus()`);
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await waitFor(`document.querySelector('[data-commit="${scene}"]')`);
  check(`${width} ${scene}/${decision}: keyboard preview neutral`,(await profile()).history.length===0&&JSON.stringify((await profile()).evidence)===JSON.stringify(before.evidence));
  check(`${width} ${scene}/${decision}: preview leaves map unchanged`,await js("JSON.stringify(map.getStyle().layers.map(l=>[l.id,l.paint]))")===mapBefore);
  await click(`[data-commit="${scene}"]`);await stage('B2');
  check(`${width} ${scene}/${decision}: continuation and reference`,(await profile()).question.id===`session-b/v1/B2/${scene}`&&await js(`!!document.querySelector('.vb-scene-reference')===${scene==='bakery'}`));
  await click(`[data-inspect="${scene}-${decision}"]`);await click(`[data-next="${scene}-${decision}"]`);
  check(`${width} ${scene}/${decision}: timeline neutral`,(await profile()).history.length===1);
  check(`${width} ${scene}/${decision}: fits viewport`,await js("[...document.querySelectorAll('.vb-scene-option')].every(e=>e.getBoundingClientRect().right<=innerWidth+1&&e.getBoundingClientRect().left>=0)"));
  if(decision==='stay')await shot(`${width}-${scene}-continuation`);
  await waitFor(`document.querySelector('[data-commit="${scene}-${decision}"]')`);await click(`[data-commit="${scene}-${decision}"]`);await waitFor("vibentaOutingProfiles.getSnapshot()?.generation!=='pending'&&vibentaOutingProfiles.getSnapshot()?.phase==='results'");
  const p=await profile();check(`${width} ${scene}/${decision}: real session two-answer results`,p.history.length===2&&p.evidence.filter(e=>e.source==='answer').length===2&&p.completion.reason==='user_request');
  check(`${width} ${scene}/${decision}: answer reaches embedding`,embeddingTexts.at(-1).includes(decision==='stay'?'unhurried stay':'brief coffee stop'));
  check(`${width} ${scene}/${decision}: no fake catalog`,await js("vibentaOutingRanking.status==='unavailable'&&vibentaOutingRanking.all.length===0"));
 }
 await js("document.querySelector('.vb-quiz-history').open=true;document.querySelector('.vb-quiz-history button').click()");await select('bakery');
 check('editing B1 discards B2 and old scene',(await profile()).history.length===1&&!(await profile()).evidence.some(e=>e.text.includes('quiet window nook')));
 await btn('Back to vibe description');await click('.vb-begin-quiz');check('Back/resume preserves scene',await js("document.querySelector('[data-selected-scene]')?.dataset.selectedScene==='bakery'"));
 await click('[data-inspect="bakery-stay"]');await click('[data-next="bakery-stay"]');await btn('Show My Matches');await btn('Continue Refining');
 check('return to B2 preserves preview beat',await js("document.querySelector('.vb-scene-beat')?.textContent.includes('2 of')"));
 blockedImages=true;await b1();await waitFor("document.querySelector('.vb-scene-fallback')");check('blocked image text fallback',await js("document.querySelector('.vb-scene-fallback').textContent.includes('Image unavailable')"));await select('nook');check('blocked images still select and continue',(await profile()).question.id==='session-b/v1/B2/nook');blockedImages=false;
 generationFailure=true;await b1();check('Gemini failure authored B1',(await profile()).generation==='fallback');await select('bakery');check('Gemini failure authored B2',(await profile()).generation==='fallback');
 await btn('Not quite');await js("document.querySelector('.vb-quiz-correction').value='Actually a quiet nook for takeaway coffee'");await btn('Use my words');await waitFor("vibentaOutingProfiles.getSnapshot()?.generation!=='pending'");check('own words replace B1 and discard scene',(await profile()).history.length===1&&(await profile()).history[0].response.kind==='correction'&&!await js("!!document.querySelector('[data-selected-scene]')"));
 for(const neutral of ['Skip','Neither / something else']){await b1();await btn(neutral);await waitFor("vibentaOutingProfiles.getSnapshot()?.history.length===1&&vibentaOutingProfiles.getSnapshot()?.generation!=='pending'");check(`${neutral} adds no preference`,!(await profile()).evidence.some(e=>e.source==='answer'));}
 generationFailure=false;await open();await btn('Show My Matches');await waitFor("vibentaOutingProfiles.getSnapshot()?.generation!=='pending'");check('reduced motion respected',await js("matchMedia('(prefers-reduced-motion: reduce)').matches"));
 check('immediate matches retained',(await profile()).phase==='results'&&(await profile()).history.length===0);
 check('no uncaught browser exceptions',!errors.some(e=>e&&!e.includes('Failed to load resource')),errors);
}catch(e){console.error('Browser check failed:',String(e));await shot('failure').catch(()=>{});writeFileSync(`${OUT}/failure-state.json`,JSON.stringify({message:String(e),profile:await profile().catch(()=>null),dom:await js("document.querySelector('.vb-live-quiz')?.innerText").catch(()=>null)},null,2));throw e;}finally {writeFileSync(`${OUT}/session-b-results.json`,JSON.stringify({fixtures:true,realCatalogVerified:false,checks,errors,networkFailures},null,2));ws.close();chrome.kill('SIGTERM');}
if(checks.some(c=>!c.ok))process.exitCode=1;
