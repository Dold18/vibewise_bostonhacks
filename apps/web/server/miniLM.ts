/** Server-only, pinned local MiniLM. No random/placeholder embeddings and no venue access. */
import { pipeline, env, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { MODEL, MODEL_KEY, validateVector } from '../src/features/vibe/profile.ts';
export function createMiniLM() {
 let extractor:Promise<FeatureExtractionPipeline>|null=null;
 const cache=new Map<string,readonly number[]>();
 env.cacheDir=process.env.VIBENTA_MODEL_CACHE??'/private/tmp/vibenta-minilm-cache';
 const load=()=>extractor??=(pipeline('feature-extraction',MODEL.id,{revision:MODEL.revision,dtype:MODEL.dtype,device:'cpu'}) as Promise<FeatureExtractionPipeline>).catch(e=>{extractor=null;throw e;});
 return {async embed(text:string,signal:AbortSignal) {
  signal.throwIfAborted();const cached=cache.get(text);if(cached)return {modelKey:MODEL_KEY,vector:cached};
  const model=await load();signal.throwIfAborted();
  const tensor=await model(text,{pooling:'mean',normalize:true});
  const vector=validateVector(Array.from(tensor.data as Float32Array),MODEL_KEY);signal.throwIfAborted();
  if(cache.size>=128)cache.delete(cache.keys().next().value!);cache.set(text,vector);
  return {modelKey:MODEL_KEY,vector};
 }};
}
