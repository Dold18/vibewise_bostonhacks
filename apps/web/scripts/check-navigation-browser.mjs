// Node 26 + Google Chrome on macOS. Run while npm run dev:all serves port 5173.
// Transit, Overpass and Nominatim are intercepted TEST FIXTURES, not live verification.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
const OUT='/private/tmp/vibenta-refinement-qa';mkdirSync(OUT,{recursive:true});
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--remote-debugging-port=9384',`--user-data-dir=${OUT}/chrome-${Date.now()}`,'--no-first-run','--no-default-browser-check','--use-angle=swiftshader','--enable-unsafe-swiftshader','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let targets;for(let i=0;i<60;i++){try{targets=await(await fetch('http://127.0.0.1:9384/json')).json();if(targets.some(t=>t.type==='page'))break;}catch{}await sleep(200);}
const ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
let id=0;const pending=new Map(),handlers=new Map(),errors=[],networkFailures=[],checks=[];
ws.onmessage=m=>{const a=JSON.parse(m.data);if(a.id){pending.get(a.id)?.(a);pending.delete(a.id);}handlers.get(a.method)?.(a.params);if(a.method==='Runtime.exceptionThrown')errors.push(a.params.exceptionDetails.exception?.description);if(a.method==='Runtime.consoleAPICalled'&&a.params.type==='error')errors.push(a.params.args.map(a=>a.value??a.description).join(' '));if(a.method==='Network.loadingFailed'&&!a.params.canceled)networkFailures.push(a.params.errorText);};
const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,a=>a.error?reject(Error(a.error.message)):resolve(a.result));ws.send(JSON.stringify({id:n,method,params}));});
const js=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description);return r.result.value;};
const check=(name,ok,detail)=>{checks.push({name,ok:!!ok,detail});console.log(ok?'PASS':'FAIL',name,detail??'');};
const click=sel=>js(`document.querySelector(${JSON.stringify(sel)}).click()`);
// Screenshots can stall software WebGL rendering; functional assertions always run.
const shot=async name=>{if(process.argv.includes('--skip-screenshots'))return;let timer;try{const capture=await Promise.race([send('Page.captureScreenshot',{format:'png'}),new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Screenshot timed out: '+name)),20000))]);writeFileSync(`${OUT}/${name}.png`,Buffer.from(capture.data,'base64'));}finally{clearTimeout(timer)}};
const waitFor=async expression=>{for(let i=0;i<80;i++){if(await js(expression))return;await sleep(250);}throw Error('Timed out: '+expression);};
const from={label:'Harvard TEST FIXTURE',location:{lat:42.374,lng:-71.12},source:'local_suggestion'};
const to={label:'Kenmore TEST FIXTURE',location:{lat:42.347,lng:-71.097},source:'local_suggestion'};
const walk=(a,b)=>({mode:'walk',durationSec:120,geometry:[a,b],source:'approx: straight-line walk, ~80 m/min'});
const rail=(name,color,a,b,an,bn)=>({mode:'subway',durationSec:600,geometry:[a,b],start:{lng:a[0],lat:a[1]},end:{lng:b[0],lat:b[1]},routeShortName:name,routeColor:color,fromStopName:an,toStopName:bn});
const estimated={status:'ok',tier:2,option:{durationSec:1740,transfers:1,legs:[walk([-71.12,42.374],[-71.119,42.373]),rail('Red','#DA291C',[-71.119,42.373],[-71.062,42.356],'Harvard TEST FIXTURE','Park Street TEST FIXTURE'),walk([-71.062,42.356],[-71.059,42.359]),rail('B','#00843D',[-71.059,42.359],[-71.095,42.349],'Government Center TEST FIXTURE','Kenmore TEST FIXTURE'),walk([-71.095,42.349],[-71.097,42.347])]},lastTrainBack:null,lastTrainBackNote:'TEST FIXTURE unavailable'};
const verified=structuredClone(estimated);for(const l of verified.option.legs)if(l.mode==='walk')l.source='pedestrian-route: TEST FIXTURE';
let routeBody=estimated,routes=0,queries=0;
handlers.set('Fetch.requestPaused',async p=>{let data;if(p.request.url.includes('/api/transit/route')){routes++;data=structuredClone(routeBody);await sleep(200);}else if(p.request.url.includes('nominatim')){queries++;data=[{place_id:900001,osm_type:'node',osm_id:900001,lat:'42.3564',lon:'-71.0614',name:'TEST FIXTURE Search destination',display_name:'TEST FIXTURE Boston',type:'cafe',class:'amenity'}];}else data={elements:[{type:'node',id:900002,lat:42.3564,lon:-71.0614,tags:{name:'TEST FIXTURE newly loaded cafe',amenity:'cafe'}}]};
await send('Fetch.fulfillRequest',{requestId:p.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:'*'}],body:Buffer.from(JSON.stringify(data)).toString('base64')}).catch(()=>{});});
const nav=async(origin=from)=>{await js(`vibentaTrip.dispatch({type:'navigateTo',destination:${JSON.stringify(to)},discoveryOrigin:${JSON.stringify(origin)}})`);await sleep(900);};
const exit=async()=>{await js(`vibentaTrip.dispatch({type:'endNavigation'})`);await sleep(650);};
const layout=()=>js(`(()=>{const a=document.querySelector('.vb-tools-widget'),b=document.querySelector('.vb-preferences-widget:not([hidden]),.vb-directions-slot:not([hidden])'),x=a.getBoundingClientRect(),y=b.getBoundingClientRect();return {independent:a.parentElement===b.parentElement,above:x.bottom<y.top,aligned:Math.abs(x.left-y.left)<1&&Math.abs(x.width-y.width)<1,onScreen:x.top>=0&&y.bottom<=innerHeight+1}})()`);
const hiddenPins=()=>js(`[...document.querySelectorAll('.pin:not(.vb-temporary-place)')].every(e=>getComputedStyle(e).visibility==='hidden'&&getComputedStyle(e).pointerEvents==='none'&&e.inert)`);
const routeData=()=>js(`(async()=>{const lines=await map.getSource('transit-route')?.getData();return lines?.features??[]})()`);
const stateSnapshot=()=>js(`(()=>{const s=vibentaDiscovery.getPreferences();return JSON.stringify({...s,vibeImages:s.vibeImages.map(f=>({name:f.name,size:f.size,lastModified:f.lastModified})),step:document.querySelector('.vb-discovery').dataset.step,layout:document.querySelector('.vb-discovery').classList.contains('is-expanded')})})()`);
try{
await send('Runtime.enable');await send('Page.enable');await send('Network.enable');await send('Emulation.setFocusEmulationEnabled',{enabled:true});await send('Page.bringToFront');
await send('Fetch.enable',{patterns:[{urlPattern:'*overpass*'},{urlPattern:'*/api/transit/route'},{urlPattern:'*nominatim*'}]});
await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__geoCalls=0;navigator.geolocation.getCurrentPosition=()=>{window.__geoCalls++};`});
await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:'http://localhost:5173/'});
await waitFor('!!window.vibentaTrip&&!!window.map&&map.loaded()&&document.querySelectorAll(".pin").length>0');
for(const width of [1440,1366,1280]){await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});await sleep(250);const l=await layout();check('Discovery cards '+width,Object.values(l).every(Boolean),l);await shot('discovery-'+width);}
check('preferences keep blue header and field accents',await js('getComputedStyle(document.querySelector(".vb-title")).color==="rgb(23, 78, 166)"&&getComputedStyle(document.querySelector(".vb-preferences-widget .vb-label")).color==="rgb(40, 90, 150)"'));
check('Discovery pins have no glow',await js('getComputedStyle(document.querySelector(".pin-body")).filter==="none"'));
check('Step 1 is practical only',await js('document.querySelector("[data-step=preferences]").offsetHeight>0&&document.querySelector("[data-step=vibe]").hidden&&!!document.querySelector(".vb-continue-btn")'));
const original=await stateSnapshot();await js('document.querySelector(".pin").click()');await sleep(700);
check('ordinary popup never routes or collapses',routes===0&&original===await stateSnapshot());
await click('.vb-tool');await sleep(500);
check('Search darker and preserves pitch',await js('map.getPaintProperty("vb-map-focus","fill-opacity")===.44&&map.getPitch()>5'));
check('unrelated Search pins hidden and inert',await js('[...document.querySelectorAll(".pin:not(.selected)")].every(e=>getComputedStyle(e).visibility==="hidden"&&e.inert)'));
check('Search enables a slight pin glow',await js('getComputedStyle(document.querySelector(".pin-body")).filter!=="none"'));
check('Search does not route',routes===0);
check('hidden pins do not intercept pointer hit tests',await js(`(()=>{const p=[...document.querySelectorAll('.pin.vb-marker-hidden')].find(e=>{const r=e.getBoundingClientRect();return r.left>420&&r.right<innerWidth-80&&r.top>50&&r.bottom<innerHeight-50});if(!p)return true;const r=p.getBoundingClientRect();return document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.closest('.pin')!==p})()`));await shot('search');
await js('window.__oldPin=document.querySelector(".pin")');
await click('[data-step="preferences"] > .vb-field:nth-child(1) .vb-trigger');
await click('[data-step="preferences"] [data-id="food_drinks"]');await sleep(1300);
check('pins loaded during Search obey focus visibility',await js('!document.contains(window.__oldPin)&&[...document.querySelectorAll(".pin")].filter(p=>p.getAttribute("aria-label")!==vibentaTrip.getState().to?.label).every(p=>getComputedStyle(p).visibility==="hidden"&&p.inert)'));
// Reopen the known selected destination popup after an intentional preference edit refreshed pins.
await click('.vb-tool');await js('void map.jumpTo({center:[-71.0636,42.3555],zoom:16})');await waitFor('document.querySelectorAll(".pin").length>0');await js('document.querySelector(".pin").click()');await click('.vb-tool');await sleep(250);

await click('.vb-tool');await click('.vb-popup-navigate');await sleep(900);
check('missing origin expands Directions and replaces preferences',await js('vibentaTrip.getState().directionsExpanded&&vibentaTrip.getState().navigationOpen&&!vibentaTrip.getState().from&&document.querySelector(".vb-preferences-widget").hidden&&!document.querySelector(".vb-directions-slot").hidden')&&routes===0);
check('missing origin focused with explicit GPS action',await js('document.activeElement===document.querySelector(".vb-planner input")&&document.querySelector(".vb-planner .vb-geo-btn").offsetHeight>0'));
await js(`vibentaTrip.dispatch({type:'setFrom',endpoint:${JSON.stringify(from)}})`);await waitFor('vibentaTrip.getState().route.kind==="done"');await sleep(700);
check('Navigation dark and locked',await js('map.getPaintProperty("vb-map-focus","fill-opacity")===.60&&map.getPitch()===0&&map.getMaxPitch()===0'));
check('all ordinary pins hidden in Navigation',await hiddenPins());
check('initial, transfer and final estimated walking connections are visible and labeled',(await routeData()).filter(f=>f.properties.kind==='walk_estimate'&&f.properties.label==='Walk · estimate'&&f.geometry.coordinates.length===21).length===3&&await js('document.querySelector(".vb-planner-results").textContent.includes("not verified pedestrian directions")'));
check('board, exit and both walking-transfer stations',await js('document.querySelectorAll(".vb-route-hub").length===4&&document.querySelectorAll(".vb-route-hub.is-transfer").length===2&&[...document.querySelectorAll(".vb-route-hub")].every(e=>e.getAttribute("aria-label")&&e.querySelector("svg"))'));
check('main contrast casing and two-tone pins survive the refined navigation UI',await js('map.getPaintProperty("transit-route-casing","line-color")==="#ffffff"&&getComputedStyle(document.querySelector(".pin-ring")).stroke==="rgb(26, 29, 36)"&&getComputedStyle(document.querySelector(".pin-head")).stroke==="rgb(255, 255, 255)"&&document.querySelectorAll(".vb-hub-label").length===4'));
check('neon rail glow preserves MBTA color',await js('map.getPaintProperty("transit-route-ride-glow","line-blur")===6&&map.getPaintProperty("transit-route-ride-highlight","line-opacity")===.75&&map.getPaintProperty("transit-route-ride","line-color")[1]==="color"'));
check('route layer above focus',await js('(()=>{const ids=map.getStyle().layers.map(l=>l.id);return ids.indexOf("transit-route-ride")>ids.indexOf("vb-map-focus")})()'));
const gen=await js('vibentaTrip.getState().generation'),calls=routes;await click('[aria-label="Collapse directions"]');await sleep(500);
check('collapsed Directions retains the walking-estimates disclosure',await js('!document.querySelector(".vb-directions-estimates").hidden'));
check('collapse retains navigation, route, hubs and request',routes===calls&&await js(`vibentaTrip.getState().generation===${gen}&&vibentaTrip.getState().navigationOpen&&map.getPitch()===0&&document.querySelectorAll('.vb-route-hub').length===4&&!document.querySelector('.vb-preferences-widget').hidden&&!document.querySelector('.vb-directions-control').hidden`));
await shot('navigation-compact');await click('.vb-directions-pill');await sleep(300);
for(const width of [1440,1366,1280]){await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});await sleep(250);const l=await layout();check('Directions replaces card '+width,Object.values(l).every(Boolean)&&await js('document.querySelector(".vb-preferences-widget").hidden'),l);await shot('directions-'+width);}
await click('.vb-directions-slot .vb-exit-navigation');await sleep(700);
check('Exit removes all navigation overlays and releases pitch',await js('!vibentaTrip.getState().navigationOpen&&map.getPitch()>5&&map.getMaxPitch()===75&&document.querySelectorAll(".vb-route-hub,.vb-trip-destination").length===0')&&(await routeData()).length===0);
await js('void map.jumpTo({center:[-71.0636,42.3555],zoom:16})');await waitFor('document.querySelectorAll(".pin").length>0');
check('discovery pins restore',await js('[...document.querySelectorAll(".pin")].some(e=>getComputedStyle(e).visibility==="visible"&&!e.inert)'),await js('({count:document.querySelectorAll(".pin").length,focus:document.body.dataset.focus})'));
// Upstream two-step component, real File objects and decoded local preview images.
await click('.vb-footer-actions .vb-continue-btn');await sleep(300);
check('one vibe heading and no redundant subtitle',await js('document.querySelector(".vb-title").textContent==="What’s your vibe?"&&document.querySelector(".vb-subtitle").hidden&&!document.querySelector(".vb-vibe-heading")'));
check('seven upstream vibe examples',await js('document.querySelectorAll(".vb-vibe-example").length===7&&document.querySelector(".vb-discovery").dataset.step==="vibe"'));
await click('.vb-vibe-example');
await js(`(()=>{const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCuoAAAAASUVORK5CYII='),c=>c.charCodeAt(0));const dt=new DataTransfer();for(let i=0;i<2;i++)dt.items.add(new File([bytes],'TEST FIXTURE '+i+'.png',{type:'image/png',lastModified:i+1}));const input=document.querySelector('.vb-upload-zone input');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));window.__imageRefs=[...vibentaDiscovery.getPreferences().vibeImages]})()`);await sleep(400);
await js('document.querySelector(".vb-image-previews").scrollIntoView({block:"center"})');await waitFor('[...document.querySelectorAll(".vb-image-preview img")].every(i=>i.complete&&i.naturalWidth>0)');await shot('local-photo-previews');
check('multiple local image previews decode',await js('vibentaDiscovery.getPreferences().vibeImages.length===2&&[...document.querySelectorAll(".vb-image-preview img")].every(i=>i.complete&&i.naturalWidth>0)'));
const vibe=await stateSnapshot();await click('.vb-back-btn');await click('.vb-footer-actions .vb-continue-btn');
check('step changes retain all preference data and images',vibe===await stateSnapshot());
await shot('vibe');await nav();
check('valid navigation initially opens Directions with vibe preserved',await js('vibentaTrip.getState().directionsExpanded&&document.querySelector(".vb-directions-control").hidden&&document.querySelector(".vb-preferences-widget").hidden&&document.querySelector(".vb-discovery").dataset.step==="vibe"'));
await sleep(200);check('Directions preserves original File objects',await js('window.__imageRefs.every((f,i)=>vibentaDiscovery.getPreferences().vibeImages[i]===f)'));
await click('[aria-label="Collapse directions"]');await sleep(200);check('collapse restores exact Vibe step',vibe===await stateSnapshot());
await exit();check('Exit restores exact Vibe step',vibe===await stateSnapshot());
await click('.vb-image-remove');check('individual image removal works',await js('vibentaDiscovery.getPreferences().vibeImages.length===1&&document.querySelectorAll(".vb-image-preview").length===1'));
// A verified-walk fixture exercises initial, transfer and final walking paths.
routeBody=verified;await nav();const lines=await routeData();
check('three verified walking legs and correct rail colors',lines.filter(f=>f.properties.kind==='walk').length===3&&lines.some(f=>f.properties.color==='#DA291C')&&lines.some(f=>f.properties.color==='#00843D'));
check('walking has a subtle neon glow',await js('map.getPaintProperty("transit-route-walk-glow","line-color")==="#73C7FF"&&map.getPaintProperty("transit-route-walk-glow","line-opacity")===.5'));
check('walking dark dashes with light casing',await js('map.getPaintProperty("transit-route-walk","line-color")==="#17212E"&&map.getPaintProperty("transit-route-walk-casing","line-color")==="#F7FAFC"&&map.getPaintProperty("transit-route-walk","line-dasharray").length===2'));
await shot('verified-walking-fixture');await click('[aria-label="Collapse directions"]');
await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await sleep(400);await shot('mobile-compact');await click('.vb-directions-pill');await sleep(400);
const mobile=await layout();check('mobile Directions uses the same bottom sheet',Object.values(mobile).every(Boolean)&&await js('document.querySelector(".vb-preferences-widget").hidden'),mobile);await shot('mobile-directions');
await click('[aria-label="Collapse directions"]');await sleep(300);check('mobile collapse restores Vibe and keeps route',await js('document.querySelector(".vb-discovery").dataset.step==="vibe"&&document.querySelectorAll(".vb-route-hub").length===4&&map.getPitch()===0&&vibentaDiscovery.getPreferences().vibeImages.length===1'));
await shot('mobile-vibe-navigation');
await js('void map.easeTo({pitch:60,duration:0});document.getElementById("tilt-toggle").click()');
await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:150,y:150},{x:230,y:150}]});await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:150,y:200},{x:230,y:200}]});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await sleep(200);
check('navigation pitch gestures and programmatic tilt stay locked',await js('map.getPitch()===0&&document.getElementById("tilt-toggle").disabled'));
await click('.vb-tool');await sleep(300);check('Search during Navigation keeps Navigation priority',await js('document.body.dataset.focus==="navigation"&&map.getPitch()===0&&document.querySelectorAll(".vb-route-hub").length===4'));
await exit();check('ordinary Search has no route hubs',await js('document.body.dataset.focus==="search"&&document.querySelectorAll(".vb-route-hub").length===0'));
await js(`document.querySelector('[data-view="search"] .vb-field:nth-child(3) .vb-trigger').click();const i=document.querySelector('[data-view="search"] .vb-field:nth-child(3) input');i.value='TEST FIXTURE Boston search';i.dispatchEvent(new Event('input',{bubbles:true}));`);await sleep(300);
check('typing remains offline',queries===0);
await js(`document.querySelector('[data-view="search"] .vb-field:nth-child(3) input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))`);await sleep(500);
check('submit-only search shows relevant result markers',queries===1&&await js('document.querySelector("[data-marker-kind=search]")&&getComputedStyle(document.querySelector("[data-marker-kind=search]")).visibility==="visible"'));
await click('.vb-tool');await sleep(400);
check('Discovery removes route-only markers and restores normal pins',await js('document.body.dataset.focus==="discovery"&&document.querySelectorAll(".vb-route-hub").length===0&&map.getPaintProperty("vb-map-focus","fill-opacity")===0'));
routeBody=estimated;
for(let i=0;i<3;i++){await nav();await exit();}
check('repeated navigation removes every hub and destination marker',await js('document.querySelectorAll(".vb-route-hub,.vb-trip-destination").length===0&&new Set(map.getStyle().layers.filter(l=>l.id.startsWith("transit-route-")).map(l=>l.id)).size===11'));
routeBody={status:'no_tier1_route',reason:'same_stop'};await nav();
check('Directions no-route state',await js('document.querySelector(".vb-planner-results").textContent.includes("same one")'));
routeBody={status:'no_service',message:'TEST FIXTURE no service',nextScheduledDepartureAt:'2026-11-22T12:00:00Z'};await click('.vb-planner-results .vb-text-btn');await sleep(500);
check('Directions no-service state',await js('document.querySelector(".vb-planner-results").textContent.includes("Next scheduled departure")'));
routeBody={status:'ok',option:{legs:'TEST FIXTURE invalid'}};await click('.vb-planner-results .vb-text-btn');await sleep(500);
check('Directions invalid-response state',await js('document.querySelector(".vb-planner-results").textContent.includes("Invalid response")'));
await exit();
check('Discovery removes glow again',await js('[...document.querySelectorAll(".pin-body")].every(p=>getComputedStyle(p).filter==="none")&&[...document.querySelectorAll(".vb-origin-dot")].every(p=>getComputedStyle(p).boxShadow==="none")'));
check('no automatic geolocation',await js('window.__geoCalls===0'));
check('no browser exceptions',errors.length===0,errors);
console.log('Network failures:',networkFailures);
}finally{writeFileSync(`${OUT}/results.json`,JSON.stringify({checks,errors,networkFailures,routes,queries},null,2));ws.close();chrome.kill('SIGTERM');}
if(checks.some(c=>!c.ok))process.exitCode=1;
