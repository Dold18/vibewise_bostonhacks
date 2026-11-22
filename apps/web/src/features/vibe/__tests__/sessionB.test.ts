import { describe,it,expect,vi,beforeAll,afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { sessionBQuestion,scenePresentation,selectedCoffeeScene,setAuthoredSessionB } from '../sessionB';
// The authored opener is retired in the product; these tests keep the dormant module correct.
beforeAll(()=>setAuthoredSessionB(true));afterAll(()=>setAuthoredSessionB(false));
import { validContext,validQuestion,validateGeneration } from '../validation';
import { createLiveVibeSession,replay } from '../liveEngine';
import { createProfilePublisher } from '../publisher';
import { subscribeScene,rankCandidates } from '../adapters';
import { fallbackQuestion } from '../families';
import { evidenceFrom } from '../evidence';
import { MODEL_KEY,type GenerationContext,type GenerationResult,type GenerationProvider } from '../profile';
import { createGeminiGenerator } from '../../../../server/vibeGemini';
const context=():GenerationContext=>({sessionId:'SESSION-B-FIXTURE',version:1,originalInput:{text:"Coffee. Brain's fried.",imageCount:0,imageProcessing:'not_sent'},vibe_so_far:"Coffee. Brain's fried.",history:[],evidence:[],qualifiers:[]});
const result=(c:GenerationContext):GenerationResult=>({vibe_so_far:'TEST FIXTURE contextual summary. '+evidenceFrom(c.originalInput.text,c.history).map(e=>e.text).join('. '),nextQuestion:fallbackQuestion(c),qualifiers:[],continuation:'refine',reason:'TEST FIXTURE next unresolved detail'});
const vector=Array.from({length:384},(_,i)=>i===0?1:0); // Synthetic vector: NEVER a real catalog integration.
const embedder={embed:async()=>({modelKey:MODEL_KEY,vector})};
const ready=async(s:ReturnType<typeof createLiveVibeSession>)=>vi.waitFor(()=>expect(s.getSnapshot()?.generation).not.toBe('pending'));
const online:GenerationProvider={generate:async c=>result(c)};
const offline:GenerationProvider={generate:async()=>{throw Error('TEST FIXTURE Gemini unavailable');}};

describe('visible quiz startup without a responding Gemini service',()=>{
 it('makes authored B1 and B2 interactive immediately even if generation never responds',()=>{
  const stalled:GenerationProvider={generate:()=>new Promise<GenerationResult>(()=>{})};
  const session=createLiveVibeSession(stalled,embedder);
  session.start(context().originalInput.text,0,'instant-scene');
  expect(session.getSnapshot()?.phase).toBe('question');
  expect(session.getSnapshot()?.question?.id).toBe('session-b/v1/B1');
  session.answer({kind:'choice',optionId:'bakery'});
  expect(session.getSnapshot()?.phase).toBe('question');
  expect(session.getSnapshot()?.question?.id).toBe('session-b/v1/B2/bakery');
  session.showMatches();
  expect(session.getSnapshot()?.phase).toBe('results');
  session.destroy();
 });
 it('keeps generic questions in generation state until a provider responds',()=>{
  const stalled:GenerationProvider={generate:()=>new Promise<GenerationResult>(()=>{})};
  const session=createLiveVibeSession(stalled,embedder);
  session.start('A spontaneous city-night adventure',0,'generic-scene');
  expect(session.getSnapshot()?.phase).toBe('generating');
  session.destroy();
 });
});

describe('bounded authored scene identity, preserving the existing wire contract',()=>{
 it('only activates for the starting brief and keeps the scene in ordinary history',()=>{
  const c=context(),q=sessionBQuestion(c)!;expect(validQuestion(q)).toBe(true);
  expect(sessionBQuestion({...c,originalInput:{...c.originalInput,text:'Coffee and a loud party'}})).toBeUndefined();
  c.history=[{id:'a',question:q,response:{kind:'choice',optionId:'nook'}}];
  expect(validContext(c)).toBe(true);expect(selectedCoffeeScene(c)).toBe('nook');
  expect(scenePresentation(sessionBQuestion(c)!)?.scene).toBe('nook');
  expect(scenePresentation(sessionBQuestion(c)!)?.reference).toBeUndefined();
 });
 it('rejects forged scene prose and a continuation for the wrong branch',()=>{
  const c=context(),q=sessionBQuestion(c)!;
  expect(validQuestion({...q,prompt:'Invent a different preference under the same registered identity'})).toBe(false);
  const bakery={...c,history:[{id:'a',question:q,response:{kind:'choice' as const,optionId:'bakery'}}]};
  const nook={...bakery,history:[{...bakery.history[0],response:{kind:'choice' as const,optionId:'nook'}}]};
  expect(()=>validateGeneration({...result(c),nextQuestion:sessionBQuestion(nook)},bakery)).toThrow('continue');
 });
 it('accepts equivalent JSON field ordering without extending the wire schema',()=>{
  const q=sessionBQuestion(context())!;
  const reordered={...q,options:q.options.map(o=>({preference:o.preference,description:o.description,label:o.label,id:o.id}))};
  expect(validQuestion(reordered)).toBe(true);expect(scenePresentation(reordered)?.step).toBe('B1');
 });
 it('requires production manifest entries for each authored frame with matching content hashes',()=>{
  const path=new URL('../../../../public/quiz-scenes/session-b-v1/manifest.json',import.meta.url);
  const manifest=JSON.parse(readFileSync(path,'utf8'));
  expect(manifest.sensoryAcceptance).toContain('pending');
  const c=context(),q=sessionBQuestion(c)!;
  const presentations=[scenePresentation(q)!,...['bakery','nook'].map(scene=>scenePresentation(sessionBQuestion({...c,history:[{id:'a',question:q,response:{kind:'choice',optionId:scene}}]})!)!)];
  for(const presentation of presentations)for(const option of presentation.options)for(const frame of option.frames){
   const record=manifest.assets.find((a:{assetId:string})=>a.assetId===frame.assetId);expect(record).toBeDefined();
   const file=new URL('../../../../public'+frame.src,import.meta.url);const data=readFileSync(file);
   expect(createHash('sha256').update(data).digest('hex')).toBe(record.sha256);expect(frame.alt).toContain('Original storyboard');
  }
 });
 it('sends the scene plan in the same single Gemini operation, preserving a contextual summary',async()=>{
  const c=context();const f=vi.fn(async()=>new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(result(c))}]}}]})));
  const generated=await createGeminiGenerator({apiKey:'TEST-FIXTURE',fetchImpl:f as typeof fetch}).generate(c,new AbortController().signal);
  expect(f).toHaveBeenCalledOnce();expect(generated.nextQuestion?.id).toBe('session-b/v1/B1');
  expect(generated.vibe_so_far).toContain('TEST FIXTURE contextual');
  const [,init]=f.mock.calls[0] as unknown as [string,RequestInit];
  expect(JSON.parse(String(init.body)).contents[0].parts[0].text).toContain('authoredSceneQuestion');
 });
});

for(const [mode,generator] of [['online-fixture',online],['offline',offline]] as const)describe(`B1 → B2 with ${mode} (no real catalog assertions)`,()=>{
 for(const scene of ['bakery','nook'] as const)for(const decision of ['stay','leave'] as const)it(`${scene} → ${decision} updates the actual profile/publisher and uses matching imagery`,async()=>{
  const texts:string[]=[],publisher=createProfilePublisher(),published:number[]=[],sceneVersions:number[]=[];
  publisher.subscribe(p=>{if(p)published.push(p.version);});const off=subscribeScene(publisher,p=>{if(p)sceneVersions.push(p.profile.version);});
  const s=createLiveVibeSession(generator,{embed:async text=>{texts.push(text);return {modelKey:MODEL_KEY,vector};}},publisher);
  s.start(context().originalInput.text,0,'session-b');await ready(s);
  const initial=s.getSnapshot()!,q=initial.question!;
  // Reading the presentation and looking at any frame has no engine side effects.
  const presentation=scenePresentation(q)!;expect(presentation.step).toBe('B1');
  for(const option of presentation.options)expect(option.frames.length).toBeGreaterThan(0);
  expect(s.getSnapshot()).toBe(initial);expect(initial.history).toHaveLength(0);
  s.answer({kind:'choice',optionId:scene});await ready(s);
  const b2=s.getSnapshot()!;expect(b2.question?.id).toBe(`session-b/v1/B2/${scene}`);
  expect(selectedCoffeeScene(b2)).toBe(scene);expect(b2.evidence.filter(e=>e.source==='answer')).toHaveLength(1);
  const continuation=scenePresentation(b2.question!)!;
  expect(continuation.options.every(o=>o.scene===scene&&o.frames.every(f=>f.assetId.includes(scene)))).toBe(true);
  expect(!!continuation.reference).toBe(scene==='bakery');
  s.answer({kind:'choice',optionId:`${scene}-${decision}`});s.showMatches();await ready(s);
  const final=s.getSnapshot()!;expect(final.schemaVersion).toBe('1.0.0');expect(final.history).toHaveLength(2);
  expect(final.evidence.filter(e=>e.source==='answer')).toHaveLength(2);expect(final.phase).toBe('results');expect(final.completion.reason).toBe('user_request');
  expect(texts.at(-1)).toContain(decision==='stay'?'unhurried stay':'brief coffee stop');
  if(mode==='online-fixture')expect(final.vibe_so_far).toContain(decision==='stay'?'unhurried stay':'brief coffee stop');
  else expect(final.vibe_so_far).toBe(context().originalInput.text);
  expect(final.version).toBeGreaterThan(initial.version);expect(published).toEqual(sceneVersions);
  expect(rankCandidates(final,[]).status).toBe('unavailable'); // Do not invent matches.
  off();s.destroy();
 });
});

describe('scene editing, neutrality and stale async results',()=>{
 it('editing B1 after B2 truncates the old scene, summary and pacing evidence',async()=>{
  const s=createLiveVibeSession(online,embedder);s.start(context().originalInput.text);await ready(s);s.answer({kind:'choice',optionId:'bakery'});await ready(s);s.answer({kind:'choice',optionId:'bakery-stay'});s.showMatches();await ready(s);
  s.revise(0,{kind:'choice',optionId:'nook'});await ready(s);const p=s.getSnapshot()!;
  expect(p.history).toHaveLength(1);expect(p.question?.id).toBe('session-b/v1/B2/nook');expect(p.evidence.some(e=>/bakery|unhurried stay/i.test(e.text))).toBe(false);
  expect(replay(p.originalInput,p.history).evidence).toEqual(p.evidence);
  s.revise(0,{kind:'correction',text:'Actually I want a quiet coffee to take away'});await ready(s);
  expect(selectedCoffeeScene(s.getSnapshot()!)).toBeUndefined();expect(s.getSnapshot()!.evidence.some(e=>e.source==='correction')).toBe(true);s.destroy();
 });
 for(const kind of ['skip','neither','unfamiliar'] as const)it(`${kind} is neutral and does not pick a default branch`,async()=>{
  const s=createLiveVibeSession(offline,embedder);s.start(context().originalInput.text);await ready(s);s.answer({kind});await ready(s);
  expect(s.getSnapshot()!.evidence.filter(e=>e.source==='answer')).toHaveLength(0);expect(selectedCoffeeScene(s.getSnapshot()!)).toBeUndefined();expect(scenePresentation(s.getSnapshot()!.question!)).toBeUndefined();s.destroy();
 });
 for(const kind of ['skip','neither'] as const)it(`B2 ${kind} preserves B1 without inventing pacing evidence`,async()=>{
  const s=createLiveVibeSession(offline,embedder);s.start(context().originalInput.text);await ready(s);s.answer({kind:'choice',optionId:'nook'});await ready(s);s.answer({kind});await ready(s);s.showMatches();
  expect(s.getSnapshot()!.evidence.filter(e=>e.source==='answer')).toHaveLength(1);expect(s.getSnapshot()!.evidence.some(e=>e.topic==='pace')).toBe(false);expect(selectedCoffeeScene(s.getSnapshot()!)).toBe('nook');s.destroy();
 });
 it('immediate results stay results after the initial generation resolves',async()=>{
  let finish!:(r:GenerationResult)=>void,ctx!:GenerationContext;
  const s=createLiveVibeSession({generate:async c=>{ctx=c;return new Promise(r=>finish=r);}},embedder);
  s.start(context().originalInput.text);s.showMatches();finish(result(ctx));await ready(s);
  expect(s.getSnapshot()!.phase).toBe('results');expect(s.getSnapshot()!.history).toHaveLength(0);s.destroy();
 });
 it('ignores obsolete bakery generation and inference after changing B1 to nook',async()=>{
  let slow=false;const generations:{c:GenerationContext;resolve:(r:GenerationResult)=>void}[]=[];
  const embeds:((r:{modelKey:string;vector:number[]})=>void)[]=[];
  const s=createLiveVibeSession({generate:async c=>slow?new Promise(r=>generations.push({c,resolve:r})):result(c)},{embed:async()=>new Promise(r=>embeds.push(r))});
  s.start(context().originalInput.text);await ready(s);slow=true;s.answer({kind:'choice',optionId:'bakery'});s.revise(0,{kind:'choice',optionId:'nook'});
  generations[1].resolve(result(generations[1].c));await ready(s);generations[0].resolve(result(generations[0].c));
  embeds[0]({modelKey:MODEL_KEY,vector});await new Promise(r=>setTimeout(r,5));
  expect(s.getSnapshot()!.question?.id).toBe('session-b/v1/B2/nook');expect(s.getSnapshot()!.embedding.status).toBe('pending');
  embeds.at(-1)!({modelKey:MODEL_KEY,vector});await vi.waitFor(()=>expect(s.getSnapshot()!.embedding.status).toBe('ready'));
  expect(s.getSnapshot()!.embedding.version).toBe(s.getSnapshot()!.version);s.destroy();
 });
});
