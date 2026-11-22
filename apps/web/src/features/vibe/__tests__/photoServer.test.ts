import {describe,it,expect,vi} from 'vitest';
import {createGeminiPhotoDescriber,PHOTO_SCHEMA} from '../../../../server/photoDescriber';
const img={mimeType:'image/jpeg' as const,data:'QUJD'};
const reply=(text:string)=>vi.fn(async()=>new Response(JSON.stringify({candidates:[{content:{parts:[{text}]}}]}),{status:200}));
const make=(f:ReturnType<typeof vi.fn>)=>createGeminiPhotoDescriber({apiKey:'TEST-FIXTURE-NOT-A-KEY',fetchImpl:f as unknown as typeof fetch});
const sig=()=>new AbortController().signal;
const call=(f:ReturnType<typeof vi.fn>)=>{const c=f.mock.calls[0] as unknown as [string,RequestInit];return {url:c[0],init:c[1],body:JSON.parse(c[1].body as string)};};
describe('photo describer',()=>{
 it('sends an inline image with a structured schema, header, no tools and default model',async()=>{
  const f=reply('{"description":"Warm amber light."}');await make(f).describe(img,sig());
  const {url,init,body}=call(f);
  expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
  expect((init.headers as Record<string,string>)['x-goog-api-key']).toBe('TEST-FIXTURE-NOT-A-KEY');
  const parts=body.contents[0].parts;expect(parts[0].text).toBeTypeOf('string');expect(parts[1]).toEqual({inlineData:{mimeType:'image/jpeg',data:'QUJD'}});
  expect(body.generationConfig.responseMimeType).toBe('application/json');expect(body.generationConfig.responseSchema).toEqual(PHOTO_SCHEMA);
  expect(body.generationConfig.thinkingConfig).toEqual({thinkingBudget:0});expect(body.tools).toBeUndefined();
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
 it('rejects invalid JSON',async()=>{await expect(make(reply('not json')).describe(img,sig())).rejects.toThrow();});
});
