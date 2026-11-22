// Show My Matches → Rank My Matches ⇄ Show Unranked Matches, in headless Chrome over CDP (Node 26, macOS).
//
// Start the API (`npm run server`) and Vite first; VIBENTA_QA_URL defaults to http://localhost:5173/.
// REAL: MiniLM embeddings (/api/vibe/embed), the Supabase catalog search (/api/vibe/search), map, popups, routing.
// TEST FIXTURES: quiz questions (/api/vibe/generate, so the run needs no Gemini key and finishes after three
// answers), one injected search failure, and one result set trimmed to two real places with tied scores.
import { fallbackQuestion } from '../src/features/vibe/families.ts';
import { finalPinScales, matchPositions } from '../src/features/map/finalPinScale.ts';
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

const URL_ = process.env.VIBENTA_QA_URL ?? 'http://localhost:5173/';
const OUT = process.env.VIBENTA_QA_OUTPUT ?? '/private/tmp/vibewise-rank-qa';
const PORT = Number(process.env.CDP_PORT ?? 9391);
mkdirSync(OUT, { recursive: true });
const PROFILE = `${OUT}/chrome-${Date.now()}`; // deleted at the end: each profile is ~100 MB
const chrome = spawn(process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (targets.some((t) => t.type === 'page')) break; } catch {} await sleep(200); }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map(), handlers = new Map(), errors = [], checks = [];
ws.onmessage = (m) => {
  const a = JSON.parse(m.data);
  if (a.id) { pending.get(a.id)?.(a); pending.delete(a.id); }
  handlers.get(a.method)?.(a.params);
  if (a.method === 'Runtime.exceptionThrown') errors.push(a.params.exceptionDetails.exception?.description ?? a.params.exceptionDetails.text);
  if (a.method === 'Runtime.consoleAPICalled' && a.params.type === 'error') errors.push(a.params.args.map((x) => x.value ?? x.description).join(' '));
};
const send = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; pending.set(n, (a) => (a.error ? reject(Error(a.error.message)) : resolve(a.result))); ws.send(JSON.stringify({ id: n, method, params })); });
const js = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail }); console.log(ok ? 'PASS' : 'FAIL', name, detail === undefined ? '' : JSON.stringify(detail)); };
const waitFor = async (expression, tries = 120) => { for (let i = 0; i < tries; i++) { if (await js(expression)) return; await sleep(250); } throw Error('Timed out: ' + expression); };
const shot = async (name) => { const c = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${OUT}/${name}.png`, Buffer.from(c.data, 'base64')); };

// --- network: fixture questions, real embeddings and search (recorded), optional search faults ---
let searchMode = 'real'; // 'real' | 'fail' | 'two-tied'
const searches = []; // { body, results }
const apiCalls = { generate: 0, embed: 0, search: 0 };
handlers.set('Network.requestWillBeSent', (p) => {
  const m = p.request.url.match(/\/api\/vibe\/(generate|embed|search)/);
  if (m) apiCalls[m[1]]++;
});
handlers.set('Fetch.requestPaused', async (p) => {
  const reply = (code, data) => send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: code, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(data)).toString('base64') }).catch(() => {});
  if (p.request.url.includes('/api/vibe/generate')) {
    const c = JSON.parse(p.request.postData);
    await sleep(150);
    return reply(200, { vibe_so_far: `TEST FIXTURE summary after ${c.history.length} answers: a warm, quiet evening with soft music, low light and room to talk without being rushed.`, nextQuestion: fallbackQuestion(c), qualifiers: [], continuation: c.history.length >= 3 ? 'finish' : 'refine', reason: 'TEST FIXTURE' });
  }
  // /api/vibe/search, paused at the response stage: the real catalog answered.
  const body = JSON.parse(p.request.postData);
  if (searchMode === 'fail') { searches.push({ body, results: null }); return reply(503, { error: 'TEST FIXTURE: search service unavailable.' }); }
  const raw = await send('Fetch.getResponseBody', { requestId: p.requestId });
  const real = JSON.parse(raw.base64Encoded ? Buffer.from(raw.body, 'base64').toString() : raw.body);
  if (searchMode === 'two-tied' && Array.isArray(real.results)) {
    const two = real.results.slice(0, 2).map((r) => ({ ...r, score: real.results[0].score }));
    searches.push({ body, results: two, fixture: true });
    return reply(200, { ...real, results: two });
  }
  searches.push({ body, results: real.results });
  return send('Fetch.continueRequest', { requestId: p.requestId }).catch(() => {});
});

// --- page helpers ---
const profile = () => js('vibentaOutingProfiles.getSnapshot()');
const quizButtons = () => js("[...document.querySelectorAll('.vb-live-quiz button')].map(b=>b.textContent)");
const clickText = (label) => js(`(()=>{const b=[...document.querySelectorAll('.vb-live-quiz button')].find(b=>b.textContent===${JSON.stringify(label)});if(!b)throw Error('Missing button '+${JSON.stringify(label)});b.click()})()`);
const action = () => js("(()=>{const b=document.querySelector('.vb-quiz-results-action');return b?{text:b.textContent,stage:b.dataset.matchesStage,ranked:b.dataset.ranked??null}:null})()");
const camera = () => js('(()=>{const c=map.getCenter();return {lng:c.lng,lat:c.lat,zoom:map.getZoom(),pitch:map.getPitch(),bearing:map.getBearing()}})()');
const settle = () => waitFor('!map.isMoving()&&!map.isZooming()').then(() => sleep(400));
const sameCamera = (a, b) => Math.abs(a.lng - b.lng) < 1e-9 && Math.abs(a.lat - b.lat) < 1e-9 && Math.abs(a.zoom - b.zoom) < 1e-9 && a.pitch === b.pitch && a.bearing === b.bearing;
const pins = () => js(`[...document.querySelectorAll('.pin:not([data-marker-kind])')].map(p=>({i:Number(p.dataset.index),label:p.getAttribute('aria-label'),scale:p.style.getPropertyValue('--pin-scale'),ranked:p.classList.contains('is-ranked'),top:p.classList.contains('is-top-match'),badge:(b=>b&&!b.hidden?b.textContent:null)(p.querySelector('.pin-rank')),badgePx:(b=>b&&!b.hidden?Math.round(b.getBoundingClientRect().width):0)(p.querySelector('.pin-rank')),z:Number(getComputedStyle(p).zIndex)||0,culled:p.classList.contains('culled'),qa:p.dataset.qa??null}))`);
const legend = () => js("(()=>{const l=document.querySelector('.vb-match-legend');if(!l)return null;const r=l.getBoundingClientRect();return {hidden:l.hidden,shown:getComputedStyle(l).display!=='none'&&r.width>0,text:l.textContent.replace(/\\s+/g,' ').trim(),inView:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight}})()");
const brandScan = async (where) => {
  const r = await js(`(()=>{const hits=[];if(/vibenta/i.test(document.title))hits.push('title');if(/vibenta/i.test(document.body.innerText))hits.push('text');for(const el of document.querySelectorAll('*'))for(const a of ['aria-label','title','placeholder','alt'])if(/vibenta/i.test(el.getAttribute(a)??''))hits.push(a+':'+el.getAttribute(a));return {title:document.title,hits}})()`);
  check(`branding: "${r.title}" and no visible or accessible "Vibenta" (${where})`, r.title === 'Vibewise' && r.hits.length === 0, r.hits.length ? r.hits : undefined);
};
async function answerUntilResults() {
  for (let i = 0; i < 6; i++) {
    const p = await profile();
    if (p?.phase === 'results') break;
    await waitFor("vibentaOutingProfiles.getSnapshot()?.phase==='question'||vibentaOutingProfiles.getSnapshot()?.phase==='results'");
    if ((await profile()).phase === 'results') break;
    const n = (await profile()).history.length;
    await js("document.querySelector('.vb-quiz-answer').click()");
    await waitFor(`vibentaOutingProfiles.getSnapshot()?.history.length===${n + 1}&&vibentaOutingProfiles.getSnapshot()?.phase!=='generating'`);
  }
  await waitFor("vibentaOutingProfiles.getSnapshot()?.phase==='results'&&vibentaOutingProfiles.getSnapshot()?.embedding.status==='ready'");
}
async function startQuiz(text) {
  await js("document.querySelector('.vb-continue-btn')?.click()");
  await js(`{const t=document.querySelector('.vb-vibe-story');t.value=${JSON.stringify(text)};t.dispatchEvent(new Event('input',{bubbles:true}));}`);
  await js("document.querySelector('.vb-begin-quiz').click()");
}
async function showMatches(expectReady = true) {
  const before = searches.length;
  await js("(()=>{window.__stages=[];const q=document.querySelector('.vb-live-quiz');window.__obs?.disconnect();window.__obs=new MutationObserver(()=>{const s=document.querySelector('.vb-quiz-results-action')?.dataset.matchesStage;if(s&&window.__stages.at(-1)!==s)window.__stages.push(s)});window.__obs.observe(q,{subtree:true,childList:true,attributes:true})})()");
  await js("document.querySelector('.vb-quiz-results-action').click()");
  if (expectReady) await waitFor("document.querySelector('.vb-quiz-results-action')?.dataset.matchesStage==='shown'||!!document.querySelector('.vb-quiz-matches-error')", 160);
  else await waitFor("!!document.querySelector('.vb-quiz-matches-error')", 160);
  return searches.slice(before);
}
/** A real mouse click on a pin's head. The camera first centers on the venue (no zoom change) when it is off screen. */
async function clickPin(index, location) {
  await js(`(()=>{const p=document.querySelector('.pin:not([data-marker-kind])[data-index="${index}"]');const r=p.getBoundingClientRect();const x=r.left+r.width/2,y=r.top+r.height/2;if(x>440&&x<innerWidth-80&&y>80&&y<innerHeight-80)return;map.jumpTo({center:[${location.lng},${location.lat}]});})()`);
  await settle();
  const rect = await js(`(()=>{const p=document.querySelector('.pin:not([data-marker-kind])[data-index="${index}"]');const r=p.querySelector('.pin-body').getBoundingClientRect();const x=r.left+r.width/2,y=r.top+r.height*0.35;const hit=document.elementFromPoint(x,y);return {x,y,hits:!!hit&&p.contains(hit),culled:p.classList.contains('culled'),hit:hit?(hit.className?.baseVal??hit.className)||hit.tagName:null}})()`);
  if (!rect.hits || rect.culled) {
    // Covered (by the popup or panel) or culled at this zoom: report it and fall back to a DOM click.
    await js(`document.querySelector('.pin:not([data-marker-kind])[data-index="${index}"]').click()`);
    return { real: false, culled: rect.culled, covered: rect.hit };
  }
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  return { real: true };
}
const popupTitle = () => js("document.querySelector('[id^=vb-popup-title-]')?.textContent??null");

try {
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/vibe/generate*' }, { urlPattern: '*/api/vibe/search*', requestStage: 'Response' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL_ });
  await waitFor('!!window.vibentaDiscovery&&!!window.vibentaOutingProfiles&&!!window.map&&map.loaded()');
  await sleep(1500);
  await brandScan('home');

  // ---------- 1–4: complete the quiz; one primary action at the top ----------
  await startQuiz('Warm lamplight, soft jazz and a quiet table to talk for hours, not crowded');
  await answerUntilResults();
  await sleep(800); // a final search must NOT start on its own
  const p0 = await profile();
  check('quiz completed on its own (not a user request)', p0.phase === 'results' && p0.completion.reason !== 'user_request', p0.completion.reason);
  const buttons0 = await quizButtons();
  check('completed results: exactly one "Show My Matches", no provisional toggle, no ranking control yet', buttons0.filter((b) => b === 'Show My Matches').length === 1 && !buttons0.some((b) => /^Show (all|ranked) places$|Rank My Matches|Show Unranked Matches/.test(b)), buttons0);
  check('"Show My Matches" is the top action (before the results heading, after the top bar)', await js("(()=>{const q=document.querySelector('.vb-live-quiz'),a=q.querySelector('.vb-quiz-results-action'),h=q.querySelector('h3.vb-quiz-prompt'),top=q.querySelector('.vb-quiz-top');return !!a&&a.textContent==='Show My Matches'&&!!(a.compareDocumentPosition(h)&Node.DOCUMENT_POSITION_FOLLOWING)&&!!(top.compareDocumentPosition(a)&Node.DOCUMENT_POSITION_FOLLOWING)})()"));
  const visible = await js("(()=>{const a=document.querySelector('.vb-quiz-results-action'),r=a.getBoundingClientRect();let s=a.parentElement;while(s&&!(/(auto|scroll)/.test(getComputedStyle(s).overflowY)&&s.scrollHeight>s.clientHeight))s=s.parentElement;const c=s?s.getBoundingClientRect():{top:0,bottom:innerHeight};return {top:r.top,bottom:r.bottom,boxTop:c.top,boxBottom:c.bottom,ok:r.top>=c.top-1&&r.bottom<=c.bottom+1&&r.top>=0&&r.bottom<=innerHeight,focused:document.activeElement===a}})()");
  check('"Show My Matches" is visible without scrolling (desktop) and focused on arrival', visible.ok && visible.focused, visible);
  check('no catalog search before the user asks', apiCalls.search === 0, apiCalls);
  await shot('1-completed-quiz');
  await brandScan('completed quiz');

  // ---------- 5–9: Show My Matches → real catalog results, unranked ----------
  const cam0 = await camera();
  const [s1] = await showMatches();
  const p1 = await profile();
  const stages1 = await js('window.__stages');
  check('a loading state appears before results ("Finding your matches…")', stages1.includes('loading') && stages1.at(-1) === 'shown', stages1);
  check('final search sends the quiz\'s current MiniLM vector', !!s1 && s1.body.modelKey === p1.embedding.modelKey && s1.body.vector.length === 384 && s1.body.vector.every((v, i) => Math.abs(v - p1.embedding.vector[i]) < 1e-12), { modelKey: s1?.body.modelKey, dims: s1?.body.vector.length });
  const results1 = s1.results;
  const pins1 = await pins();
  check('real Supabase restaurants are on the map, one pin per result in server order', results1.length > 3 && pins1.length === results1.length && pins1.every((p) => p.label.startsWith(results1[p.i].name)) && results1.every((r) => /^(fsq|osm):/.test(r.placeId)), { results: results1.length, pins: pins1.length, first: results1.slice(0, 3).map((r) => [r.name, +r.score.toFixed(4)]) });
  check('the primary action becomes "Rank My Matches"', (await action())?.text === 'Rank My Matches');
  check('unranked: uniform pins, no badges, no ranked styling, no legend', pins1.every((p) => p.scale === '1' && !p.ranked && !p.badge) && (await legend()).hidden === true);
  await settle();
  const cam1 = await camera();
  check('no starting point or granted location: the camera stays around the user\'s view (not fitted to the results)', Math.abs(cam1.lng - cam0.lng) < 1e-6 && Math.abs(cam1.lat - cam0.lat) < 1e-6, { before: cam0, after: cam1 });
  await shot('2-unranked-results');
  await brandScan('unranked results');

  // ---------- 10–17: Rank My Matches ----------
  await js("document.querySelectorAll('.pin:not([data-marker-kind])').forEach((p,i)=>p.dataset.qa='m'+i)");
  const callsBefore = { ...apiCalls };
  await clickText('Rank My Matches');
  await sleep(500);
  const ranked = await pins();
  const scores = results1.map((r) => r.score), expected = finalPinScales(scores), positions = matchPositions(scores);
  check('same marker elements (no re-render, no duplicates)', ranked.length === pins1.length && ranked.every((p) => p.qa === 'm' + p.i));
  check('pin size follows the actual final-search scores (0.8×–1.6×)', ranked.every((p) => Math.abs(parseFloat(p.scale) - expected[p.i]) < 1e-9), ranked.slice(0, 6).map((p) => [p.i, p.scale]));
  const best = ranked.find((p) => positions[p.i] === 1);
  const spread = Math.max(...scores) - Math.min(...scores);
  check('the strongest match is clearly the largest pin', parseFloat(best.scale) === Math.max(...ranked.map((p) => parseFloat(p.scale))) && (spread < 0.04 || parseFloat(best.scale) > 1.5), { best: best.label, scale: best.scale, spread: +spread.toFixed(4) });
  const badges = ranked.filter((p) => p.badge).map((p) => [Number(p.badge), positions[p.i], p.label]);
  check('badges 1, 2, 3 sit on the top three by score (server order breaks ties)', badges.length === Math.min(3, ranked.length) && badges.every(([b, pos]) => b === pos) && new Set(badges.map(([b]) => b)).size === badges.length, badges);
  check('badges are readable size on screen (≥ 16 px)', ranked.filter((p) => p.badge).every((p) => p.badgePx >= 16), ranked.filter((p) => p.badge).map((p) => p.badgePx));
  check('screen readers hear each rank', ranked.every((p) => p.label.includes(`match ${positions[p.i]} of ${ranked.length}`)), ranked[0].label);
  check('ranked styling on every final pin, top-match emphasis on exactly the top three', ranked.every((p) => p.ranked) && ranked.filter((p) => p.top).length === Math.min(3, ranked.length));
  check('top matches stack above other pins', ranked.filter((p) => p.top).every((t) => ranked.filter((p) => !p.top).every((o) => t.z > o.z)));
  const labels = await js("[...document.querySelectorAll('.pin .pin-name')].map(l=>l.textContent)");
  check('visible map labels show plain names (rank stays in the accessible name only)', labels.length > 0 && labels.every((t) => !/match \d+ of|deal on now/.test(t)), labels.slice(0, 4));
  const lg = await legend();
  check('match-strength legend is visible while ranked', lg.shown && !lg.hidden && lg.inView && /Match strength/.test(lg.text), lg);
  check('Rank My Matches does not call Gemini, MiniLM or the catalog again', JSON.stringify(apiCalls) === JSON.stringify(callsBefore), { before: callsBefore, after: apiCalls });
  check('Rank My Matches does not move the camera', sameCamera(await camera(), cam1));
  check('the action now reads "Show Unranked Matches"', (await action())?.text === 'Show Unranked Matches');
  await shot('3-ranked-results');
  await brandScan('ranked results');

  // ---------- 15–16: weak matches stay selectable; top three open the right places ----------
  const opened = [];
  for (const pos of [1, 2, 3]) {
    const i = positions.indexOf(pos);
    const how = await clickPin(i, results1[i].location);
    await waitFor(`document.querySelector('[id^=vb-popup-title-]')?.textContent===${JSON.stringify(results1[i].name)}`, 40).catch(() => {});
    opened.push({ pos, expected: results1[i].name, got: await popupTitle(), realClick: how.real, ...(how.real ? {} : { covered: how.covered, culled: how.culled }) });
    await settle();
  }
  check('clicking pins 1, 2, 3 opens each one\'s own venue', opened.every((o) => o.got === o.expected), opened);
  await shot('4-ranked-top-match-popup');
  const weakest = positions.indexOf(ranked.length);
  await js(`(()=>{const r=${JSON.stringify(results1[weakest].location)};map.jumpTo({center:[r.lng,r.lat],zoom:17.5})})()`);
  await settle();
  const weakClick = await clickPin(weakest, results1[weakest].location);
  await waitFor(`document.querySelector('[id^=vb-popup-title-]')?.textContent===${JSON.stringify(results1[weakest].name)}`, 40).catch(() => {});
  check('the weakest match is still on the map and selectable', (await popupTitle()) === results1[weakest].name, { name: results1[weakest].name, realClick: weakClick.real });
  await settle();

  // ---------- 18–20: Show Unranked Matches ----------
  const cam2 = await camera();
  const calls2 = { ...apiCalls };
  await clickText('Show Unranked Matches');
  await sleep(500);
  const un = await pins();
  check('unranked again: same venues, uniform pins, no badges or ranked styling', un.length === ranked.length && un.every((p) => p.qa === 'm' + p.i && p.scale === '1' && !p.badge && !p.ranked && !p.top));
  check('legend hidden again', (await legend()).hidden === true);
  check('Show Unranked Matches keeps the camera and calls nothing', sameCamera(await camera(), cam2) && JSON.stringify(apiCalls) === JSON.stringify(calls2));
  check('the action alternates back to "Rank My Matches"', (await action())?.text === 'Rank My Matches');
  await clickText('Rank My Matches');
  await sleep(300);
  check('and toggles to ranked again', (await action())?.text === 'Show Unranked Matches' && (await pins()).filter((p) => p.badge).length === Math.min(3, ranked.length));

  // ---------- 21–23: edit an earlier answer ----------
  await js("document.querySelector('.vb-quiz-history').open=true;[...document.querySelectorAll('.vb-quiz-history button')][0].click()");
  await waitFor("!!document.querySelectorAll('.vb-quiz-answer')[1]");
  await js("document.querySelectorAll('.vb-quiz-answer')[1].click()");
  await waitFor("vibentaOutingProfiles.getSnapshot()?.phase!=='results'");
  await sleep(300);
  const afterEdit = await pins();
  check('editing an answer clears stale ranks, badges and legend', !afterEdit.some((p) => p.ranked || p.badge) && (await legend()).hidden === true && !(await quizButtons()).some((b) => /Rank My Matches|Show Unranked Matches/.test(b)));
  await answerUntilResults();
  check('back in results, the top action asks again ("Show My Matches")', (await action())?.text === 'Show My Matches');
  const [s2] = await showMatches();
  const p2 = await profile();
  check('updated matches come from the edited profile\'s new vector', s2.body.vector.every((v, i) => Math.abs(v - p2.embedding.vector[i]) < 1e-12) && s2.body.vector.some((v, i) => Math.abs(v - s1.body.vector[i]) > 1e-6), { first: s2.results.slice(0, 3).map((r) => r.name) });
  check('updated matches start unranked', (await action())?.text === 'Rank My Matches' && (await pins()).every((p) => p.scale === '1' && !p.badge));

  // ---------- 25: loading failure, honest error, retry ----------
  await clickText('Rank My Matches');
  await clickText('Continue Refining');
  await answerUntilResults();
  searchMode = 'fail';
  await showMatches(false);
  const err = await js("({alert:document.querySelector('.vb-quiz-matches-error')?.textContent,action:document.querySelector('.vb-quiz-results-action')?.textContent,toast:document.getElementById('toast').hidden?null:document.getElementById('toast').textContent,ranked:document.querySelectorAll('.pin.is-ranked').length,finalPins:document.querySelectorAll('.pin:not([data-marker-kind])').length})");
  check('search failure: honest error, retry offered, no ranking control, no stale pins', /Couldn’t load your matches/.test(err.alert ?? '') && err.action === 'Show My Matches' && err.ranked === 0 && err.finalPins === 0, err);
  searchMode = 'real';
  await showMatches();
  check('retry after a failure loads real matches', (await action())?.text === 'Rank My Matches' && (await pins()).length > 0);

  // ---------- 26: fewer than three results, tied scores ----------
  await clickText('Continue Refining');
  await answerUntilResults();
  searchMode = 'two-tied';
  const [s3] = await showMatches();
  searchMode = 'real';
  await clickText('Rank My Matches');
  await sleep(300);
  const two = await pins();
  check('two results with tied scores: badges 1 and 2 only, in server order, equal sizes', two.length === 2 && two.find((p) => p.i === 0)?.badge === '1' && two.find((p) => p.i === 1)?.badge === '2' && two[0].scale === two[1].scale, two.map((p) => [p.i, p.badge, p.scale, p.label]));

  // ---------- 17: routing from a ranked match ----------
  const target = s3.results[0];
  await clickPin(0, target.location);
  await waitFor(`document.querySelector('[id^=vb-popup-title-]')?.textContent===${JSON.stringify(target.name)}`, 40);
  await js("document.querySelector('.vb-popup-navigate').click()");
  await waitFor('vibentaTrip.getState().navigationOpen', 40); // no starting point yet: directions open and wait for one
  const trip = await js("(()=>{const s=vibentaTrip.getState();return {open:s.navigationOpen,to:s.to?.placeId??null,label:s.to?.label??null,route:s.route.kind,status:s.route.result?.status??null}})()");
  check('Navigate from a ranked match opens directions to that venue', trip.open && trip.to === target.placeId, trip);
  await shot('5-navigation-from-ranked-match');
  await brandScan('navigation');
  await js("vibentaTrip.dispatch({type:'endNavigation'})");
  await sleep(500);

  // ---------- 24 + mobile: Start over does not carry ranking; results arrive with the action on screen ----------
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(600);
  await waitFor("[...document.querySelectorAll('.vb-live-quiz button')].some(b=>b.textContent==='Start over')");
  await clickText('Start over');
  await waitFor("vibentaOutingProfiles.getSnapshot()?.history.length===0");
  await sleep(300);
  check('Start over clears ranked mode, badges and legend', !(await pins()).some((p) => p.ranked || p.badge) && (await legend()).hidden === true);
  await answerUntilResults();
  await sleep(400);
  check('the new quiz offers "Show My Matches" again, not a ranking control', (await action())?.text === 'Show My Matches');
  const mobile = await js("(()=>{const a=document.querySelector('.vb-quiz-results-action'),r=a.getBoundingClientRect();return {top:Math.round(r.top),bottom:Math.round(r.bottom),h:innerHeight,focused:document.activeElement===a}})()");
  check('mobile: on reaching results the primary action is on screen and focused (no manual scrolling)', mobile.top >= 0 && mobile.bottom <= mobile.h && mobile.focused, mobile);
  await shot('6-mobile-completed-quiz');
  await showMatches();
  await clickText('Rank My Matches');
  await sleep(500);
  const lgm = await legend();
  check('mobile: ranked legend fits on the visible map', lgm.shown && lgm.inView, lgm);
  await shot('7-mobile-ranked');

  // ---------- 4: starting point → camera centers on it; ranking never moves it; real route from it ----------
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL_ });
  await waitFor('!!window.vibentaDiscovery&&!!window.vibentaOutingProfiles&&!!window.map&&map.loaded()');
  await sleep(1200);
  // The real Starting point field on the first panel step (offline MBTA/landmark suggestions).
  await js("(()=>{const t=[...document.querySelectorAll('.vb-discovery .vb-trigger-location')].find(b=>b.offsetParent!==null);window.__originControl=t.closest('.vb-control');t.click();})()");
  await js("(()=>{const i=window.__originControl.querySelector('.vb-search-input');i.focus();i.value='South Station';i.dispatchEvent(new Event('input',{bubbles:true}))})()");
  await waitFor("!!window.__originControl.querySelector('.vb-suggestion')");
  await js("(()=>{const o=window.__originControl.querySelector('.vb-suggestion');o.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));o.click();})()");
  await waitFor('!!vibentaDiscovery.getPreferences().origin');
  const origin = await js('(o=>({label:o.label,location:{lat:o.location.lat,lng:o.location.lng}}))(vibentaDiscovery.getPreferences().origin)');
  await settle();
  await js("void map.jumpTo({center:[-71.1097,42.3736],zoom:13})"); // look somewhere else first (Cambridge)
  await settle();
  await startQuiz('Late-night bites with friends, lively but not loud');
  await answerUntilResults();
  await showMatches();
  await settle();
  const camO = await camera();
  check('with a starting point, results center on it at a browsing zoom (not on the results)', Math.abs(camO.lng - origin.location.lng) < 1e-4 && Math.abs(camO.lat - origin.location.lat) < 1e-4 && camO.zoom === 14, { origin: origin.label, camera: camO });
  await clickText('Rank My Matches');
  await sleep(400);
  check('ranking with a starting point still does not move the camera', sameCamera(await camera(), camO));
  await shot('8-ranked-around-starting-point');
  const last = searches.at(-1);
  const firstIdx = matchPositions(last.results.map((r) => r.score)).indexOf(1);
  const clickTop = await clickPin(firstIdx, last.results[firstIdx].location);
  await waitFor(`document.querySelector('[id^=vb-popup-title-]')?.textContent===${JSON.stringify(last.results[firstIdx].name)}`, 40);
  await js("document.querySelector('.vb-popup-navigate').click()");
  await waitFor("vibentaTrip.getState().route.kind==='done'", 200).catch(() => {});
  const route = await js("(()=>{const s=vibentaTrip.getState();return {open:s.navigationOpen,from:s.from?.label??null,to:s.to?.label??null,route:s.route.kind,status:s.route.result?.status??null,legs:s.route.result?.route?.option?.legs?.length??0}})()");
  check('Navigate from the #1 match plans a real route from the starting point', route.open && route.to === last.results[firstIdx].name && route.route === 'done' && route.status === 'ok' && route.legs > 0, { ...route, realClick: clickTop.real });
  await shot('9-route-from-top-match');
  await brandScan('route planner');
} catch (e) {
  const state = await js("(()=>{const p=vibentaOutingProfiles.getSnapshot();return p&&{phase:p.phase,answers:p.history.length,generation:p.generation,embedding:p.embedding.status,notice:p.notice,completion:p.completion,action:document.querySelector('.vb-quiz-results-action')?.textContent??null}})()").catch(() => null);
  check('script completed', false, { error: e.message, state, apiCalls });
} finally {
  const failed = checks.filter((c) => !c.ok);
  check('no page errors', errors.filter((e) => !/TEST FIXTURE/.test(e)).length === 0, errors.slice(0, 5));
  writeFileSync(`${OUT}/report.json`, JSON.stringify({ url: URL_, checks, errors, apiCalls, searches: searches.map((s) => ({ results: s.results?.length ?? null, fixture: !!s.fixture })) }, null, 2));
  console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} checks passed${failed.length ? '' : ''}. Screenshots + report: ${OUT}`);
  ws.close(); chrome.kill();
  if (chrome.exitCode === null) await Promise.race([new Promise((r) => chrome.once('exit', r)), sleep(5000)]);
  rmSync(PROFILE, { recursive: true, force: true });
  process.exit(checks.every((c) => c.ok) ? 0 : 1);
}
