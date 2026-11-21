// Run with Node 26 and Google Chrome on macOS while npm run dev:all is running.
// Transit, Overpass and Nominatim responses below are TEST FIXTURES, never live verification.
// Screenshots and JSON results go to /private/tmp/vibenta-qa.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
const OUT='/private/tmp/vibenta-qa';mkdirSync(OUT,{recursive:true});
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--remote-debugging-port=9383',`--user-data-dir=${OUT}/chrome`,'--no-first-run','--no-default-browser-check','--use-angle=swiftshader','--enable-unsafe-swiftshader','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let targets;for(let i=0;i<60;i++){try{targets=await(await fetch('http://127.0.0.1:9383/json')).json();if(targets.some(t=>t.type==='page'))break;}catch{}await sleep(200);}
const ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
let id=0;const pending=new Map(),handlers=new Map(),errors=[],checks=[];
ws.onmessage=m=>{const a=JSON.parse(m.data);if(a.id){pending.get(a.id)?.(a);pending.delete(a.id);}handlers.get(a.method)?.(a.params);if(a.method==='Runtime.exceptionThrown')errors.push(a.params.exceptionDetails.exception?.description);if(a.method==='Runtime.consoleAPICalled'&&a.params.type==='error')errors.push(a.params.args.map(a=>a.value??a.description).join(' '));};
const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,a=>a.error?reject(Error(a.error.message)):resolve(a.result));ws.send(JSON.stringify({id:n,method,params}));});
const js=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description);return r.result.value;};
const check=(name,ok,detail)=>{checks.push({name,ok:!!ok,detail});console.log(ok?'PASS':'FAIL',name,detail??'');};
const click=sel=>js(`document.querySelector(${JSON.stringify(sel)}).click()`);
const shot=async name=>writeFileSync(`${OUT}/${name}.png`,Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
const point=(label,lat,lng)=>({label,location:{lat,lng},source:'local_suggestion'});
const from=point('TEST FIXTURE Harvard',42.373,-71.119), to=point('TEST FIXTURE Kenmore',42.349,-71.095);
const fixture={status:'ok',tier:2,option:{durationSec:1500,transfers:1,legs:[
{mode:'walk',durationSec:120,geometry:[[-71.12,42.374],[-71.119,42.373]],source:'approx: straight-line walk, ~80 m/min'},
{mode:'subway',durationSec:600,geometry:[[-71.119,42.373],[-71.103,42.365],[-71.062,42.356]],routeShortName:'Red',routeColor:'#DA291C',fromStopName:'Harvard TEST FIXTURE',toStopName:'Park Street TEST FIXTURE'},
{mode:'subway',durationSec:600,geometry:[[-71.062,42.356],[-71.075,42.352],[-71.095,42.349]],routeShortName:'B',routeColor:'#00843D',fromStopName:'Park Street TEST FIXTURE',toStopName:'Kenmore TEST FIXTURE'},
{mode:'walk',durationSec:120,geometry:[[-71.095,42.349],[-71.097,42.347]],source:'approx: straight-line walk, ~80 m/min'}]},lastTrainBack:null,lastTrainBackNote:'TEST FIXTURE unavailable'};
let routes=0,queries=0,currentRoute=fixture;
handlers.set('Fetch.requestPaused',async p=>{let data;if(p.request.url.includes('/api/transit/route')){routes++;data=currentRoute;}else if(p.request.url.includes('nominatim')){queries++;data=[];}else{const q=new URLSearchParams(p.request.postData??'').get('data')??'';data={elements:[{type:'node',id:900001,lat:42.3564,lon:-71.0614,tags:{name:'TEST FIXTURE Cafe',amenity:q.includes('cafe')?'cafe':'restaurant'}}]};}
await send('Fetch.fulfillRequest',{requestId:p.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:'*'}],body:Buffer.from(JSON.stringify(data)).toString('base64')}).catch(()=>{});});
try{
await send('Runtime.enable');await send('Page.enable');await send('Emulation.setFocusEmulationEnabled',{enabled:true});await send('Page.bringToFront');
await send('Fetch.enable',{patterns:[{urlPattern:'*overpass*'},{urlPattern:'*/api/transit/route'},{urlPattern:'*nominatim*'}]});
await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__geoCalls=0;navigator.geolocation.getCurrentPosition=()=>{window.__geoCalls++};`});
await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:'http://localhost:5173/'});
for(let i=0;i<60;i++){if(await js('!!window.vibentaTrip && !!window.map && map.loaded()'))break;await sleep(500);}
console.log('ready',await js('({trip:!!window.vibentaTrip,map:!!window.map,loaded:window.map?.loaded(),pins:document.querySelectorAll(".pin").length})'));
for(const width of [1440,1366,1280]){
await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});await sleep(500);
const layout=await js(`(()=>{const a=document.querySelector('.vb-tools-widget'),b=document.querySelector('.vb-preferences-widget'),x=a.getBoundingClientRect(),y=b.getBoundingClientRect();return {independent:a.parentElement===b.parentElement&&!b.contains(a),above:x.bottom<y.top,left:x.left===y.left,width:x.width===y.width,gap:y.top-x.bottom,vibe:b.contains(document.querySelector('.vb-vibe'))}})()`);
check('independent tools above complete preferences '+width,Object.values(layout).every(Boolean),layout);await shot('desktop-'+width);
}
const snap=()=>js(`JSON.stringify({prefs:vibentaDiscovery.getPreferences(),cls:document.querySelector('.vb-discovery').className,body:document.querySelector('.vb-body').hidden})`);
let before=await snap();const pin=await js(`(()=>{const p=[...document.querySelectorAll('.pin')].find(p=>p.getBoundingClientRect().width>0);p?.click();return p?.getAttribute('aria-label')})()`);await sleep(600);
check('pin opens popup without routing',!!pin&&routes===0&&await js('!!document.querySelector(".vb-place-popup")'),{pin,routes});check('popup preserves preferences',before===await snap());
const business=await js(`document.querySelector('.vb-place-popup h3')?.textContent`);
await click('.vb-tool');await sleep(700);
check('Search prefilled destination',await js(`vibentaTrip.getState().to?.label===${JSON.stringify(business)}`));
check('Search preserves pitch and never routes',await js('map.getPitch()>5&&document.body.dataset.focus==="search"')&&routes===0,await js('({pitch:map.getPitch(),focus:document.body.dataset.focus,dim:map.getPaintProperty("vb-map-focus","fill-opacity")})'));
check('Search keeps preferences accessible',await js('!document.querySelector(".vb-body").hidden&&document.querySelector(".vb-vibe textarea").offsetHeight>0'));await shot('search');
await click('.vb-tool');await click('.vb-popup-navigate');await sleep(900);
check('Navigate without start locks 2D and does not route',await js('map.getPitch()===0&&map.getMaxPitch()===0&&!vibentaTrip.getState().from&&vibentaTrip.getState().navigationOpen')&&routes===0);
check('starting input focused',await js('document.activeElement===document.querySelector(".vb-planner input")'));
await js(`vibentaTrip.dispatch({type:'setFrom',endpoint:${JSON.stringify(from)}})`);await sleep(1600);
check('one explicit navigation request',routes===1,{routes});
const route=await js(`(async()=>{const lines=await map.getSource('transit-route')?.getData();const stations=await map.getSource('transit-route-stations')?.getData();return {status:vibentaTrip.getState().route.kind,sources:!!map.getSource('transit-route'),layers:map.getStyle().layers.map(l=>l.id).filter(id=>id==='vb-map-focus'||id.startsWith('transit-route')),colors:lines?.features?.map(f=>f.properties.color),walks:lines?.features?.filter(f=>f.properties.kind==='walk').length,stations:stations?.features?.length}})()`);
check('route layers above dim',route.layers.indexOf('transit-route-ride')>route.layers.indexOf('vb-map-focus'),route);
check('line colors and no estimate geometry',route.colors?.includes('#DA291C')&&route.colors?.includes('#00843D')&&route.walks===0&&route.stations===3);await shot('navigation');
await js('void map.easeTo({pitch:60,duration:0});document.getElementById("tilt-toggle").click()');await sleep(200);
check('programmatic pitch and tilt control locked',await js('map.getPitch()===0&&document.getElementById("tilt-toggle").disabled'));
// Right drag and Ctrl drag exercise the browser gesture handlers.
for(const modifiers of [0,2]){await send('Input.dispatchMouseEvent',{type:'mousePressed',x:1000,y:500,button:'right',buttons:2,clickCount:1,modifiers});await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:1100,y:650,button:'right',buttons:2,modifiers});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:1100,y:650,button:'right',buttons:0,clickCount:1,modifiers});}
check('right drag lock',await js('map.getPitch()===0'));
await click('[aria-label="Close directions"]');await sleep(800);
check('exit restores pitch and clears route',await js('(async()=>map.getPitch()>5&&map.getMaxPitch()===75&&(await map.getSource("transit-route").getData()).features.length===0&&document.querySelectorAll(".vb-trip-destination").length===0)()'));
await js(`vibentaTrip.dispatch({type:'setFrom',endpoint:${JSON.stringify(from)}});vibentaTrip.dispatch({type:'setTo',endpoint:${JSON.stringify(to)}})`);
await click('.vb-tool');await sleep(500);await js(`vibentaTrip.dispatch({type:'setTo',endpoint:${JSON.stringify(to)}})`);await click('.vb-planner-find');await sleep(900);
check('Get Directions enters navigation',routes===2&&await js('vibentaTrip.getState().navigationOpen&&document.body.dataset.focus==="navigation"'));
await click('[aria-label="Close directions"]');await sleep(600);
await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await sleep(600);
await click('.vb-summary-btn');await sleep(500);await shot('mobile-preferences');
await click('.vb-tool');await sleep(500);await shot('mobile-search');
const mobile=await js(`(()=>{const a=document.querySelector('.vb-tools-widget').getBoundingClientRect(),b=document.querySelector('.vb-preferences-widget').getBoundingClientRect();return {above:a.bottom<b.top,onscreen:a.top>=0&&b.bottom<=844,vibe:document.querySelector('.vb-vibe textarea').offsetHeight>0}})()`);
check('mobile separate cards accessible',mobile.above&&mobile.onscreen&&mobile.vibe,mobile);
await click('.vb-tool');await js(`vibentaTrip.dispatch({type:'navigateTo',destination:${JSON.stringify(to)},discoveryOrigin:null})`);await sleep(1200);await shot('mobile-navigation');
check('mobile navigation 2D and focus',await js('map.getPitch()===0&&map.getMaxPitch()===0&&map.getPaintProperty("vb-map-focus","fill-opacity")===.36'));
await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:150,y:470},{x:230,y:470}]});
await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:150,y:510},{x:230,y:510}]});
await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await sleep(400);
check('two finger touch pitch locked',await js('map.getPitch()===0'));
await click('[aria-label="Close directions"]');await sleep(700);
// Save a genuine popup record, then reopen it outside the loaded pin area.
await js('void map.jumpTo({center:[-71.0636,42.3555],zoom:16})');await sleep(2500);
await js(`document.querySelector('.pin')?.click()`);await sleep(500);
await click('.vb-popup-save');const savedName=await js(`document.querySelector('.vb-place-popup h3').textContent`);
await js(`void map.jumpTo({center:[-71.22,42.4],zoom:16})`);await sleep(1800);
const prefsBeforeSaved=await snap();
await js(`[...document.querySelectorAll('.vb-tool')].find(b=>b.textContent.includes('Saved')).click()`);await sleep(500);await shot('mobile-saved');
await click('[data-view="saved"] .vb-result');await sleep(900);
check('Saved selection opens standard popup and closes Saved',await js(`document.querySelector('.vb-place-popup h3')?.textContent===${JSON.stringify(savedName)}&&document.querySelector('.vb-discovery').dataset.panelView==='preferences'`));
check('Saved preserves preferences',prefsBeforeSaved===await snap());
check('Saved uses at most one temporary marker',await js('document.querySelectorAll(".vb-temporary-place").length<=1'));await shot('mobile-saved-popup');
await click('.vb-popup-close');check('temporary marker removed on close',await js('document.querySelectorAll(".vb-temporary-place").length===0'));
// Destination typing stays offline; only Enter submits Nominatim.
await click('.vb-tool');await sleep(400);
await js(`document.querySelector('[data-view="search"] .vb-field:nth-child(3) .vb-trigger').click()`);
await js(`(()=>{const i=document.querySelector('[data-view="search"] .vb-field:nth-child(3) input');i.value='Broad Boston query';i.dispatchEvent(new Event('input',{bubbles:true}))})()`);await sleep(400);
check('typing never queries Nominatim',queries===0,{queries});
await js(`document.querySelector('[data-view="search"] .vb-field:nth-child(3) input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))`);await sleep(500);
check('Destination Enter queries Nominatim once',queries===1,{queries});
await js(`document.querySelector('[data-view="search"] .vb-field:nth-child(3) input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`);
await click('.vb-tool');

// Error, no-route, and no-service UI use labeled intercepted API responses.
currentRoute={status:'no_tier1_route',reason:'same_stop'};
await js(`vibentaTrip.dispatch({type:'navigateTo',destination:${JSON.stringify(to)},discoveryOrigin:${JSON.stringify(from)}})`);await sleep(700);
check('no route state',await js('vibentaTrip.getState().route.result?.status==="no_route"&&document.querySelector(".vb-planner-results").textContent.includes("same one")'));
currentRoute={status:'no_service',message:'TEST FIXTURE no service',nextScheduledDepartureAt:'2026-11-22T12:00:00Z'};
await click('.vb-planner-results .vb-text-btn');await sleep(600);
check('no service state',await js('document.querySelector(".vb-planner-results").textContent.includes("Next scheduled departure")'));
currentRoute={status:'ok',option:{legs:'TEST FIXTURE invalid'}};
await click('.vb-planner-results .vb-text-btn');await sleep(600);
check('invalid response state',await js('document.querySelector(".vb-planner-results").textContent.includes("Invalid response")'));
currentRoute=fixture;
for(let i=0;i<3;i++){
 await js('vibentaTrip.dispatch({type:"endNavigation"})');
 await js(`vibentaTrip.dispatch({type:'navigateTo',destination:${JSON.stringify(to)},discoveryOrigin:${JSON.stringify(from)}})`);await sleep(500);
}
check('repeated trips do not duplicate layers or markers',await js('(()=>{const layers=map.getStyle().layers.map(l=>l.id).filter(id=>id.startsWith("transit-route"));return new Set(layers).size===6&&layers.length===6&&document.querySelectorAll(".vb-trip-destination").length===1})()'));
await click('[aria-label="Close directions"]');await sleep(700);
// Pick an actual offline Boston origin through the shared autocomplete keyboard UI.
await click('.vb-step > .vb-field:nth-child(4) .vb-trigger');
await js('(()=>{const i=document.querySelector(".vb-step > .vb-field:nth-child(4) input");i.value="Harvard";i.dispatchEvent(new Event("input",{bubbles:true}))})()');await sleep(350);
await js('(()=>{const i=document.querySelector(".vb-step > .vb-field:nth-child(4) input");for(const key of ["ArrowDown","Enter"])i.dispatchEvent(new KeyboardEvent("keydown",{key,bubbles:true,cancelable:true}))})()');await sleep(300);
await js('void map.jumpTo({center:[-71.06,42.35]})');
await js('[...document.querySelectorAll(".vb-tool")].find(b=>b.textContent.includes("Recenter")).click()');await sleep(1800);
check('Recenter uses selected discovery origin',await js('(()=>{const o=vibentaDiscovery.getPreferences().origin,c=map.getCenter();return !!o&&Math.abs(c.lng-o.location.lng)<.00001&&Math.abs(c.lat-o.location.lat)<.00001})()'));
check('no automatic GPS',await js('window.__geoCalls===0'));
check('no JS errors',errors.length===0,errors);
}finally{writeFileSync(`${OUT}/results.json`,JSON.stringify({checks,errors,routes,queries},null,2));ws.close();chrome.kill('SIGTERM');}
if(checks.some(c=>!c.ok))process.exitCode=1;
