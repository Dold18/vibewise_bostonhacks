import { embeddingText, evidenceFrom, negativeText } from '../evidence';
import { createConvergence, mapDisplay } from '../convergence';
import { describe,it,expect,vi } from 'vitest';
import { createLiveVibeSession,replay } from '../liveEngine';
import { guidanceFor,FAMILIES,fallbackQuestion } from '../families';
import { validateGeneration,validContext } from '../validation';
import { MODEL_KEY,validateVector,type GenerationContext,type GenerationResult,type GenerationProvider,type EmbeddingProvider } from '../profile';
import { createProfilePublisher } from '../publisher';
import { sceneFor,rankCandidates,safePinAppearance,subscribeScene,subscribeRecommendations } from '../adapters';
import { resolveThemeTarget } from '../../vibeTheme/controller';
const vector=(i=0)=>Array.from({length:384},(_,n)=>n===i?1:0); // Explicit TEST FIXTURE embedding space only.
const embedder:EmbeddingProvider={embed:async()=>({modelKey:MODEL_KEY,vector:vector()})};
function context():GenerationContext {return {sessionId:'fixture',version:1,originalInput:{text:'A cinematic neon evening, energetic but absolutely not crowded.',imageCount:0,imageProcessing:'not_sent'},vibe_so_far:'A cinematic neon evening',history:[],evidence:[],qualifiers:[]};}
function result(c:GenerationContext,finish=false):GenerationResult {
 const g=guidanceFor(c),last=c.history.at(-1),choice=last?.response.kind==='choice'?last.question.options.find(o=>last.response.kind==='choice'&&o.id===last.response.optionId)?.description:'';
 return {vibe_so_far:`A richly atmospheric outing with distinctive details, room for personal choices, and a memorable sense of place. ${choice??''}`,qualifiers:[],continuation:finish?'finish':'refine',reason:finish?'Enough specific detail':'Another useful detail remains',nextQuestion:c.history.length>=10?null:{id:`fixture-${c.version}`,family:g.families[0].id,topic:g.topics[0],cultural:false,prompt:`A mysterious invitation arrives for your evening. Which ${g.topics[0]} detail belongs in the story?`,options:[{id:'a',label:'The amber-room invitation',description:'Warm lamplight, soft instruments and a tucked-away table for conversation.',preference:'want'},{id:'b',label:'The open-horizon invitation',description:'Cool sea air, bright movement and an expansive waterfront view to explore.',preference:'want'}]}};
}
const ready=async(s:ReturnType<typeof createLiveVibeSession>)=>vi.waitFor(()=>expect(s.getSnapshot()?.generation).not.toBe('pending'));
const generator:GenerationProvider={generate:async c=>result(c)};
describe('canonical adaptive session with no venues',()=>{
 it('generates the initial question from original input, then updates one versioned profile per answer',async()=>{
  const calls:GenerationContext[]=[];const s=createLiveVibeSession({generate:async c=>{calls.push(c);return result(c);}},embedder);
  s.start('Like a rainy bookshop, absolutely not crowded',2,'fixture');await ready(s);
  expect(calls[0].originalInput).toEqual({text:'Like a rainy bookshop, absolutely not crowded',imageCount:1,imageProcessing:'described'});expect(calls[0].history).toHaveLength(0);
  const v=s.getSnapshot()!.version;s.answer({kind:'choice',optionId:'a'});await ready(s);
  expect(s.getSnapshot()!.version).toBeGreaterThan(v);expect(calls.at(-1)!.history).toHaveLength(1);
  expect(s.getSnapshot()!.evidence.some(e=>e.polarity==='dealbreaker'&&e.text.includes('crowded'))).toBe(true);
  expect(s.getSnapshot()!.vibe_so_far).toContain('not crowded');
 });
 it('no photo means not_sent',async()=>{const calls:GenerationContext[]=[];const s=createLiveVibeSession({generate:async c=>{calls.push(c);return result(c);}},embedder);s.start('A',0,'f');await ready(s);expect(calls[0].originalInput.imageProcessing).toBe('not_sent');});
 it('accepts 800-char corrections and rejects 801',async()=>{const s=createLiveVibeSession(generator,embedder);s.start('A scene',0,'f');await ready(s);expect(()=>s.answer({kind:'correction',text:'x'.repeat(801)})).toThrow(/1–800/);s.answer({kind:'correction',text:'x'.repeat(800)});await ready(s);expect(s.getSnapshot()!.history).toHaveLength(1);});
 it('opposite answers produce different semantic descriptions without inventing venue rankings',async()=>{
  const a=createLiveVibeSession(generator,embedder),b=createLiveVibeSession(generator,embedder);a.start('A new scene',0,'same');b.start('A new scene',0,'same');await ready(a);await ready(b);
  a.answer({kind:'choice',optionId:'a'});b.answer({kind:'choice',optionId:'b'});await ready(a);await ready(b);
  expect(a.getSnapshot()!.vibe_so_far).not.toBe(b.getSnapshot()!.vibe_so_far);expect(rankCandidates(a.getSnapshot()!,[]).status).toBe('unavailable');
 });
 for(const kind of ['skip','neither','unfamiliar'] as const)it(`${kind} is neutral and unchosen choices never become dislikes`,async()=>{
  const s=createLiveVibeSession(generator,embedder);s.start('A creative night',0,'fixture');await ready(s);const before=s.getSnapshot()!.evidence;s.answer({kind});await ready(s);expect(s.getSnapshot()!.evidence).toEqual(before);
 });
 it('finishes around three informative answers when sufficiently specific, and still allows refinement',async()=>{
  const s=createLiveVibeSession({generate:async c=>result(c,c.history.length>=3)},embedder);s.start('A thoughtful evening',0,'fixture');await ready(s);
  for(let i=0;i<3;i++){s.answer({kind:'choice',optionId:'a'});await ready(s);}
  expect(s.getSnapshot()!.completion.reason).toBe('sufficient_detail');expect(s.getSnapshot()!.phase).toBe('results');s.continueRefining();expect(s.getSnapshot()!.phase).toBe('question');
 });
 it('never exceeds ten, even if the model always wants more',async()=>{
  const s=createLiveVibeSession({generate:async c=>({...result(c),qualifiers:['A useful nuance remains']})},embedder);s.start('An ambiguous scene',0,'fixture');await ready(s);
  for(let i=0;i<10;i++){s.answer({kind:'choice',optionId:'a'});await ready(s);}
  expect(s.getSnapshot()!.history).toHaveLength(10);expect(s.getSnapshot()!.completion).toMatchObject({reason:'maximum',canContinue:false});s.continueRefining();s.answer({kind:'skip'});expect(s.getSnapshot()!.history).toHaveLength(10);
 });
 it('Show My Matches works during initial generation and does not discard the pending result',async()=>{
  let finish!:(r:GenerationResult)=>void;let c!:GenerationContext;const s=createLiveVibeSession({generate:async x=>{c=x;return new Promise(r=>finish=r);}},embedder);
  s.start('A hazy city night',0,'fixture');s.showMatches();expect(s.getSnapshot()!.phase).toBe('results');finish(result(c));await ready(s);expect(s.getSnapshot()!.phase).toBe('results');expect(s.getSnapshot()!.completion.reason).toBe('user_request');
 });
 it('Back/Edit truncates obsolete history and reconstructs durable evidence from the retained history',async()=>{
  const s=createLiveVibeSession(generator,embedder);s.start('Warm but not crowded',0,'fixture');await ready(s);s.answer({kind:'choice',optionId:'a'});await ready(s);s.answer({kind:'choice',optionId:'a'});await ready(s);
  const old=s.getSnapshot()!;s.revise(0,{kind:'choice',optionId:'b'});await ready(s);const p=s.getSnapshot()!;
  expect(p.history).toHaveLength(1);expect(p.version).toBeGreaterThan(old.version);expect(p.evidence.some(e=>e.text.includes('Cool sea air'))).toBe(true);expect(p.evidence.some(e=>e.text.includes('Warm lamplight'))).toBe(false);
  expect(replay(p.originalInput,p.history).vibe_so_far).toBe(p.vibe_so_far);expect(replay(p.originalInput,p.history).evidence).toEqual(p.evidence);
 });
 it('a direct correction overrides an older crowd exclusion without erasing unrelated requirements',async()=>{
  const s=createLiveVibeSession(generator,embedder);s.start('Energetic and visually striking, but absolutely not crowded',0,'fixture');await ready(s);s.answer({kind:'correction',text:'Actually a lively crowd is fine now'});await ready(s);
  expect(s.getSnapshot()!.evidence.filter(e=>e.polarity!=='want'&&e.topic==='crowding')).toHaveLength(0);expect(s.getSnapshot()!.evidence.some(e=>e.text.includes('visually striking'))).toBe(true);
 });
 it('preserves the last valid summary and pending answers across AI failure and recovery',async()=>{
  let fail=false;const seen:GenerationContext[]=[];const s=createLiveVibeSession({generate:async c=>{seen.push(c);if(fail)throw Error('offline');return result(c);}},embedder);
  s.start('Candlelit and uncrowded',0,'fixture');await ready(s);const summary=s.getSnapshot()!.vibe_so_far;fail=true;s.answer({kind:'choice',optionId:'a'});await ready(s);
  expect(s.getSnapshot()!.generation).toBe('fallback');expect(s.getSnapshot()!.vibe_so_far).toBe(summary);expect(s.getSnapshot()!.history).toHaveLength(1);
  fail=false;s.retry();await ready(s);expect(seen.at(-1)!.history).toHaveLength(1);expect(s.getSnapshot()!.generation).toBe('gemini');
 });
 it('retains immutable answer history and profile snapshots',async()=>{
  const s=createLiveVibeSession(generator,embedder);s.start('A quiet world',0,'fixture');await ready(s);s.answer({kind:'choice',optionId:'a'});await ready(s);const p=s.getSnapshot()!;
  expect(Object.isFrozen(p)).toBe(true);expect(Object.isFrozen(p.history[0].question.options)).toBe(true);
 });
});
describe('stale asynchronous work',()=>{
 it('drops old Gemini results after a new session',async()=>{
  let first!:GenerationContext,resolve!:(r:GenerationResult)=>void;let count=0;const s=createLiveVibeSession({generate:async c=>{if(count++===0){first=c;return new Promise(r=>resolve=r);}return result(c);}},embedder);
  s.start('Old night',0,'old');s.start('New day',0,'new');await ready(s);resolve(result(first));await new Promise(r=>setTimeout(r,5));expect(s.getSnapshot()!.sessionId).toBe('new');
 });
 it('drops old MiniLM results after an answer changes the version',async()=>{
  const pending:((r:{modelKey:string;vector:number[]})=>void)[]=[];const s=createLiveVibeSession(generator,{embed:async()=>new Promise(r=>pending.push(r))});s.start('A scene',0,'fixture');await ready(s);
  s.answer({kind:'choice',optionId:'a'});await ready(s);pending[0]({modelKey:MODEL_KEY,vector:vector(1)});await new Promise(r=>setTimeout(r,5));expect(s.getSnapshot()!.embedding.status).toBe('pending');
  pending[1]({modelKey:MODEL_KEY,vector:vector(2)});await vi.waitFor(()=>expect(s.getSnapshot()!.embedding.status).toBe('ready'));expect(s.getSnapshot()!.embedding.vector![2]).toBe(1);expect(s.getSnapshot()!.embedding.version).toBe(s.getSnapshot()!.version);
 });
 it('marks MiniLM unavailable without fabricating a vector',async()=>{
  const s=createLiveVibeSession(generator,{embed:async()=>{throw Error('missing runtime');}});s.start('Rainy jazz',0,'fixture');await ready(s);await vi.waitFor(()=>expect(s.getSnapshot()!.embedding.status).toBe('unavailable'));expect(s.getSnapshot()!.embedding.vector).toBeUndefined();
 });
});
describe('creative questions and validation',()=>{
 it('has broad creative families with two reusable guidance examples each',()=>{expect(FAMILIES.length).toBeGreaterThanOrEqual(16);expect(FAMILIES.every(f=>f.examples.length>=2)).toBe(true);expect(FAMILIES.map(f=>f.id)).toContain('game_world');});
 for(const input of ['Cinematic neon nightlife','Quiet romantic evening','Playful outdoor afternoon','Nostalgic, slightly eerie atmosphere','High-energy music-focused outing','A scene like a memory I cannot quite name'])it(`fallback stays descriptive and answerable for ${input}`,()=>{
  const c={...context(),originalInput:{...context().originalInput,text:input}};const q=fallbackQuestion(c)!;expect(q.prompt).toContain(input);expect(q.options.every(o=>o.description.length>=20)).toBe(true);expect(q.options.length).toBeGreaterThanOrEqual(2);
 });
 it('rejects semantic repeats even if the presentation wording changes',()=>{
  const c=context(),r=result(c),q=r.nextQuestion!;c.history=[{id:'1',question:q,response:{kind:'skip'}}];expect(()=>validateGeneration({...r,nextQuestion:{...q,id:'new',prompt:'A different movie hides the same underlying question?'}},c)).toThrow();
 });
 it('rejects malformed options and generic personality phrasing',()=>{
  const c=context(),r=result(c);expect(()=>validateGeneration({...r,nextQuestion:{...r.nextQuestion,options:[]}},c)).toThrow();expect(()=>validateGeneration({...r,nextQuestion:{...r.nextQuestion,prompt:'Do you prefer quiet or loud settings for tonight?'}},c)).toThrow();
 });
 it('rejects question choices that violate an explicit crowd exclusion',()=>{
  const c=context();c.evidence=[{id:'x',text:'absolutely not crowded',kind:'explicit',source:'original',polarity:'dealbreaker',topic:'crowding'}];const r=result(c);const q=r.nextQuestion!;
  expect(()=>validateGeneration({...r,nextQuestion:{...q,options:[{...q.options[0],description:'A packed, crowded dancefloor full of strangers and loud music.'},q.options[1]]}},c)).toThrow();
 });
 it('validates bounded request context and model identity/dimension',()=>{expect(validContext(context())).toBe(true);expect(validContext({...context(),history:Array(11).fill({})})).toBe(false);expect(()=>validateVector(vector(),'wrong-model')).toThrow();expect(()=>validateVector([1,2],MODEL_KEY)).toThrow();expect(()=>validateVector(Array(384).fill(0),MODEL_KEY)).toThrow();expect(Math.hypot(...validateVector(vector(),MODEL_KEY))).toBe(1);});
});
describe('one profile for downstream consumers',()=>{
 it('publishes matching immutable versions to scene, recommendations and another subscriber',async()=>{
  const publisher=createProfilePublisher(),scenes:number[]=[],ranks:number[]=[],versions:number[]=[];
  subscribeScene(publisher,s=>{if(s)scenes.push(s.intent.sessionVersion);});subscribeRecommendations(publisher,()=>[],r=>{if(r)ranks.push(r.version);});publisher.subscribe(p=>{if(p)versions.push(p.version);});
  const s=createLiveVibeSession(generator,embedder,publisher);s.start('Warm cinematic jazz',0,'fixture');await ready(s);s.answer({kind:'choice',optionId:'a'});await ready(s);expect(scenes).toEqual(versions);expect(ranks).toEqual(versions);
  const scene=sceneFor(s.getSnapshot()!);expect(scene.intent.presets).toEqual([]);expect(scene.intent.overrides).toEqual([]);expect(scene.preview.cozy).toBe(1);
 });
 it('ranks vetted fixture embeddings without moving coordinates or permanently removing candidates',async()=>{
  const s=createLiveVibeSession(generator,embedder);s.start('A scene',0,'fixture');await ready(s);await vi.waitFor(()=>expect(s.getSnapshot()!.embedding.status).toBe('ready'));
  const candidates=[{id:'TEST FIXTURE A',location:{lat:42.35,lng:-71.06},eligible:true,embedding:vector(),modelKey:MODEL_KEY,provenance:'fixture' as const},{id:'TEST FIXTURE B',location:{lat:42.36,lng:-71.07},eligible:true,embedding:vector(1),modelKey:MODEL_KEY,provenance:'fixture' as const}];
  const ranked=rankCandidates(s.getSnapshot()!,candidates);expect(ranked.provenance).toBe('fixture');expect(ranked.all).toHaveLength(2);expect(ranked.all[0].location).toEqual(candidates[0].location);expect(safePinAppearance(ranked,candidates[1].id,'discovery').hidden).toBe(true);expect(safePinAppearance(ranked,candidates[1].id,'discovery',true).hidden).toBe(false);
  expect(safePinAppearance(ranked,candidates[1].id,'navigation')).toEqual({scale:1,hidden:false});expect(safePinAppearance(ranked,candidates[1].id,'search')).toEqual({scale:1,hidden:false});
  expect(rankCandidates(s.getSnapshot()!,[{...candidates[0],modelKey:'unverified'}]).status).toBe('unavailable');
 });
 it('uses navigation safety, then current outing, then account taste',()=>{
  const saved={tags:{} as never,strength:.5},outing={tags:{} as never,strength:.6};expect(resolveThemeTarget(saved,outing,true)).toBeNull();expect(resolveThemeTarget(saved,outing,false)).toBe(outing);expect(resolveThemeTarget(saved,null,false)).toBe(saved);
 });
});


describe('replay checkpoints and convergence lifecycle',()=>{
 it('tracks every answered topic/family and preserves unresolved qualifiers through failure',async()=>{
  let fail=false;const s=createLiveVibeSession({generate:async c=>{if(fail)throw Error('TEST FIXTURE offline');return {...result(c),qualifiers:['How much room to linger?']};}},embedder);
  s.start('An unresolved scene',0,'fixture');await ready(s);const q=s.getSnapshot()!.question!;fail=true;s.answer({kind:'choice',optionId:'a'});await ready(s);
  expect(s.getSnapshot()!.askedFamilies).toEqual([q.family]);expect(s.getSnapshot()!.askedTopics).toEqual([q.topic]);expect(s.getSnapshot()!.qualifiers).toEqual(['How much room to linger?']);
  fail=false;s.retry();await ready(s);expect(replay(s.getSnapshot()!.originalInput,s.getSnapshot()!.history).qualifiers).toEqual(s.getSnapshot()!.qualifiers);
 });
 it('discards a late candidate load after the session is cleared',async()=>{
  const p=createProfilePublisher();let resolve!:(v:never[])=>void;const applied:unknown[]=[];
  const c=createConvergence(p,async()=>new Promise(r=>resolve=r),r=>applied.push(r));const s=createLiveVibeSession(generator,embedder,p);s.start('A scene',0,'fixture');await ready(s);await vi.waitFor(()=>expect(s.getSnapshot()!.embedding.status).toBe('ready'));
  s.clear();const count=applied.length;resolve([]);await new Promise(r=>setTimeout(r,5));expect(applied.length).toBe(count);expect(applied.at(-1)).toBeNull();c.destroy();
 });
 it('opposite compatible semantic vectors restore previously weak fixture candidates',async()=>{
  const s=createLiveVibeSession(generator,embedder);s.start('A scene',0,'fixture');await ready(s);await vi.waitFor(()=>expect(s.getSnapshot()!.embedding.status).toBe('ready'));const p=s.getSnapshot()!;
  const places=[0,1].map(i=>({id:`TEST FIXTURE ${i}`,location:{lat:42.35+i/100,lng:-71.06},eligible:true,embedding:vector(i),modelKey:MODEL_KEY,provenance:'fixture' as const}));
  const first=rankCandidates(p,places),second=rankCandidates({...p,embedding:{...p.embedding,vector:vector(1)}},places);
  expect(first.all[0].id).not.toBe(second.all[0].id);expect(first.all.find(c=>c.id===places[1].id)!.weak).toBe(true);expect(second.all.find(c=>c.id===places[1].id)!.weak).toBe(false);expect(second.all).toHaveLength(2);expect(second.all[0].location).toEqual(places[1].location);
 });
});


describe('fallback semantic evidence regressions',()=>{
 it('embeds each new explicit fallback answer while preserving the Gemini summary',async()=>{
  let offline=false;const texts:string[]=[],negatives:string[]=[];
  const s=createLiveVibeSession({generate:async c=>{if(offline)throw Error('TEST FIXTURE offline');return result(c);}}, {embed:async text=>{if(/^(Want|Correction|Earlier summary)/.test(text))texts.push(text);else negatives.push(text);return {modelKey:MODEL_KEY,vector:vector()};}});
  s.start('An intriguing evening, never crowded',0,'fallback-evidence');await ready(s);
  const summary=s.getSnapshot()!.vibe_so_far;offline=true;
  s.answer({kind:'choice',optionId:'a'});await ready(s);
  expect(texts.at(-1)).toContain('Warm lamplight');expect(texts.at(-1)).not.toContain('Cool sea air');
  expect(texts.at(-1)).not.toContain('crowded');expect(negatives.at(-1)).toContain('crowded');
  const next=s.getSnapshot()!.question!,option=next.options[0];const count=texts.length;
  s.answer({kind:'choice',optionId:option.id});await ready(s);
  expect(texts.length).toBeGreaterThan(count);expect(texts.at(-1)).toContain(option.description);
  expect(s.getSnapshot()!.vibe_so_far).toBe(summary);
  expect(s.getSnapshot()!.embedding.version).toBe(s.getSnapshot()!.version);
  s.answer({kind:'correction',text:'Actually quiet acoustic music, no fluorescent lighting'});await ready(s);
  expect(texts.at(-1)).toContain('Correction: Actually quiet acoustic music');expect(texts.at(-1)).not.toContain('fluorescent');expect(negatives.at(-1)).toContain('fluorescent lighting');
  s.destroy();
 });
 it('updates from original text without inventing a summary when Gemini never works',async()=>{
  const texts:string[]=[],negatives:string[]=[];const s=createLiveVibeSession({generate:async()=>{throw Error('TEST FIXTURE offline');}}, {embed:async text=>{if(/^(Want|Correction|Earlier summary)/.test(text))texts.push(text);else negatives.push(text);return {modelKey:MODEL_KEY,vector:vector()};}});
  s.start('A quiet garden, no crowds',0,'always-offline');await ready(s);
  const q=s.getSnapshot()!.question!;s.answer({kind:'choice',optionId:q.options[0].id});await ready(s);
  expect(texts.at(-1)).toContain(q.options[0].description);expect(s.getSnapshot()!.vibe_so_far).toBe('A quiet garden, no crowds');
  const before=texts.at(-1);s.answer({kind:'neither'});await ready(s);expect(texts.at(-1)).toBe(before);s.destroy();
 });
 it('deduplicates evidence, keeps exclusions OUT of the positive query and in the negative text',()=>{
  // Real MiniLM measurement: embedding "Exclude: loud…" pulls loud places closer, so exclusions are ranked separately.
  const evidence=evidenceFrom('No crowds, no loud music, warm lamps',[]);
  const text=embeddingText('Warm lamps. No loud music here. '+ 'Long scenic context. '.repeat(200),[...evidence,...evidence]);
  expect(text).not.toMatch(/crowds|loud/i);
  expect(text.indexOf('warm lamps')).toBeLessThan(text.indexOf('Long scenic context'));
  expect(text.toLowerCase().match(/warm lamps/g)).toHaveLength(1);
  expect(negativeText([...evidence,...evidence])).toBe('crowds\nloud music');
  const original='Quiet garden, no crowds';expect(embeddingText(original,evidenceFrom(original,[]))).toContain('Quiet garden');expect(embeddingText(original,evidenceFrom(original,[]))).not.toMatch(/crowds/);
  expect(embeddingText('静かな庭',evidenceFrom('静かな庭',[]))).toContain('Want: 静かな庭');
 });
 it('drops obsolete fallback inference after correction and after starting over, even when abort is ignored',async()=>{
  const pending:((r:{modelKey:string;vector:number[]})=>void)[]=[];
  const s=createLiveVibeSession({generate:async()=>{throw Error('TEST FIXTURE offline');}}, {embed:async()=>new Promise(r=>pending.push(r))});
  s.start('An old evening',0,'old');await ready(s);
  s.answer({kind:'correction',text:'A bright garden with acoustic music'});await ready(s);
  pending[1]({modelKey:MODEL_KEY,vector:vector(2)});await vi.waitFor(()=>expect(s.getSnapshot()!.embedding.status).toBe('ready'));
  pending[0]({modelKey:MODEL_KEY,vector:vector(1)});await new Promise(r=>setTimeout(r,5));expect(s.getSnapshot()!.embedding.vector![2]).toBe(1);
  s.start('A new evening',0,'new');await ready(s);s.clear();pending[2]({modelKey:MODEL_KEY,vector:vector(3)});await new Promise(r=>setTimeout(r,5));expect(s.getSnapshot()).toBeNull();s.destroy();
 });
});

describe('outing display lifecycle',()=>{
 it('toggles weaker pins and returns to ranked pins without moving candidates; preserves search/navigation',async()=>{
  const p=createProfilePublisher();const places=[0,1].map(i=>({id:`TEST FIXTURE ${i}`,location:{lat:42.35+i/100,lng:-71.06},eligible:true,embedding:vector(i),modelKey:MODEL_KEY,provenance:'fixture' as const}));
  const renders:unknown[]=[];const c=createConvergence(p,async()=>places,r=>renders.push(r));const s=createLiveVibeSession(generator,embedder,p);
  s.start('A scene',0,'display');await ready(s);await vi.waitFor(()=>expect(c.appearance(places[1].id,'discovery').hidden).toBe(true));
  const last=renders.at(-1);mapDisplay.setShowAll(true);expect(c.appearance(places[1].id,'discovery').hidden).toBe(false);
  mapDisplay.setShowAll(false);expect(c.appearance(places[1].id,'discovery').hidden).toBe(true);expect(renders.at(-1)).toBe(last);
  expect(c.appearance(places[1].id,'navigation')).toEqual({scale:1,hidden:false});expect(c.appearance(places[1].id,'search')).toEqual({scale:1,hidden:false});
  expect((last as ReturnType<typeof rankCandidates>).all.map(r=>r.location)).toEqual(places.map(r=>r.location));
  mapDisplay.setShowAll(true);s.start('Another scene',0,'display-next');expect(mapDisplay.showAll).toBe(false);await ready(s);
  mapDisplay.setShowAll(true);s.clear();expect(mapDisplay.showAll).toBe(false);
  mapDisplay.setShowAll(true);s.start('A fresh session',0,'fresh');expect(mapDisplay.showAll).toBe(false);s.clear();c.destroy();
 });
});

describe('multi-turn fallback variety',()=>{
 const vibes=['Cinematic neon nightlife','Quiet romantic evening','Playful outdoor afternoon','Nostalgic, slightly eerie atmosphere','High-energy music-focused outing','A scene like a memory I cannot quite name'];
 for(const input of vibes)it(`uses distinct mechanics and new topics for ten turns: ${input}`,()=>{
  let c:GenerationContext={...context(),originalInput:{...context().originalInput,text:input},evidence:evidenceFrom(input,[])};
  const prompts=new Set<string>(),families=new Set<string>(),topics=new Set<string>();
  for(let i=0;i<10;i++){
   const q=fallbackQuestion(c)!;expect(q).not.toBeNull();expect(q.prompt).toContain(input);
   expect(()=>validateGeneration({vibe_so_far:'TEST FIXTURE retained outing description',nextQuestion:q,qualifiers:[],continuation:'refine',reason:'TEST FIXTURE'},c)).not.toThrow();
   expect(prompts.has(q.prompt)).toBe(false);expect(families.has(q.family)).toBe(false);expect(topics.has(q.topic)).toBe(false);
   expect(q.prompt).not.toContain('Which detail belongs in the scene');expect(q.options.every(o=>o.description.length>=20)).toBe(true);
   prompts.add(q.prompt);families.add(q.family);topics.add(q.topic);
   const history=[...c.history,{id:`test-${i}`,question:q,response:{kind:'choice' as const,optionId:q.options[0].id}}];
   c={...c,version:c.version+1,history,evidence:evidenceFrom(input,history)};
  }
  expect(fallbackQuestion(c)).toBeNull();expect(families.size).toBe(10);
 });
 it('adapts the first mechanic to the starting vibe and carries the selected detail forward',()=>{
  const first=vibes.map(input=>fallbackQuestion({...context(),originalInput:{...context().originalInput,text:input},evidence:evidenceFrom(input,[])})!);
  expect(new Set(first.map(q=>q.family)).size).toBeGreaterThanOrEqual(5);
  const c=context(),q=fallbackQuestion(c)!;c.history=[{id:'1',question:q,response:{kind:'choice',optionId:q.options[0].id}}];c.evidence=evidenceFrom('',c.history);c.version++;
  expect(fallbackQuestion(c)!.prompt).toContain(q.options[0].label.slice(0,65));
 });
 it('offers descriptive, valid presentations for all sixteen families, including neutral unfamiliar follow-ups',()=>{
  const seen=new Set<string>();
  for(let i=0;i<250;i++){
   const c={...context(),version:i+1,originalInput:{...context().originalInput,text:`Explore a new detail ${i}`}};const q=fallbackQuestion(c)!;seen.add(q.family);
   expect(()=>validateGeneration({vibe_so_far:'TEST FIXTURE current outing atmosphere',nextQuestion:q,qualifiers:[],continuation:'refine',reason:'TEST FIXTURE'},c)).not.toThrow();
   expect(q.cultural).toBe(false);
  }
  expect(seen.size).toBe(16);
 });
});
