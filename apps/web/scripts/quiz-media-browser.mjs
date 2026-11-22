// Cross-vibe acceptance harness for vibenta-media/1 (Node 26 + Google Chrome, headless, CDP).
// Runs the REAL app: real /api/vibe (Gemini if GEMINI_API_KEY is configured, otherwise the
// labeled local director), real server MiniLM, real Wikimedia Commons images, real YouTube player.
// Nothing here is mocked; the report records which source produced each question.
// Usage: VIBENTA_QA_URL=http://localhost:5181/ node scripts/quiz-media-browser.mjs
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = process.env.VIBENTA_QA_OUTPUT ?? '/private/tmp/vibenta-media-qa'; mkdirSync(OUT, { recursive: true });
const URL_ = process.env.VIBENTA_QA_URL ?? 'http://localhost:5181/';
const WIDTH = Number(process.env.VIBENTA_QA_WIDTH ?? 1440), PORT = 9391, MAX_ANSWERS = Number(process.env.VIBENTA_QA_ANSWERS ?? 6);
const RUNS = [
  ['Need a fun night.', 'first'], ['Need a fun night.', 'last'],
  ['Haunted but somehow romantic.', 'first'], ['Haunted but somehow romantic.', 'last'],
  ["Coffee. Brain's fried.", 'first'], ['I want something like a 2000s house party.', 'first'], ["I want to feel like I'm in Blade Runner.", 'first'],
  ['Something low-key with one good surprise.', 'first'], ['Make me forget this week.', 'first'], ['Somewhere I can think.', 'first'],
  ['I want something that feels nostalgic but exciting.', 'first'], ["I don't know what I want.", 'first'], ['Need a fun night.', 'mixed'],
].filter((_, i) => !process.env.VIBENTA_QA_ONLY || process.env.VIBENTA_QA_ONLY.split(',').includes(String(i)));

const chrome = spawn(process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${OUT}/chrome-${Date.now()}`, '--no-first-run', '--no-default-browser-check', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function targets() { for (let i = 0; i < 240; i++) { try { const t = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (t.some((x) => x.type === 'page')) return t; } catch { /* starting */ } await sleep(250); } throw Error('Chrome did not start'); }
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl); let id = 0; const pending = new Map(), errors = [], listeners = [];
  ws.onmessage = (m) => { const a = JSON.parse(m.data); if (a.id) { pending.get(a.id)?.(a); pending.delete(a.id); } for (const l of listeners) try { l(a); } catch { /* diagnostics only */ } if (a.method === 'Runtime.exceptionThrown') errors.push(a.params.exceptionDetails.exception?.description ?? a.params.exceptionDetails.text); };
  // Every DevTools call is bounded: a hung page or closed target can never stall the harness forever.
  const send = (method, params = {}, ms = 30000) => new Promise((resolve, reject) => { const n = ++id; const timer = setTimeout(() => { pending.delete(n); reject(Error(`CDP ${method} timed out after ${ms}ms`)); }, ms); pending.set(n, (a) => { clearTimeout(timer); a.error ? reject(Error(a.error.message)) : resolve(a.result); }); ws.send(JSON.stringify({ id: n, method, params })); });
  const js = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
  return { ready: new Promise((r) => { ws.onopen = r; }), send, js, errors, listeners, close: () => ws.close() };
}
const page = connect((await targets()).find((t) => t.type === 'page').webSocketDebuggerUrl); await page.ready;
const { send, js } = page;
const waitFor = async (expr, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await js(expr)) return true; } catch { /* not yet */ } await sleep(250); } return false; };
const shot = async (name) => { const c = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); writeFileSync(`${OUT}/${name}.png`, Buffer.from(c.data, 'base64')); return `${OUT}/${name}.png`; };
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Emulation.setFocusEmulationEnabled', { enabled: true });
// ---- Diagnostics: navigations, context resets, console errors and every /api/vibe request with timing ----
const T0 = Date.now(); let diag = []; const apiReq = new Map();
const note = (kind, detail) => diag.push({ t: Date.now() - T0, kind, ...detail });
page.listeners.push((a) => {
  const p = a.params;
  if (a.method === 'Page.frameNavigated' && !p.frame.parentId) note('navigated', { url: p.frame.url });
  else if (a.method === 'Runtime.executionContextsCleared') note('context-cleared', {});
  else if (a.method === 'Runtime.consoleAPICalled' && (p.type === 'error' || p.type === 'warning')) note(`console-${p.type}`, { text: p.args.map((x) => x.value ?? x.description).join(' ').slice(0, 300) });
  else if (a.method === 'Runtime.exceptionThrown') note('exception', { text: (p.exceptionDetails.exception?.description ?? p.exceptionDetails.text ?? '').slice(0, 300) });
  else if (a.method === 'Network.requestWillBeSent' && p.request.url.includes('/api/vibe/')) apiReq.set(p.requestId, { url: p.request.url.replace(/^.*\/api\/vibe\//, ''), start: Date.now() });
  else if (a.method === 'Network.responseReceived' && apiReq.has(p.requestId)) apiReq.get(p.requestId).status = p.response.status;
  else if ((a.method === 'Network.loadingFinished' || a.method === 'Network.loadingFailed') && apiReq.has(p.requestId)) { const r = apiReq.get(p.requestId); apiReq.delete(p.requestId); note('api', { endpoint: r.url, status: r.status ?? null, ms: Date.now() - r.start, ...(a.method === 'Network.loadingFailed' ? { failed: p.errorText, canceled: p.canceled } : {}) }); }
});
/** State + DOM dump used whenever a step fails. */
async function failureDump(name) {
  const state = await js(`(()=>{const P=window.vibentaOutingProfiles;const p=P?.getSnapshot();const q=p?.question;return {hasGlobals:!!P,phase:p?.phase,generation:p?.generation,notice:p?.notice,history:p?.history.length,format:q?.presentation?.format??null,questionId:q?.id,embedding:p?.embedding.status,quizHidden:!!document.querySelector('.vb-live-quiz')?.closest('[hidden]'),stage:document.querySelector('.vb-media-stage')?.dataset.format??null,controls:[...document.querySelectorAll('.vb-live-quiz button,[data-reveal],.vb-media-card,.vb-media-freetext')].slice(0,14).map(e=>e.dataset.reveal?'reveal:'+e.dataset.reveal:e.className.split(' ')[0]+':'+(e.textContent||'').trim().slice(0,30))}})()`).catch((e) => ({ dumpError: String(e) }));
  return { state, screenshot: await shot(`FAIL-${name}`).catch(() => null), recentEvents: diag.slice(-12) };
}
/** Bounded click: waits for the element, reports what was missing instead of a null dereference. */
async function clickWhenReady(selector, pick = 'first', ms = 8000) {
  const ok = await waitFor(`document.querySelectorAll(${JSON.stringify(selector)}).length>0`, ms);
  if (!ok) throw Error(`Missing control ${selector}`);
  return js(`(()=>{const all=[...document.querySelectorAll(${JSON.stringify(selector)})];const b=all[${pick === 'last' ? 'all.length-1' : '0'}];b.click();return b.dataset.option??b.querySelector('strong')?.textContent??b.textContent})()`);
}
await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: WIDTH <= 420 ? 844 : 1000, deviceScaleFactor: 1, mobile: WIDTH <= 420 });

const status = await (await fetch(new URL('/api/vibe/status', URL_))).json();
const report = { generatedAt: new Date().toISOString(), url: URL_, geminiConfigured: status.geminiConfigured, runs: [], playback: null };
const save = () => writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
// Global watchdog: whatever happens, partial results are saved and the harness exits.
const WATCHDOG_MS = Number(process.env.VIBENTA_QA_TOTAL_MS ?? 45 * 60000);
setTimeout(() => { report.aborted = `watchdog after ${WATCHDOG_MS}ms`; save(); console.log('WATCHDOG: saved partial report and exiting'); try { chrome.kill(); } catch { /* already gone */ } process.exit(3); }, WATCHDOG_MS).unref();

/** Real playback check inside YouTube's own player frame (an out-of-process iframe target). */
async function verifyPlayback(videoId) {
  const rect = await js(`(()=>{const f=document.querySelector('iframe[data-video-id="${videoId}"]');f.scrollIntoView({block:'center'});const r=f.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height}})()`);
  await sleep(4000);
  // A trusted pointer event from CDP is a genuine user gesture for the autoplay policy.
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  await sleep(7000);
  const frame = (await targets()).find((t) => t.type === 'iframe' && t.url.includes(`/embed/${videoId}`));
  if (!frame) return { videoId, ok: false, reason: 'No YouTube iframe target found', rect };
  const f = connect(frame.webSocketDebuggerUrl); await Promise.race([f.ready, sleep(10000)]);
  const state = await f.js(`(()=>{const v=document.querySelector('video');const err=document.querySelector('.ytp-error')?.innerText??null;return v?{currentTime:v.currentTime,paused:v.paused,readyState:v.readyState,muted:v.muted,volume:v.volume,duration:v.duration,error:err,title:document.title}:{error:err??'no video element',title:document.title}})()`);
  f.close();
  return { videoId, ok: !!state && !state.error && state.currentTime > 1 && !state.paused, ...state, playerSize: `${Math.round(rect.w)}x${Math.round(rect.h)}` };
}

async function snapshot() {
  return js(`(()=>{const p=window.vibentaOutingProfiles?.getSnapshot();const r=window.vibentaOutingRanking;const s=window.vibentaScene?.session.getState?.();
    const q=p?.question;const pr=q?.presentation;const stage=document.querySelector('.vb-media-stage');
    const imgs=[...document.querySelectorAll('.vb-live-quiz img[data-asset-id]')].map(i=>({id:i.dataset.assetId,loaded:i.complete&&i.naturalWidth>0,visible:i.getBoundingClientRect().width>0}));
    return {phase:p?.phase,generation:p?.generation,notice:p?.notice,history:p?.history.length,summary:p?.vibe_so_far,qualifiers:p?.qualifiers,
      question:q?{id:q.id,prompt:q.prompt,family:q.family,topic:q.topic,cultural:q.cultural,options:q.options.map(o=>o.id+': '+o.label+' — '+o.description),
        presentation:pr?{format:pr.format,voice:pr.voice,mood:pr.mood,source:pr.source,optionImages:pr.optionImages,stageImageId:pr.stageImageId,blend:pr.blend,trackId:pr.trackId,referenceIds:pr.referenceIds,referenceNote:pr.referenceNote,design:pr.design}:null}:null,
      sceneStep:document.querySelector('[data-scene-step]')?.dataset.sceneStep??null,
      stageVisible:!!stage&&stage.getBoundingClientRect().height>0, images:imgs, quizMood:document.querySelector('.vb-live-quiz')?.dataset.mood??null,
      embedding:p?.embedding.status, scene:s?{hash:s.hash,keys:Object.keys(s).slice(0,12),presets:JSON.stringify(s.intent?.presets??s.presets??s.mix??null)}:null,
      ranking:r?{status:r.status,reason:r.reason??null,provenance:r.provenance,top:r.all.slice(0,5).map(x=>x.id+':'+x.score.toFixed(3))}:null}})()`);
}

async function startRun(text) {
  await send('Page.navigate', { url: URL_ });
  if (!await waitFor('!!window.vibentaDiscovery&&!!window.vibentaOutingProfiles', 60000)) throw Error('App did not load');
  if (WIDTH <= 420) await js(`document.querySelector('.vb-summary-btn')?.click()`);
  await js(`document.querySelector('.vb-continue-btn')?.click()`);
  await waitFor(`!!document.querySelector('.vb-vibe-story')`);
  await js(`{const t=document.querySelector('.vb-vibe-story');t.value=${JSON.stringify(text)};t.dispatchEvent(new Event('input',{bubbles:true}));(document.querySelector('.vb-begin-quiz')&&document.querySelector('.vb-begin-quiz').offsetParent?document.querySelector('.vb-begin-quiz'):document.querySelector('.vb-launch-quiz')).click();}`);
}

let playbackDone = false;
for (const [text, path] of RUNS) {
  const run = { input: text, path, steps: [], errors: [] };
  report.runs.push(run); diag = []; const sessionStart = Date.now();
  const SESSION_MS = Number(process.env.VIBENTA_QA_SESSION_MS ?? 360000), QUESTION_MS = Number(process.env.VIBENTA_QA_QUESTION_MS ?? 60000);
  try {
    await startRun(text);
    for (let step = 0; step < MAX_ANSWERS; step++) {
      if (Date.now() - sessionStart > SESSION_MS) { run.errors.push(`Session exceeded ${SESSION_MS}ms`); run.failure = await failureDump(`${slug(text)}-${path}-session`); break; }
      const ok = await waitFor(`(()=>{const p=window.vibentaOutingProfiles?.getSnapshot();return !!p&&(p.phase==='question'&&!!p.question||p.phase==='results')})()`, QUESTION_MS);
      if (!ok) { run.errors.push(`Timed out after ${QUESTION_MS}ms waiting for question ${step + 1}`); run.failure = await failureDump(`${slug(text)}-${path}-q${step + 1}`); break; }
      await sleep(1500); // let images decode and the scene settle
      await waitFor(`[...document.querySelectorAll('.vb-live-quiz img[data-asset-id]')].every(i=>i.complete)`, 15000);
      const snap = await snapshot();
      snap.screenshot = await shot(`${WIDTH}-${slug(text)}-${path}-${step + 1}`);
      snap.horizontalOverflow = await js('document.documentElement.scrollWidth>innerWidth');
      run.steps.push(snap);
      if (snap.phase === 'results') {
        // Session B's authored B2 commit shows matches; continue into the dynamic quiz like a user would.
        const cont = await js(`(()=>{const b=[...document.querySelectorAll('.vb-live-quiz button')].find(b=>b.textContent==='Continue Refining');if(b){b.click();return true}return false})()`);
        if (!cont) break; continue;
      }
      const pr = snap.question.presentation;
      if (pr?.format === 'listening' && !playbackDone) {
        await js(`document.querySelector('[data-load-player]').click()`);
        await waitFor(`!!document.querySelector('iframe[data-video-id]')`);
        const videoId = await js(`document.querySelector('iframe[data-video-id]').dataset.videoId`);
        report.playback = { input: text, trackId: pr.trackId, ...(await verifyPlayback(videoId)), screenshot: await shot(`${slug(text)}-playback`) };
        playbackDone = report.playback.ok;
      }
      if (path === 'mixed' && step === 1) {
        // Mid-session contradiction: after choosing the loud option, the user corrects in their own words.
        const said = 'Actually, somewhere quiet where we can talk. Not loud.';
        await js(`{const t=document.querySelector('.vb-quiz-correction');t.value=${JSON.stringify(said)};t.dispatchEvent(new Event('input',{bubbles:true}));[...document.querySelectorAll('.vb-live-quiz button')].find(b=>b.textContent==='Use my words').click();}`);
        snap.answered = `correction: ${said}`;
      } else if (snap.sceneStep) {
        // Session B storyboard stage (authored coffee prototype).
        const opt = await js(`(()=>{const all=[...document.querySelectorAll('[data-inspect]')];return all[${path === 'first' ? 0 : -1}===-1?all.length-1:0]?.dataset.inspect})()`);
        await js(`document.querySelector('[data-inspect="${opt}"]').click()`); await sleep(200);
        await js(`document.querySelector('[data-commit="${opt}"]').click()`);
      } else if (pr?.format === 'free_text') {
        const answer = { first: 'Somewhere with pinball, cheap snacks and a window onto the street', last: 'A candle on the table and nobody in a hurry', mixed: 'Honestly I want to dance, but only for an hour' }[path];
        await js(`{const t=document.querySelector('.vb-media-freetext');t.value=${JSON.stringify(answer)};t.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.vb-media-send').click();}`);
        snap.answered = `text: ${answer}`;
      } else {
        const sel = pr?.format === 'image_choice' ? '.vb-media-card[data-option]' : '.vb-quiz-answer';
        if (pr?.format === 'image_blend') await js(`{const s=document.querySelector('.vb-media-slider');s.value=${path === 'first' ? 15 : 85};s.dispatchEvent(new Event('input',{bubbles:true}));}`);
        if (pr?.format === 'image_reveal') { await clickWhenReady('[data-reveal="wider"]:not([disabled])'); await sleep(300); await clickWhenReady('[data-reveal="wider"]'); }
        snap.answered = await clickWhenReady(sel, path === 'last' ? 'last' : 'first');
      }
      await waitFor(`window.vibentaOutingProfiles?.getSnapshot()?.history.length>${snap.history}`, 10000);
    }
    run.final = await snapshot();
    run.finalScreenshot = await shot(`${slug(text)}-${path}-final`);
  } catch (e) { run.errors.push(String(e)); run.failure = await failureDump(`${slug(text)}-${path}-error`); }
  run.pageErrors = page.errors.splice(0); run.diagnostics = diag.slice();
  run.apiSummary = diag.filter((d) => d.kind === 'api').map((d) => `${d.endpoint}:${d.status ?? d.failed}:${d.ms}ms`);
  save(); // preserve every completed session immediately
  console.log(`${text} [${path}]: ${run.steps.map((s) => s.sceneStep ? `sessionB-${s.sceneStep}` : s.question?.presentation ? `${s.question.presentation.source}:${s.question.presentation.format}` : s.phase).join(' → ')}${run.errors.length ? ` ERR ${run.errors.join('; ')}` : ''}`);
}
// ---- Behavior QA (Priority 5) -------------------------------------------------------------
const checks = []; report.behavior = checks;
const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail }); console.log(ok ? 'PASS' : 'FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 220)); };
if (!process.env.VIBENTA_QA_SKIP_BEHAVIOR) try {
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  // 1. Music never plays without a user gesture.
  await startRun('Need a fun night.');
  await waitFor(`vibentaOutingProfiles.getSnapshot()?.phase==='question'`, 45000);
  // With live Gemini the opener is not fixed: advance (up to 3 answers) until a listening question appears.
  let fmt = await js(`vibentaOutingProfiles.getSnapshot().question.presentation?.format`);
  for (let i = 0; fmt !== 'listening' && i < 3; i++) {
    await js(`(document.querySelector('.vb-media-card')??document.querySelector('.vb-quiz-answer')).click()`);
    await waitFor(`vibentaOutingProfiles.getSnapshot()?.history.length===${i + 1}&&vibentaOutingProfiles.getSnapshot()?.phase==='question'`, 45000);
    fmt = await js(`vibentaOutingProfiles.getSnapshot().question.presentation?.format`);
  }
  if (fmt === 'listening') {
    check('player is not loaded before the user asks', await js(`!document.querySelector('iframe')&&!!document.querySelector('[data-load-player]')`));
    await js(`document.querySelector('[data-load-player]').click()`); await waitFor(`!!document.querySelector('iframe[data-video-id]')`);
    const src = await js(`document.querySelector('iframe[data-video-id]').src`);
    check('embed URL never requests autoplay', !/autoplay=1/.test(src), src);
    await sleep(6000);
    const vid = await js(`document.querySelector('iframe[data-video-id]').dataset.videoId`);
    const frame = (await targets()).find((t) => t.type === 'iframe' && t.url.includes(`/embed/${vid}`));
    if (frame) { const f = connect(frame.webSocketDebuggerUrl); await f.ready; const st = await f.js(`(()=>{const v=document.querySelector('video');return v?{t:v.currentTime,paused:v.paused}:null})()`); f.close(); check('loaded player stays paused until the user presses play', !st || (st.paused && st.t === 0), st); }
    check('official-upload credit visible beside the player', await js(`(()=>{const c=document.querySelector('.vb-media-listen .vb-media-credit');return !!c&&c.getBoundingClientRect().height>0&&/Official upload by/.test(c.textContent)})()`));
  } else check('fun-night opener is a listening question (needed for the playback checks)', false, fmt);
  const h0 = await js(`vibentaOutingProfiles.getSnapshot().history.length`);
  await js(`(document.querySelector('.vb-quiz-answer')??document.querySelector('.vb-media-card')).click()`);
  await waitFor(`vibentaOutingProfiles.getSnapshot()?.history.length===${h0 + 1}&&vibentaOutingProfiles.getSnapshot()?.phase==='question'`, 45000);
  // 2. Credits on every visible image.
  for (let i = 0; i < 3; i++) {
    const hasImages = await js(`document.querySelectorAll('.vb-media-stage img[data-asset-id]').length`);
    if (!hasImages && await js(`!!document.querySelector('.vb-media-freetext')`)) { await js(`{const t=document.querySelector('.vb-media-freetext');t.value='a window seat';t.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.vb-media-send').click();}`); await waitFor(`vibentaOutingProfiles.getSnapshot()?.history.length===${h0 + 2 + i}&&vibentaOutingProfiles.getSnapshot()?.phase==='question'`, 45000); continue; }
    if (hasImages) { check('every image shows a visible credit with license and source', await js(`[...document.querySelectorAll('.vb-media-stage .vb-media-credit')].length>0&&[...document.querySelectorAll('.vb-media-stage .vb-media-credit')].every(c=>c.getBoundingClientRect().height>0&&/(Wikimedia Commons|Original storyboard)/.test(c.textContent))`)); check('every image has alt text or an explicit decorative alt', await js(`[...document.querySelectorAll('.vb-media-stage img')].every(i=>i.hasAttribute('alt'))`)); break; }
    await js(`(document.querySelector('.vb-media-card')??document.querySelector('.vb-quiz-answer')).click()`);
    await waitFor(`vibentaOutingProfiles.getSnapshot()?.history.length===${h0 + 2 + i}&&vibentaOutingProfiles.getSnapshot()?.phase==='question'`, 45000);
  }
  // 3. A long half-typed answer survives the background embedding update and keeps focus.
  const long = 'I want somewhere that feels like the last hour of a good party but quieter, '.repeat(6).slice(0, 480);
  const hBefore = await js(`vibentaOutingProfiles.getSnapshot().history.length`);
  await js(`(document.querySelector('.vb-media-card')??document.querySelector('.vb-quiz-answer')).click()`);
  await waitFor(`vibentaOutingProfiles.getSnapshot()?.history.length===${hBefore + 1}&&vibentaOutingProfiles.getSnapshot()?.phase==='question'`, 45000);
  const statusAtType = await js(`vibentaOutingProfiles.getSnapshot().embedding.status`);
  await js(`{const t=document.querySelector('.vb-quiz-correction');t.focus();t.value=${JSON.stringify(long)};t.dispatchEvent(new Event('input',{bubbles:true}));}`);
  await waitFor(`vibentaOutingProfiles.getSnapshot()?.embedding.status==='ready'`, 60000);
  // Guarantee a background update lands while the draft is in the box: replay the same snapshot through the
  // real publisher with embedding pending → ready (the exact path MiniLM status updates take).
  const updates = await js(`(()=>{const p=vibentaOutingProfiles.getSnapshot();vibentaOutingProfiles.publish({...p,embedding:{...p.embedding,status:'pending'}});vibentaOutingProfiles.publish(p);return document.querySelector('.vb-quiz-semantic-status')?.textContent})()`);
  await sleep(500);
  check('long draft survives background embedding updates', await js(`document.querySelector('.vb-quiz-correction').value===${JSON.stringify(long)}`), { statusAtType, statusAfterForcedUpdates: updates, chars: long.length });
  check('focus stays in the draft after the background update', await js(`document.activeElement?.classList.contains('vb-quiz-correction')`));
  // 4. Correction in own words, then undo by editing history.
  await js(`[...document.querySelectorAll('.vb-live-quiz button')].find(b=>b.textContent==='Use my words').click()`);
  await waitFor(`vibentaOutingProfiles.getSnapshot()?.history.at(-1)?.response.kind==='correction'&&vibentaOutingProfiles.getSnapshot()?.phase==='question'`, 45000);
  check('correction recorded as the user’s own words', await js(`vibentaOutingProfiles.getSnapshot().history.at(-1).response.text.startsWith('I want somewhere')`));
  const afterCorrection = await js(`(()=>{const q=vibentaOutingProfiles.getSnapshot().question;return {prompt:q.prompt,known:q.presentation?.design.known,source:q.presentation?.source}})()`);
  check('next question responds to the correction', /I want somewhere|last hour|party|quieter|correct/i.test(`${afterCorrection.prompt} ${afterCorrection.known}`), afterCorrection);
  const before = await js(`vibentaOutingProfiles.getSnapshot().history.length`);
  await js(`document.querySelector('.vb-quiz-history').open=true;document.querySelector('.vb-quiz-history button').click()`);
  await waitFor(`!!document.querySelector('.vb-quiz-answer,.vb-media-card,[data-load-player],.vb-media-freetext')`);
  await js(`(document.querySelector('.vb-quiz-answer:last-of-type')??document.querySelector('.vb-media-card')).click()`);
  await waitFor(`vibentaOutingProfiles.getSnapshot()?.history.length===1&&vibentaOutingProfiles.getSnapshot()?.phase==='question'`, 45000);
  check('editing answer 1 undoes later answers and the correction', await js(`vibentaOutingProfiles.getSnapshot().history.length===1&&!vibentaOutingProfiles.getSnapshot().evidence.some(e=>e.source==='correction')`), { before });
  // 5. Accessibility and reduced motion.
  check('new question takes focus on its prompt', await js(`document.activeElement?.classList.contains('vb-quiz-prompt')`));
  check('every quiz button has an accessible name', await js(`[...document.querySelectorAll('.vb-live-quiz button')].every(b=>(b.getAttribute('aria-label')||b.textContent).trim().length>0)`));
  check('reduced motion disables quiz transitions', await js(`(()=>{const q=document.querySelector('.vb-live-quiz');return getComputedStyle(q).transitionDuration.split(',').every(d=>parseFloat(d)===0)})()`));
  check('controls meet the 44px minimum target', await js(`[...document.querySelectorAll('.vb-scene-control,.vb-media-slider,.vb-media-card,.vb-quiz-answer')].every(b=>b.getBoundingClientRect().height>=44||b.offsetParent===null)`));
} catch (e) { check('behavior QA completed', false, String(e)); }
// Only sessions that actually ran (≥4 committed answers, no error) say anything about the city they produced.
const finals = report.runs.filter((r) => !r.errors.length && (r.final?.history ?? 0) >= 4).map((r) => JSON.parse(r.final?.scene?.presets ?? '[]')[0]?.id).filter(Boolean);
report.finalPresetCounts = finals.reduce((m, id) => ({ ...m, [id]: (m[id] ?? 0) + 1 }), {});
check('no single preset dominates final city scenes', Math.max(...Object.values(report.finalPresetCounts)) <= Math.ceil(finals.length / 2), report.finalPresetCounts);
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
console.log('playback:', JSON.stringify(report.playback));
console.log(`report: ${OUT}/report.json`);
page.close(); chrome.kill();
process.exit(0);
