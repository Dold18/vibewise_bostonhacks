// Node 26 + Chrome on macOS. All quiz/embedding responses are TEST FIXTURES.
// Start the app first; VIBENTA_QA_URL defaults to http://localhost:5174/.
// This does not verify Gemini quality, real venue rankings, or transit providers.
import { fallbackQuestion } from '../src/features/vibe/families.ts';
import { MODEL_KEY } from '../src/features/vibe/profile.ts';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
const OUT=process.env.VIBENTA_QA_OUTPUT??'/private/tmp/vibenta-vibe-qa';mkdirSync(OUT,{recursive:true});
const chrome=spawn(process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--remote-debugging-port=9385',`--user-data-dir=${OUT}/chrome-${Date.now()}`,'--no-first-run','--no-default-browser-check','--use-angle=swiftshader','--enable-unsafe-swiftshader','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let targets;for(let i=0;i<60;i++){try{targets=await(await fetch('http://127.0.0.1:9385/json')).json();if(targets.some(t=>t.type==='page'))break;}catch{}await sleep(200);}
const ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
let id=0;const pending=new Map(),handlers=new Map(),errors=[],networkFailures=[],checks=[];
ws.onmessage=m=>{const a=JSON.parse(m.data);if(a.id){pending.get(a.id)?.(a);pending.delete(a.id);}handlers.get(a.method)?.(a.params);if(a.method==='Runtime.exceptionThrown')errors.push(a.params.exceptionDetails.exception?.description);if(a.method==='Runtime.consoleAPICalled'&&a.params.type==='error')errors.push(a.params.args.map(a=>a.value??a.description).join(' '));if(a.method==='Network.loadingFailed'&&!a.params.canceled)networkFailures.push(a.params.errorText);};
const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,a=>a.error?reject(Error(a.error.message)):resolve(a.result));ws.send(JSON.stringify({id:n,method,params}));});
const js=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description);return r.result.value;};
const check=(name,ok,detail)=>{checks.push({name,ok:!!ok,detail});console.log(ok?'PASS':'FAIL',name,detail??'');};
const click=sel=>js(`document.querySelector(${JSON.stringify(sel)}).click()`);
const shot=async name=>{if(process.argv.includes('--skip-screenshots'))return;let timer;try{const capture=await Promise.race([send('Page.captureScreenshot',{format:'png'}),new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Screenshot timed out: '+name)),20000))]);writeFileSync(`${OUT}/${name}.png`,Buffer.from(capture.data,'base64'));}finally{clearTimeout(timer)}};
const waitFor=async expression=>{for(let i=0;i<80;i++){if(await js(expression))return;await sleep(250);}throw Error('Timed out: '+expression);};

let generationFailure=false,embeddingFailure=false,genCount=0;const embeddingTexts=[];
handlers.set('Fetch.requestPaused',async p=>{
 let data,code=200;
 if(p.request.url.includes('/api/vibe/generate')){
  genCount++;const c=JSON.parse(p.request.postData);await sleep(450);
  if(generationFailure){code=503;data={message:'TEST FIXTURE provider failure'};}
  else {const q=fallbackQuestion(c); if(q&&c.history.length===0)q.cultural=true;
   const choice=c.history.at(-1);const desc=choice?.response.kind==='choice'?choice.question.options.find(o=>o.id===choice.response.optionId)?.description:choice?.response.kind==='correction'?choice.response.text:'';
   data={vibe_so_far:'TEST FIXTURE: A cinematic evening with playful discoveries, expressive color and enough space to linger together. '+(desc??'')+' TEST FIXTURE summary revision '+genCount,nextQuestion:q,qualifiers:[],continuation:c.history.length>=3?'finish':'refine',reason:'TEST FIXTURE qualitative continuation'};}
 }else if(p.request.url.includes('/api/vibe/embed')){
  embeddingTexts.push(JSON.parse(p.request.postData).text);
  await sleep(200);code=embeddingFailure?503:200;data=embeddingFailure?{message:'TEST FIXTURE inference failure'}:{modelKey:MODEL_KEY,vector:Array.from({length:384},(_,i)=>i===genCount%6?1:0)};
 }else if(p.request.url.includes('nominatim'))data=[];
 else data={elements:[]};
 await send('Fetch.fulfillRequest',{requestId:p.requestId,responseCode:code,responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:'*'}],body:Buffer.from(JSON.stringify(data)).toString('base64')}).catch(()=>{});
});
const profile=()=>js('vibentaOutingProfiles.getSnapshot()');
const btn=label=>js(`(()=>{const b=[...document.querySelectorAll('.vb-live-quiz button')].find(b=>b.textContent===${JSON.stringify(label)});if(!b)throw Error('Missing button');b.click()})()`);
const snap=()=>js(`JSON.stringify({...vibentaDiscovery.getPreferences(),vibeImages:vibentaDiscovery.getPreferences().vibeImages.map(f=>({name:f.name,size:f.size}))})`);
async function openQuiz(){await click('.vb-continue-btn');await js(`{const t=document.querySelector('.vb-vibe-story');t.value='Cinematic neon and playful discoveries, but absolutely not crowded';t.dispatchEvent(new Event('input',{bubbles:true}));const d=new DataTransfer();d.items.add(new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9WQAAAAASUVORK5CYII='),c=>c.charCodeAt(0))],'TEST-FIXTURE.png',{type:'image/png'}));const f=document.querySelector('input[type=file]');f.files=d.files;f.dispatchEvent(new Event('change',{bubbles:true}));}`);await click('.vb-begin-quiz');}
try{
 await send('Runtime.enable');await send('Page.enable');await send('Network.enable');await send('Emulation.setFocusEmulationEnabled',{enabled:true});await send('Page.bringToFront');
 await send('Fetch.enable',{patterns:[{urlPattern:'*/api/vibe/*'},{urlPattern:'*overpass*'},{urlPattern:'*nominatim*'}]});
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:process.env.VIBENTA_QA_URL??'http://localhost:5174/'});await waitFor('!!window.vibentaDiscovery&&!!window.vibentaOutingProfiles');
 await openQuiz();
 check('loading and Show My Matches immediately available',await js("!!document.querySelector('.vb-quiz-loading')&&!!document.querySelector('.vb-quiz-matches')"));
 await waitFor("vibentaOutingProfiles.getSnapshot()?.phase==='question'");
 check('single question with descriptive cards and unfamiliar action',await js("document.querySelectorAll('.vb-quiz-prompt').length===1&&document.querySelectorAll('.vb-quiz-answer span').length>=2&&[...document.querySelectorAll('.vb-live-quiz button')].some(b=>b.textContent==='I don’t know these')"));
 const original=await snap();await shot('desktop-question');
 await click('.vb-quiz-answer');await waitFor("vibentaOutingProfiles.getSnapshot()?.history.length===1&&vibentaOutingProfiles.getSnapshot()?.phase==='question'");
 await click('.vb-quiz-answer');await waitFor("vibentaOutingProfiles.getSnapshot()?.history.length===2&&vibentaOutingProfiles.getSnapshot()?.phase==='question'");
 await click('.vb-quiz-answer');await waitFor("vibentaOutingProfiles.getSnapshot()?.history.length===3&&vibentaOutingProfiles.getSnapshot()?.phase==='results'");
 check('early completion at three with durable crowd exclusion',(await profile()).evidence.some(e=>e.polarity!=='want'&&e.text.includes('crowded')));await shot('desktop-results');
 check('completed results show one Show My Matches action at the top, no duplicate and no provisional toggle',await js("(()=>{const q=document.querySelector('.vb-live-quiz'),all=[...q.querySelectorAll('button')],m=all.filter(b=>b.textContent==='Show My Matches');return m.length===1&&m[0].classList.contains('vb-quiz-results-action')&&!!(m[0].compareDocumentPosition(q.querySelector('h3.vb-quiz-prompt'))&Node.DOCUMENT_POSITION_FOLLOWING)&&!all.some(b=>/^Show (all|ranked) places$|^Rank My Matches$/.test(b.textContent))})()"));
 check('no catalog does not fabricate rankings',await js("vibentaOutingRanking.status==='unavailable'"));
 await btn('Continue Refining');check('continue refinement returns one question',(await profile()).phase==='question');
 const before=(await profile()).vibe_so_far;const fallbackEmbeddingsStart=embeddingTexts.length;generationFailure=true;await click('.vb-quiz-answer');await waitFor("vibentaOutingProfiles.getSnapshot()?.generation==='fallback'");
 await waitFor("vibentaOutingProfiles.getSnapshot()?.embedding.status==='ready'");
 const fallbackAnswer=(await profile()).history.at(-1);const fallbackDescription=fallbackAnswer.question.options.find(o=>o.id===fallbackAnswer.response.optionId).description;
 // Positive and negative evidence use separate MiniLM queries (evidence.ts).
 const fallbackEmbeddings=embeddingTexts.slice(fallbackEmbeddingsStart); // Unchanged negative evidence may use its existing cached vector.
 check('fallback answer and exclusion reach separate MiniLM queries',fallbackEmbeddings.some(t=>t.includes(fallbackDescription)&&!t.includes('not crowded'))&&embeddingTexts.some(t=>t.includes('crowded')&&!t.includes('not crowded')&&!t.includes(fallbackDescription)),{fallbackDescription,fallbackEmbeddings,negativeQueries:embeddingTexts.filter(t=>t.includes('crowded'))});
 check('failure preserves summary and keeps new answer',(await profile()).vibe_so_far===before&&(await profile()).history.length===4);
 generationFailure=false;embeddingFailure=true;await btn('Try AI again');await waitFor("vibentaOutingProfiles.getSnapshot()?.embedding.status==='unavailable'");
 check('AI recovery includes pending history; unavailable embedding honest',(await profile()).history.length===4&&(await profile()).generation==='gemini');
 embeddingFailure=false;await btn('Retry semantic update');await waitFor("vibentaOutingProfiles.getSnapshot()?.embedding.status==='ready'");check('embedding retry revision matches',(await profile()).embedding.version===(await profile()).version);
 await js("document.querySelector('.vb-quiz-history').open=true;document.querySelector('.vb-quiz-history button').click()");await click('.vb-quiz-answer:nth-child(2)');await waitFor("vibentaOutingProfiles.getSnapshot()?.history.length===1&&vibentaOutingProfiles.getSnapshot()?.generation==='gemini'");check('editing first answer removes obsolete future',(await profile()).history.length===1);
 await btn('Back to vibe description');check('back preserves all practical fields, text and photo',await snap()===original&&await js("!document.querySelector('.vb-begin-quiz').hidden"));
 await click('.vb-begin-quiz');check('resume retains revised history',(await profile()).history.length===1);
 // Integration regression: Directions temporarily occupies the existing card slot.
 await waitFor("vibentaOutingProfiles.getSnapshot()?.embedding.status==='ready'");
 const resumed=await profile();
 await js("window.__quizPhotos=[...vibentaDiscovery.getPreferences().vibeImages];vibentaTrip.dispatch({type:'navigateTo',destination:{label:'TEST FIXTURE destination',location:{lat:42.355,lng:-71.06},source:'local_suggestion'},discoveryOrigin:null})");
 await waitFor("map.getPitch()===0&&document.querySelector('.vb-preferences-widget').hidden");
 check('Directions preserves the mounted quiz and local File objects',await js("!document.querySelector('.vb-directions-slot').hidden&&!document.querySelector('.vb-live-quiz').hidden&&window.__quizPhotos.every((f,i)=>vibentaDiscovery.getPreferences().vibeImages[i]===f)")&&(await profile()).version===resumed.version);
 check('one scene session consumes the adaptive version with navigation safety',await js("(window.vibentaCity?vibentaCity.composer.last()?.version===vibentaScene.state().sessionVersion:vibentaScene.state().sessionVersion===vibentaOutingProfiles.getSnapshot().version)&&vibentaScene.state().source==='outing'&&vibentaScene.state().overlays.every(o=>o.key==='air_and_atmosphere.vignette'&&o.value==='soft'&&o.opacity<=0.35)&&!vibentaScene.state().motion.ambient&&document.querySelectorAll('.account-btn').length===1&&vibentaScene.session.stats().listeners===1"));
 await click('[aria-label="Collapse directions"]');
 check('collapsed Directions restores the current quiz',await js("!document.querySelector('.vb-preferences-widget').hidden&&!document.querySelector('.vb-live-quiz').hidden"));
 await click('.vb-directions-control .vb-exit-navigation');await waitFor('map.getPitch()>5');
 check('navigation exit restores camera and preserves quiz history',(await profile()).history.length===resumed.history.length&&(await profile()).sessionId===resumed.sessionId);
 await btn('Show My Matches');check('user-requested result reason',(await profile()).completion.reason==='user_request');
 await btn('Start over');await waitFor("vibentaOutingProfiles.getSnapshot()?.phase==='question'");check('Start over offers an early Show My Matches and no ranking control',await js("[...document.querySelectorAll('.vb-live-quiz button')].some(b=>b.textContent==='Show My Matches')&&![...document.querySelectorAll('.vb-live-quiz button')].some(b=>/Rank My Matches|Show Unranked Matches/.test(b.textContent))"));
 await btn('Show My Matches');await btn('Back to vibe description');await click('.vb-back-btn');await js("[...document.querySelectorAll('.vb-step-footer button')].find(b=>b.textContent==='Clear all').click()");check('Clear all removes provisional profile',await profile()===null);
 await openQuiz();await waitFor("vibentaOutingProfiles.getSnapshot()?.phase==='question'");await btn('Show My Matches');check('new outing after Clear all starts with no ranked matches',await js("!document.querySelector('.pin.is-ranked')&&document.querySelector('.vb-match-legend')?.hidden!==false&&![...document.querySelectorAll('.vb-live-quiz button')].some(b=>/Rank My Matches|Show Unranked Matches/.test(b.textContent))"));
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await send('Page.navigate',{url:process.env.VIBENTA_QA_URL??'http://localhost:5174/'});await waitFor('!!window.vibentaDiscovery&&!!window.vibentaOutingProfiles');await click('.vb-summary-btn');await openQuiz();await waitFor("vibentaOutingProfiles.getSnapshot()?.phase==='question'");
 check('mobile cards fit panel width',await js("(()=>{const p=document.querySelector('.vb-discovery').getBoundingClientRect();return p.left>=0&&p.right<=innerWidth+1&&[...document.querySelectorAll('.vb-quiz-answer')].every(b=>b.getBoundingClientRect().right<=innerWidth+1)})()"));await shot('mobile-question');
 await btn('I don’t know these');await waitFor("vibentaOutingProfiles.getSnapshot()?.history.length===1&&vibentaOutingProfiles.getSnapshot()?.phase==='question'");check('unfamiliarity neutral with non-cultural follow-up',(await profile()).history[0].response.kind==='unfamiliar'&&!(await profile()).question.cultural);
 await btn('Skip');await waitFor("vibentaOutingProfiles.getSnapshot()?.history.length===2&&vibentaOutingProfiles.getSnapshot()?.phase==='question'");await btn('Neither / something else');await waitFor("vibentaOutingProfiles.getSnapshot()?.history.length===3&&vibentaOutingProfiles.getSnapshot()?.phase==='question'");check('neutral answers do not force early completion',!(await profile()).completion.recommended);
 await js("{const t=document.querySelector('.vb-quiz-correction');t.value='Actually I want a lively crowd';}");await btn('Use my words');await waitFor("vibentaOutingProfiles.getSnapshot()?.history.length===4&&vibentaOutingProfiles.getSnapshot()?.generation==='gemini'");check('correction preserves immutable original and overrides crowd evidence',(await profile()).originalInput.text.includes('not crowded')&&!(await profile()).evidence.some(e=>e.polarity!=='want'&&e.text.includes('crowded')));
 await btn('Show My Matches');await shot('mobile-results');
 // An empty starting description can still create a quiz that Clear all must reset.
 await btn('Back to vibe description');await click('.vb-back-btn');
 await js("[...document.querySelectorAll('.vb-step-footer button')].find(b=>b.textContent==='Clear all').click()");
 await click('.vb-continue-btn');await click('.vb-begin-quiz');
 await waitFor("vibentaOutingProfiles.getSnapshot()?.phase==='question'");
 await btn('Back to vibe description');await click('.vb-back-btn');
 check('Clear all remains enabled for a quiz with otherwise empty preferences',await js("![...document.querySelectorAll('.vb-step-footer button')].find(b=>b.textContent==='Clear all').disabled"));
 await js("[...document.querySelectorAll('.vb-step-footer button')].find(b=>b.textContent==='Clear all').click()");
 check('Clear all resets that empty-input quiz',await profile()===null);
 await click('.vb-continue-btn');await click('.vb-begin-quiz');
 await waitFor("vibentaOutingProfiles.getSnapshot()?.phase==='question'");
 await js('vibentaDiscovery.destroy()');await sleep(250);
 check('panel teardown clears its outing and removes the quiz',await profile()===null&&await js("!document.querySelector('.vb-live-quiz')&&vibentaScene.state().source==='neutral'"));
 check('no uncaught browser exceptions',!errors.some(e=>e&&!e.includes('Failed to load resource')),errors);
}finally{writeFileSync(`${OUT}/browser-results.json`,JSON.stringify({fixtures:true,checks,errors,networkFailures},null,2));ws.close();chrome.kill('SIGTERM');}
if(checks.some(c=>!c.ok))process.exitCode=1;
