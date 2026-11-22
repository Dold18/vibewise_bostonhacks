import {describe,it,expect,vi,afterEach} from 'vitest';
import express from 'express';
import type {Server} from 'node:http';
import {createVibeRouter} from '../../../../server/vibeApi';
import {createGeminiGenerator} from '../../../../server/vibeGemini';
import {fallbackQuestion,guidanceFor} from '../families';
import {localMediaQuestion} from '../media/localDirector';
import {MODEL_KEY,type GenerationContext} from '../profile';
import {apiEmbeddingProvider} from '../providers';
const c:GenerationContext={sessionId:'TEST-FIXTURE',version:1,originalInput:{text:'A cinematic evening with playful little surprises',imageCount:0,imageProcessing:'not_sent'},vibe_so_far:'A cinematic evening',history:[],evidence:[],qualifiers:[]};
const output=()=>({vibe_so_far:'A cinematic evening with playful little discoveries and room to linger.',qualifiers:[],continuation:'refine' as const,reason:'Another detail may help',nextQuestion:localMediaQuestion(c)});
const running:Server[]=[];afterEach(async()=>{vi.unstubAllGlobals();for(const server of running.splice(0))await new Promise<void>(r=>server.close(()=>r()));});
async function server() {
 const generator={generate:vi.fn(async()=>output())};
 const embedder={embed:vi.fn(async()=>({modelKey:MODEL_KEY,vector:Array.from({length:384},(_,i)=>i===0?1:0)}))};
 const app=express();app.use(express.json({limit:'64kb'}));app.use('/api/vibe',createVibeRouter({generator,embedder}));
 const s=app.listen(0,'127.0.0.1');running.push(s);await new Promise<void>(r=>s.once('listening',r));const address=s.address();if(!address||typeof address==='string')throw Error('No test server');
 const post=(path:string,body:unknown)=>fetch(`http://127.0.0.1:${address.port}/api/vibe/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 return {post,generator,embedder};
}
describe('bounded server API (all external providers mocked)',()=>{
 it('accepts a valid zero-venue context and never asks for catalog data',async()=>{const s=await server(),res=await s.post('generate',c);expect(res.status).toBe(200);expect((await res.json()).vibe_so_far).toContain('cinematic');expect(s.generator.generate).toHaveBeenCalledOnce();});
 it('rejects malformed history and excessive input before generation',async()=>{const s=await server();expect((await s.post('generate',{...c,history:Array(11).fill({})})).status).toBe(400);expect((await s.post('generate',{...c,originalInput:{...c.originalInput,text:'x'.repeat(3000)}})).status).toBe(400);expect(s.generator.generate).not.toHaveBeenCalled();});
 it('rejects mismatched embedding identity before invoking MiniLM',async()=>{const s=await server();expect((await s.post('embed',{text:'a scene',modelKey:'other-model'})).status).toBe(400);expect(s.embedder.embed).not.toHaveBeenCalled();const res=await s.post('embed',{text:'a scene',modelKey:MODEL_KEY});expect(res.status).toBe(200);expect((await res.json()).vector).toHaveLength(384);});
});
describe('photo input validation',()=>{
 const oi=(o:object)=>({...c,originalInput:{...c.originalInput,...o}});
 const corr=(n:number)=>({...c,history:[{id:'1',question:fallbackQuestion(c)!,response:{kind:'correction',text:'x'.repeat(n)}}]});
 it('validates imageCount, imageProcessing and correction length',async()=>{const s=await server();
  expect((await s.post('generate',oi({imageCount:1,imageProcessing:'described'}))).status).toBe(200);
  expect((await s.post('generate',oi({imageCount:2,imageProcessing:'described'}))).status).toBe(400);
  expect((await s.post('generate',oi({imageCount:1,imageProcessing:'raw'}))).status).toBe(400);
  expect((await s.post('generate',corr(800))).status).toBe(200);
  expect((await s.post('generate',corr(801))).status).toBe(400);});
});
describe('Gemini request and failure behavior',()=>{
 it('uses a server header, structured schema, context-aware family guidance and no tools',async()=>{
  const fetchImpl=vi.fn(async()=>new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(output())}]}}]}),{status:200}));
  const provider=createGeminiGenerator({apiKey:'TEST-FIXTURE-NOT-A-KEY',fetchImpl:fetchImpl as typeof fetch});
  expect((await provider.generate(c,new AbortController().signal)).vibe_so_far).toContain('cinematic');
  const init=fetchImpl.mock.calls[0] as unknown as [string,RequestInit];const body=JSON.parse(init[1].body as string);
  expect((init[1].headers as Record<string,string>)['x-goog-api-key']).toBe('TEST-FIXTURE-NOT-A-KEY');expect(body.tools).toBeUndefined();expect(body.generationConfig.responseMimeType).toBe('application/json');expect(body.contents[0].parts[0].text).toContain('suggestedFamilies');expect(body.contents[0].parts[0].text).toContain('"library"');
 });
 it('retries poor/repeated output twice with feedback, then fails safely',async()=>{const f=vi.fn(async()=>new Response(JSON.stringify({candidates:[{content:{parts:[{text:'{}'}]}}]})));const p=createGeminiGenerator({apiKey:'TEST-FIXTURE',fetchImpl:f as typeof fetch});await expect(p.generate(c,new AbortController().signal)).rejects.toThrow('valid, distinct');expect(f).toHaveBeenCalledTimes(3);});
 it('returns promptly on rate limits without leaking provider error bodies',async()=>{const f=vi.fn(async()=>new Response('TEST FIXTURE provider details',{status:429}));await expect(createGeminiGenerator({apiKey:'TEST-FIXTURE',fetchImpl:f as typeof fetch}).generate(c,new AbortController().signal)).rejects.toThrow('rate limited');expect(f).toHaveBeenCalledOnce();});
 it('does not call external services with a missing key',async()=>{const f=vi.fn();await expect(createGeminiGenerator({fetchImpl:f}).generate(c,new AbortController().signal)).rejects.toThrow('unavailable');expect(f).not.toHaveBeenCalled();});
 it('aborts slow requests at the configured timeout',async()=>{const f=vi.fn((_url:unknown,init?:RequestInit)=>new Promise<Response>((_r,reject)=>init!.signal!.addEventListener('abort',()=>reject(new DOMException('Timeout','TimeoutError')))));await expect(createGeminiGenerator({apiKey:'TEST-FIXTURE',fetchImpl:f as typeof fetch,timeoutMs:5}).generate(c,new AbortController().signal)).rejects.toThrow();});
});
it('caches and deduplicates embedding work without accepting stale aborted callers',async()=>{
 let resolve!:(value:Response)=>void;const f=vi.fn(()=>new Promise<Response>(r=>resolve=r));vi.stubGlobal('fetch',f);const p=apiEmbeddingProvider(),a=new AbortController();
 const first=p.embed('TEST FIXTURE same text',a.signal);const second=p.embed('TEST FIXTURE same text',new AbortController().signal);a.abort();
 resolve(new Response(JSON.stringify({modelKey:MODEL_KEY,vector:Array.from({length:384},(_,i)=>i===0?1:0)})));
 await expect(first).rejects.toMatchObject({name:'AbortError'});await expect(second).resolves.toMatchObject({modelKey:MODEL_KEY});await p.embed('TEST FIXTURE same text',new AbortController().signal);expect(f).toHaveBeenCalledOnce();
});
it('family selection changes with history instead of following a fixed sequence',()=>{const g=guidanceFor(c);const q=fallbackQuestion(c)!;const next=guidanceFor({...c,version:2,history:[{id:'1',question:q,response:{kind:'skip'}}]});expect(next.families[0].id).not.toBe(q.family);expect(next.topics).not.toContain(q.topic);expect(g.families).toHaveLength(5);});
