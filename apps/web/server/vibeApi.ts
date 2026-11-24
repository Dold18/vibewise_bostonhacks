import { Router } from 'express';
import { validContext } from '../src/features/vibe/validation.ts';
import { MODEL_KEY, validateVector, type EmbeddingProvider, type GenerationProvider } from '../src/features/vibe/profile.ts';
import { parseSearchRequest, type SearchResponse } from '../src/features/vibe/searchContract.ts';
import { createSupabaseCatalog, rankRestaurants, type CatalogProvider } from './catalogIndex.ts';
import { createGeminiGenerator } from './vibeGemini.ts';
import { createMiniLM } from './miniLM.ts';
export function createVibeRouter(deps:{generator?:GenerationProvider;embedder?:EmbeddingProvider;catalog?:CatalogProvider}={}) {
 const reload=()=>{try{process.loadEnvFile(process.env.VIBENTA_ENV_FILE??new URL('../../../.env',import.meta.url));}catch{/* Config can be supplied later without exposing its contents. */}};
 // Public deployments must never spend a collaborator's Gemini quota. Vercel sets
 // VERCEL, and other production hosts normally set NODE_ENV=production. Local
 // development is opt-in, with a developer-owned key in an ignored .env file.
 const isPublicRuntime=()=>process.env.VERCEL!==undefined||process.env.NODE_ENV==='production';
 const localGeminiEnabled=()=>{
  if(isPublicRuntime())return false; // Do not even load a Gemini key on public requests.
  reload();
  return process.env.VIBE_ENABLE_LOCAL_GEMINI==='true'&&!!process.env.GEMINI_API_KEY;
 };
 const router=Router(), generator=deps.generator??{generate(context,signal){
  if(!localGeminiEnabled())return Promise.reject(new Error('Gemini disabled in public demo'));
  return createGeminiGenerator({apiKey:process.env.GEMINI_API_KEY,model:process.env.VIBE_GEMINI_MODEL}).generate(context,signal);
 }},embedder=deps.embedder??createMiniLM();
 // Catalog search reads the same Supabase project as the browser, with the same publishable key
 // (SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY, falling back to the VITE_ names the browser uses).
 let envCatalog:{id:string;provider:CatalogProvider}|null=null;
 const catalogFor=():CatalogProvider|null=>{
  if(deps.catalog)return deps.catalog;
  reload();
  const url=process.env.SUPABASE_URL??process.env.VITE_SUPABASE_URL,key=process.env.SUPABASE_PUBLISHABLE_KEY??process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if(!url||!key)return null;
  const id=`${url}|${key}`;
  if(envCatalog?.id!==id)envCatalog={id,provider:createSupabaseCatalog({url,key})};
  return envCatalog.provider;
 };
 const clients=new Map<string,{at:number;count:number}>();let inflight=0;
 router.use((req,res,next)=>{
  const key=req.ip??'local',now=Date.now(),old=clients.get(key),entry=old&&now-old.at<60000?old:{at:now,count:0};
  clients.set(key,entry);if(clients.size>500)for(const [k,v]of clients)if(now-v.at>60000)clients.delete(k);
  if(++entry.count>80||inflight>=4){res.setHeader('Retry-After','5');res.status(429).json({error:'Vibe service is busy; please retry.'});return;}
  inflight++;res.once('close',()=>{inflight--;});next();
 });
 router.get('/status',(_req,res)=>res.json({geminiConfigured:localGeminiEnabled(),modelKey:MODEL_KEY,quizMode:localGeminiEnabled()?'local-developer-gemini':'public-demo-fallback'}));
 router.post('/generate',async(req,res)=>{
  if(!validContext(req.body)){res.status(400).json({error:'Invalid bounded quiz context'});return;}
  const abort=new AbortController();res.on('close',()=>abort.abort());
  try {res.json(await generator.generate(req.body,abort.signal));}catch{if(!res.headersSent&&!res.destroyed)res.status(503).json({error:'Question generation unavailable. Local fallback is available.'});}
 });
 router.post('/embed',async(req,res)=>{
  const {text,modelKey}=req.body??{};
  if(typeof text!=='string'||!text.trim()||text.length>8000||modelKey!==MODEL_KEY){res.status(400).json({error:'Invalid text or incompatible MiniLM model'});return;}
  const abort=new AbortController();res.on('close',()=>abort.abort());
  try {res.json(await embedder.embed(text,abort.signal));}catch{if(!res.headersSent&&!res.destroyed)res.status(503).json({error:'MiniLM unavailable. Text remains usable.'});}
 });
 router.post('/search',async(req,res)=>{
  const parsed=parseSearchRequest(req.body);
  if(!parsed.ok){res.status(400).json({error:parsed.error});return;}
  const catalog=catalogFor();
  if(!catalog){res.status(503).json({error:'Catalog search is not configured.'});return;}
  const {query,filters,limit}=parsed.value;
  const abort=new AbortController();res.on('close',()=>abort.abort());
  try {
   // A text query is embedded here with the pinned MiniLM; a vector was already validated against MODEL_KEY on parse.
   const vector=query.kind==='vector'?query.vector:validateVector((await embedder.embed(query.text,abort.signal)).vector,MODEL_KEY);
   const rows=await catalog.restaurants(abort.signal);
   const ranked=rankRestaurants(rows,vector,filters,limit);
   const body:SearchResponse={modelKey:MODEL_KEY,candidates:ranked.candidates,indexed:rows.length,filtersApplied:ranked.filtersApplied,results:ranked.results};
   res.json(body);
  }catch{if(!res.headersSent&&!res.destroyed)res.status(503).json({error:'Search unavailable. Please retry.'});}
 });
 return router;
}
