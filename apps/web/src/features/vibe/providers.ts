import { MODEL_KEY, validateVector, type EmbeddingProvider, type GenerationContext, type GenerationProvider } from './profile.ts';
import { validateGeneration } from './validation.ts';
async function post(url:string,body:unknown,signal:AbortSignal,timeout:number) {
 const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.any([signal,AbortSignal.timeout(timeout)])});
 if(!res.ok)throw Error(`Vibe service unavailable (${res.status})`);return res.json();
}
export function apiGenerationProvider():GenerationProvider {return {async generate(c:GenerationContext,signal){return validateGeneration(await post('/api/vibe/generate',c,signal,40000),c);}};}
export function apiEmbeddingProvider():EmbeddingProvider {
 const cache=new Map<string,readonly number[]>();
 const pending=new Map<string,Promise<{modelKey:string;vector:readonly number[]}>>();
 return {async embed(text,signal){
  signal.throwIfAborted();const key=MODEL_KEY+text;const cached=cache.get(key);if(cached)return {modelKey:MODEL_KEY,vector:cached};
  let work=pending.get(key);
  if(!work){work=(async()=>{const r=await post('/api/vibe/embed',{text,modelKey:MODEL_KEY},AbortSignal.timeout(60000),60000);const vector=validateVector(r.vector,r.modelKey);if(cache.size>=100)cache.delete(cache.keys().next().value!);cache.set(key,vector);return {modelKey:MODEL_KEY,vector};})().finally(()=>pending.delete(key));pending.set(key,work);}
  const result=await work;signal.throwIfAborted();return result;
 }};
}
