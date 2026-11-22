import { registerHooks } from 'node:module';
registerHooks({resolve(specifier,context,nextResolve){try{return nextResolve(specifier,context);}catch(e){if(specifier.startsWith('.')&&!/\.[a-z]+$/i.test(specifier))return nextResolve(specifier+'.ts',context);throw e;}}});
// Real pinned MiniLM + real session/evidence path; no venue data or Gemini is used.
import { createMiniLM } from '../server/miniLM.ts';
const { createLiveVibeSession }=await import('../src/features/vibe/liveEngine.ts');
import { cosine,MODEL_KEY } from '../src/features/vibe/profile.ts';
import { writeFileSync } from 'node:fs';
const embedder=createMiniLM(),runs=[];
async function ready(s){const start=Date.now();while(Date.now()-start<60000){const p=s.getSnapshot();if(p.generation!=='pending'&&p.embedding.status==='ready')return p;if(p.embedding.status==='unavailable')throw Error('Real MiniLM unavailable');await new Promise(r=>setTimeout(r,50));}throw Error('Real MiniLM deadline');}
for(const scene of ['bakery','nook'])for(const decision of ['stay','leave']){
 const s=createLiveVibeSession({generate:async()=>{throw Error('Deliberate offline generation; real local embeddings');}},embedder);
 s.start("Coffee. Brain's fried.",0,`real-minilm-${scene}-${decision}`);await ready(s);
 s.answer({kind:'choice',optionId:scene});await ready(s);
 s.answer({kind:'choice',optionId:`${scene}-${decision}`});s.showMatches();const p=await ready(s);
 runs.push({scene,decision,modelKey:p.embedding.modelKey,dimensions:p.embedding.vector.length,norm:Math.hypot(...p.embedding.vector),revision:p.version,embeddingRevision:p.embedding.version,vector:p.embedding.vector});s.destroy();
}
const result={realMiniLM:true,realCatalogVerified:false,modelKey:MODEL_KEY,runs:runs.map(({vector,...r})=>r),contrastingCosine:cosine(runs[0].vector,runs[3].vector)};
writeFileSync('/private/tmp/session-b-real-minilm.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
