import { Router } from 'express';
import { validContext } from '../src/features/vibe/validation.ts';
import { MODEL_KEY, type EmbeddingProvider, type GenerationProvider } from '../src/features/vibe/profile.ts';
import { createGeminiGenerator } from './vibeGemini.ts';
import { createMiniLM } from './miniLM.ts';
export function createVibeRouter(deps:{generator?:GenerationProvider;embedder?:EmbeddingProvider}={}) {
 const reload=()=>{try{process.loadEnvFile(process.env.VIBENTA_ENV_FILE??new URL('../../../.env',import.meta.url));}catch{/* Config can be supplied later without exposing its contents. */}};
 const router=Router(), generator=deps.generator??{generate(context,signal){reload();return createGeminiGenerator({apiKey:process.env.GEMINI_API_KEY,model:process.env.VIBE_GEMINI_MODEL}).generate(context,signal);}},embedder=deps.embedder??createMiniLM();
 const clients=new Map<string,{at:number;count:number}>();let inflight=0;
 router.use((req,res,next)=>{
  const key=req.ip??'local',now=Date.now(),old=clients.get(key),entry=old&&now-old.at<60000?old:{at:now,count:0};
  clients.set(key,entry);if(clients.size>500)for(const [k,v]of clients)if(now-v.at>60000)clients.delete(k);
  if(++entry.count>80||inflight>=4){res.setHeader('Retry-After','5');res.status(429).json({error:'Vibe service is busy; please retry.'});return;}
  inflight++;res.once('close',()=>{inflight--;});next();
 });
 router.get('/status',(_req,res)=>{reload();res.json({geminiConfigured:!!process.env.GEMINI_API_KEY,modelKey:MODEL_KEY});});
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
 return router;
}
