import {describe,it,expect,vi,afterEach} from 'vitest';
import express from 'express';
import type {Server} from 'node:http';
import {createGeminiPhotoDescriber,PHOTO_SCHEMA,PHOTO_SYSTEM,type PhotoInput} from '../../../../server/photoDescriber';
import {createPhotoRoutes,type PhotoDeps} from '../../../../server/photoApi';
import {createSupabasePhotoAuth,normalizeSupabaseUrl,supabaseServerEnv,type PhotoAuth,type PhotoQuota} from '../../../../server/photoAuth';
import type {createClient} from '@supabase/supabase-js';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const img={mimeType:'image/jpeg' as const,data:'QUJD'};
const reply=(text:string)=>vi.fn(async()=>new Response(JSON.stringify({candidates:[{content:{parts:[{text}]}}]}),{status:200}));
const make=(f:ReturnType<typeof vi.fn>)=>createGeminiPhotoDescriber({apiKey:'TEST-FIXTURE-NOT-A-KEY',fetchImpl:f as unknown as typeof fetch});
const sig=()=>new AbortController().signal;
const call=(f:ReturnType<typeof vi.fn>)=>{const c=f.mock.calls[0] as unknown as [string,RequestInit];return {url:c[0],init:c[1],body:JSON.parse(c[1].body as string)};};
describe('photo describer',()=>{
 it('sends an inline image with a structured schema, header, no tools and default model',async()=>{
  const f=reply('{"description":"Warm amber light."}');await make(f).describe(img,sig());
  const {url,init,body}=call(f);
  expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
  expect((init.headers as Record<string,string>)['x-goog-api-key']).toBe('TEST-FIXTURE-NOT-A-KEY');
  const parts=body.contents[0].parts;expect(parts[0].text).toBeTypeOf('string');expect(parts[1]).toEqual({inlineData:{mimeType:'image/jpeg',data:'QUJD'}});
  expect(body.generationConfig.responseMimeType).toBe('application/json');expect(body.generationConfig.responseSchema).toEqual(PHOTO_SCHEMA);
  expect(body.generationConfig.thinkingConfig).toEqual({thinkingLevel:'low'});expect(body.generationConfig.maxOutputTokens).toBe(1024);expect(body.tools).toBeUndefined();
 });
 it('keeps thinking off for gemini-2.5 models',async()=>{
  const f=reply('{"description":"x"}');await createGeminiPhotoDescriber({apiKey:'TEST-FIXTURE-NOT-A-KEY',model:'gemini-2.5-flash',fetchImpl:f as unknown as typeof fetch}).describe(img,sig());
  const {url,body}=call(f);expect(url).toContain('/models/gemini-2.5-flash:');expect(body.generationConfig.thinkingConfig).toEqual({thinkingBudget:0});
 });
 it('includes the question only when given',async()=>{
  const a=reply('{"description":"x"}');await make(a).describe({...img,question:'What kind of lighting?'},sig());expect(call(a).body.contents[0].parts[0].text).toContain('What kind of lighting?');
  const b=reply('{"description":"x"}');await make(b).describe(img,sig());expect(call(b).body.contents[0].parts[0].text).not.toContain('Question:');
 });
 it('trims, returns empty for empty, strips Photo: prefix',async()=>{
  expect(await make(reply('{"description":"  Warm amber light.  "}')).describe(img,sig())).toBe('Warm amber light.');
  expect(await make(reply('{"description":""}')).describe(img,sig())).toBe('');
  expect(await make(reply('{"description":"Photo: Cosy and dim."}')).describe(img,sig())).toBe('Cosy and dim.');
 });
 it('cuts long descriptions to 280 chars at a word boundary',async()=>{
  const long=Array(80).fill('words').join(' ').slice(0,400);const out=await make(reply(JSON.stringify({description:long}))).describe(img,sig());
  expect(out.length).toBeLessThanOrEqual(280);expect(out.length).toBeGreaterThan(200);expect(out.endsWith('words')).toBe(true);
 });
 it('rejects with a missing key without calling fetch',async()=>{const f=vi.fn();await expect(createGeminiPhotoDescriber({fetchImpl:f}).describe(img,sig())).rejects.toThrow(/unavailable/);expect(f).not.toHaveBeenCalled();});
 it('does not leak provider error bodies',async()=>{const f=vi.fn(async()=>new Response('TEST FIXTURE provider details',{status:500}));await expect(make(f).describe(img,sig())).rejects.toThrow(/unavailable/);await make(f).describe(img,sig()).catch(e=>expect(String(e.message)).not.toContain('provider details'));});
 it('rejects invalid JSON without quoting model text',async()=>{await expect(make(reply('not json SECRET')).describe(img,sig())).rejects.toThrow(new Error('Invalid Gemini output'));await make(reply('not json SECRET')).describe(img,sig()).catch(e=>expect(e.message).toBe('Invalid Gemini output'));});
 it('collapses internal whitespace to single spaces',async()=>{expect(await make(reply(JSON.stringify({description:'Warm light.\n\nSoft   jazz.'}))).describe(img,sig())).toBe('Warm light. Soft jazz.');});
 it('frames the outing as in Boston',()=>{expect(PHOTO_SYSTEM).toContain('an outing in Boston');});
});
const running:Server[]=[];afterEach(async()=>{for(const x of running.splice(0))await new Promise<void>(r=>x.close(()=>r()));});
const ok={mimeType:'image/jpeg',data:'QUJD'};
async function serve(o:{describe?:(...args:unknown[])=>Promise<string>;remaining?:number;record?:number;unlimited?:boolean;noAuth?:boolean}={}) {
 let count=o.remaining??5;
 const quota={remaining:vi.fn(async()=>count),record:vi.fn(async()=>o.record??(--count))};
 const auth:PhotoAuth={verify:async t=>t==='good'?(quota as PhotoQuota):null};
 const describer={describe:vi.fn<(i:PhotoInput,s:AbortSignal)=>Promise<string>>(o.describe??(async()=>'Warm light'))};
 const deps:PhotoDeps={auth:()=>o.noAuth?null:auth,describer:()=>describer,unlimited:()=>!!o.unlimited};
 const app=express();app.use(express.json({limit:'2mb'}));app.use('/api/vibe',createPhotoRoutes(deps));
 const s=app.listen(0,'127.0.0.1');running.push(s);await new Promise<void>(r=>s.once('listening',r));const a=s.address();if(!a||typeof a==='string')throw Error('no server');
 const base=`http://127.0.0.1:${a.port}/api/vibe`;
 const post=(body:unknown,token:string|null='good',signal?:AbortSignal)=>fetch(`${base}/describe-image`,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body),signal});
 const get=(token:string|null='good')=>fetch(`${base}/photo-quota`,{headers:token?{Authorization:`Bearer ${token}`}:{}});
 return {post,get,quota,describer};
}
describe('photo routes',()=>{
 it('401 without header or with a bad token, never describing',async()=>{const s=await serve();for(const t of [null,'bad']){const r=await s.post(ok,t);expect(r.status).toBe(401);expect(await r.json()).toEqual({error:'Sign in to use a photo.'});}expect(s.describer.describe).not.toHaveBeenCalled();});
 it('400 for a gif, bad data, and a bad question',async()=>{const s=await serve();
  expect((await s.post({...ok,mimeType:'image/gif'})).status).toBe(400);
  expect((await s.post({...ok,data:''})).status).toBe(400);
  expect((await s.post({...ok,data:'not base64!'})).status).toBe(400);
  expect((await s.post({...ok,question:'x'.repeat(501)})).status).toBe(400);
  expect((await s.post({...ok,question:5})).status).toBe(400);expect(s.describer.describe).not.toHaveBeenCalled();});
 it('200 with description and remaining, passing the question',async()=>{const s=await serve({remaining:5});const r=await s.post({...ok,question:'Lighting?'});expect(r.status).toBe(200);expect(await r.json()).toEqual({description:'Warm light',remainingToday:4});expect(s.describer.describe.mock.calls[0][0]).toMatchObject({mimeType:'image/jpeg',data:'QUJD',question:'Lighting?'});});
 it('accepts a 500-character question, the longest a quiz prompt can be',async()=>{const s=await serve();const question='x'.repeat(500);const r=await s.post({...ok,question});expect(r.status).toBe(200);expect(s.describer.describe.mock.calls[0][0].question).toBe(question);});
 it('429 at the pre-check without describing',async()=>{const s=await serve({remaining:0});const r=await s.post(ok);expect(r.status).toBe(429);expect(await r.json()).toEqual({error:'daily_limit',remainingToday:0});expect(s.describer.describe).not.toHaveBeenCalled();});
 it('503 when the describer throws, recording nothing and leaking nothing',async()=>{const s=await serve({describe:async()=>{throw Error('SECRET-DETAIL');}});const r=await s.post(ok);expect(r.status).toBe(503);expect(JSON.stringify(await r.json())).not.toContain('SECRET');expect(s.quota.record).not.toHaveBeenCalled();});
 it('422 for an empty description, recording nothing',async()=>{const s=await serve({describe:async()=>''});const r=await s.post(ok);expect(r.status).toBe(422);expect(await r.json()).toEqual({error:'unreadable'});expect(s.quota.record).not.toHaveBeenCalled();});
 it('429 without a description when record races to -1',async()=>{const s=await serve({remaining:1,record:-1});const r=await s.post(ok);expect(r.status).toBe(429);const b=await r.json();expect(b).toEqual({error:'daily_limit',remainingToday:0});expect(b.description).toBeUndefined();});
 it('records no use when the client left before the description arrived',async()=>{
  let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});let seen:AbortSignal|undefined;
  // A describer that ignores the abort and resolves anyway, as a slow provider call can.
  const s=await serve({describe:async(...args:unknown[])=>{seen=args[1] as AbortSignal;await gate;return 'Warm light';}});
  const client=new AbortController();const sent=s.post(ok,'good',client.signal).catch(()=>null);
  await vi.waitFor(()=>expect(seen).toBeDefined());client.abort();await vi.waitFor(()=>expect(seen!.aborted).toBe(true));
  release();await sent;await new Promise(r=>setTimeout(r,50));
  expect(s.describer.describe).toHaveBeenCalledTimes(1);expect(s.quota.record).not.toHaveBeenCalled();});
 it('503 when a quota RPC throws without leaking',async()=>{const s=await serve();s.quota.remaining.mockRejectedValue(Error('SECRET-DB'));const r=await s.post(ok);expect(r.status).toBe(503);expect(JSON.stringify(await r.json())).not.toContain('SECRET');});
 it('unlimited skips quota calls but still needs a token',async()=>{const s=await serve({unlimited:true});const r=await s.post(ok);expect(r.status).toBe(200);expect(await r.json()).toEqual({description:'Warm light',remainingToday:null});expect(s.quota.remaining).not.toHaveBeenCalled();expect(s.quota.record).not.toHaveBeenCalled();expect((await s.post(ok,null)).status).toBe(401);});
 it('503 when auth is not configured',async()=>{const s=await serve({noAuth:true});expect((await s.post(ok)).status).toBe(503);expect((await s.get()).status).toBe(503);});
 it('GET /photo-quota reports remaining, null when unlimited, 401 without token',async()=>{
  const a=await serve({remaining:3});expect(await (await a.get()).json()).toEqual({remainingToday:3,limit:5});expect((await a.get(null)).status).toBe(401);
  const b=await serve({unlimited:true});expect(await (await b.get()).json()).toEqual({remainingToday:null,limit:5});});
 it('server/app.ts (local server and Vercel Function) takes a 500 KB photo body but keeps 64kb elsewhere',async()=>{
  // Point env loading at a missing file so the test never reads the developer's .env.
  vi.stubEnv('VIBENTA_ENV_FILE',join(tmpdir(),'vibenta-no-such-env-file'));
  const {default:app}=await import('../../../../server/app');
  const s=app.listen(0,'127.0.0.1');running.push(s);await new Promise<void>(r=>s.once('listening',r));const a=s.address();if(!a||typeof a==='string')throw Error('no server');
  // No token: the route answers 401 after the body parser accepted the body, so nothing reaches Supabase or Gemini.
  const photo=await fetch(`http://127.0.0.1:${a.port}/api/vibe/describe-image`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mimeType:'image/jpeg',data:'A'.repeat(500000)})});
  expect(photo.status).toBe(401);
  const other=await fetch(`http://127.0.0.1:${a.port}/api/transit/route`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pad:'A'.repeat(100000)})});
  expect(other.status).toBe(413);
  vi.unstubAllEnvs();});
});
describe('supabase photo auth',()=>{
 it('reads SUPABASE_* first and falls back to the browser VITE_SUPABASE_* names, like catalog search',()=>{
  expect(supabaseServerEnv({SUPABASE_URL:'https://server.supabase.co',VITE_SUPABASE_URL:'https://browser.supabase.co',SUPABASE_PUBLISHABLE_KEY:'server-key',VITE_SUPABASE_PUBLISHABLE_KEY:'browser-key'})).toEqual({url:'https://server.supabase.co',key:'server-key'});
  expect(supabaseServerEnv({VITE_SUPABASE_URL:'https://browser.supabase.co',VITE_SUPABASE_PUBLISHABLE_KEY:'browser-key'})).toEqual({url:'https://browser.supabase.co',key:'browser-key'});
  expect(supabaseServerEnv({SUPABASE_URL:'https://server.supabase.co',VITE_SUPABASE_PUBLISHABLE_KEY:'browser-key'})).toEqual({url:'https://server.supabase.co',key:'browser-key'});
  expect(supabaseServerEnv({})).toEqual({url:undefined,key:undefined});});
 it('normalises the Supabase URL',()=>{for(const u of ['https://abc.supabase.co/rest/v1/','https://abc.supabase.co/rest/v1','https://abc.supabase.co/','  https://abc.supabase.co  ','https://abc.supabase.co'])expect(normalizeSupabaseUrl(u)).toBe('https://abc.supabase.co');});
 const stub=(getUser:()=>Promise<unknown>,urls:string[]=[])=>createSupabasePhotoAuth({url:'https://abc.supabase.co/rest/v1/',key:'TEST-FIXTURE',create:((u:string)=>{urls.push(u);return {auth:{getUser},rpc:async()=>({data:3,error:null})};}) as unknown as typeof createClient})!;
 it('passes a normalised URL and returns a quota for a valid user',async()=>{const urls:string[]=[];const q=await stub(async()=>({data:{user:{id:'u'}},error:null}),urls).verify('t');expect(urls).toEqual(['https://abc.supabase.co']);expect(await q!.remaining(5)).toBe(3);});
 it('returns null for 401/403 or no user, throws for other errors',async()=>{
  expect(await stub(async()=>({data:{user:null},error:{status:401}})).verify('t')).toBeNull();
  expect(await stub(async()=>({data:{user:null},error:{status:403}})).verify('t')).toBeNull();
  expect(await stub(async()=>({data:{user:null},error:null})).verify('t')).toBeNull();
  await expect(stub(async()=>({data:{user:null},error:{status:500}})).verify('t')).rejects.toThrow();
  await expect(stub(async()=>({data:{user:null},error:{status:0}})).verify('t')).rejects.toThrow();});
 it('route answers 503 when verify rejects',async()=>{
  const app=express();app.use(express.json());app.use('/api/vibe',createPhotoRoutes({auth:()=>({verify:async()=>{throw Error('SECRET');}}),describer:()=>({describe:async()=>'x'}),unlimited:()=>false}));
  const s=app.listen(0,'127.0.0.1');running.push(s);await new Promise<void>(r=>s.once('listening',r));const a=s.address();if(!a||typeof a==='string')throw Error('no server');
  const r=await fetch(`http://127.0.0.1:${a.port}/api/vibe/photo-quota`,{headers:{Authorization:'Bearer t'}});expect(r.status).toBe(503);});
});
