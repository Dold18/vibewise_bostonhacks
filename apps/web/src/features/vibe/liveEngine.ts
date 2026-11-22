import { constraintsText, embeddingText, evidenceFrom } from './evidence.ts';
import { mapDisplay } from './convergence.ts';
import { fallbackQuestion, guidanceFor } from './families.ts';
import { createProfilePublisher } from './publisher.ts';
import { cosine, immutable, MAX_QUESTIONS, MODEL_KEY, validateVector, type Answer, type EmbeddingProvider, type GenerationContext, type GenerationProvider, type OutingVibeProfile, type Response } from './profile.ts';
import { validateGeneration } from './validation.ts';

export function replay(original:OutingVibeProfile['originalInput'],history:readonly Answer[]) {
 const evidence=evidenceFrom(original.text,history);
 const summary=[...history].reverse().find(a=>a.summaryAfter)?.summaryAfter??original.text;
 const qualifiers=[...history].reverse().find(a=>a.qualifiersAfter)?.qualifiersAfter??[];
 return {evidence,vibe_so_far:summary,qualifiers,askedFamilies:history.map(a=>a.question.family),askedTopics:history.map(a=>a.question.topic)};
}
export function completionFor(p:OutingVibeProfile,recommendation:'finish'|'refine',stable=false):OutingVibeProfile['completion'] {
 if(p.history.length>=MAX_QUESTIONS)return {recommended:true,reason:'maximum',canContinue:false};
 const informative=p.history.filter(a=>a.response.kind==='choice'||a.response.kind==='correction').length;
 const detailed=p.vibe_so_far.trim().split(/\s+/).length>=14;
 const ambiguities=p.qualifiers.length>0;
 if(informative>=3&&detailed&&!ambiguities&&(recommendation==='finish'||stable))return {recommended:true,reason:stable?'stable_and_specific':'sufficient_detail',canContinue:!!guidanceFor(contextFor(p)).topics.length};
 if(!guidanceFor(contextFor(p)).topics.length)return {recommended:true,reason:'no_new_topics',canContinue:false};
 return {recommended:false,reason:'refining',canContinue:true};
}
export function contextFor(p:OutingVibeProfile):GenerationContext { return {sessionId:p.sessionId,version:p.version,originalInput:p.originalInput,vibe_so_far:p.vibe_so_far,history:p.history,evidence:p.evidence,qualifiers:p.qualifiers}; }
export function createLiveVibeSession(generator:GenerationProvider,embedder:EmbeddingProvider,publisher=createProfilePublisher()) {
 let state:OutingVibeProfile|null=null; let generation:AbortController|null=null, embedding:AbortController|null=null;
 let serial=0; let userResults=false; let priorVectors:readonly number[][]=[];
 const own=(id:string,v:number)=>state?.sessionId===id&&state.version===v;
 const publish=(p:OutingVibeProfile)=>{state=immutable(p);publisher.publish(state);};
 const bump=(patch:Partial<OutingVibeProfile>)=>{if(!state)return;generation?.abort();embedding?.abort();publish({...state,...patch,version:++serial,embedding:{status:'idle',modelKey:MODEL_KEY,version:serial}});};
 async function embedCurrent() {
  if(!state)return;
  const text=embeddingText(state.vibe_so_far,state.evidence);if(!text.trim())return;
  embedding?.abort();const abort=new AbortController();embedding=abort;
  const p=state,id=p.sessionId,v=p.version;
  publish({...state,embedding:{status:'pending',modelKey:MODEL_KEY,version:v}});
  try {
   const result=await embedder.embed(text,abort.signal); const vector=validateVector(result.vector,result.modelKey);
   if(!own(id,v)||abort.signal.aborted)return;
   priorVectors=[...priorVectors,vector].slice(-3) as readonly number[][];
   const stable=priorVectors.length===3&&cosine(priorVectors[0],priorVectors[1])>.97&&cosine(priorVectors[1],priorVectors[2])>.97;
   const completion=state!.completion.recommended?state!.completion:completionFor(state!,'refine',stable);
   publish({...state!,completion,phase:completion.recommended&&state!.phase==='question'?'results':state!.phase,embedding:{status:'ready',modelKey:MODEL_KEY,version:v,vector}});
  } catch {
   if(!own(id,v)||abort.signal.aborted)return;
   publish({...state!,embedding:{status:'unavailable',modelKey:MODEL_KEY,version:v,reason:'Semantic matching is temporarily unavailable. Your text and answers are retained.'}});
  }
 }
 async function generateCurrent() {
  if(!state)return;generation?.abort();const abort=new AbortController();generation=abort;
  const p=state,id=p.sessionId,v=p.version,c=contextFor(p);
  try {
   const result=validateGeneration(await generator.generate(c,abort.signal),c);
   if(!own(id,v)||abort.signal.aborted)return;
   const constraints=constraintsText(state!.evidence);
   const summary=[result.vibe_so_far,constraints].filter(Boolean).join(' ');
   const history=state!.history.map((a,i)=>i===state!.history.length-1?{...a,summaryAfter:summary,qualifiersAfter:result.qualifiers,summarySource:'gemini' as const}:a);
   const next={...state!,history,vibe_so_far:summary,qualifiers:result.qualifiers,generation:'gemini' as const,notice:null};
   const completion=completionFor(next,result.continuation);
   const question=completion.canContinue?result.nextQuestion:null;
   const phase=userResults||completion.recommended||!question?'results':'question';
   publish({...next,question,phase,completion:userResults?{...completion,recommended:true,reason:'user_request'}:completion});
   void embedCurrent();
  } catch {
   if(!own(id,v)||abort.signal.aborted)return;
   const question=fallbackQuestion(c), completion=completionFor(state!,'refine');
   publish({...state!,question,phase:userResults||!question?'results':'question',generation:'fallback',completion:userResults?{...completion,recommended:true,reason:'user_request'}:completion,
    notice:'Using a local question while the AI is unavailable. Your last AI summary is unchanged; new answers still update semantic matching.'});
   void embedCurrent();
  }
 }
 function accept(response:Response,replaceIndex?:number) {
  if(!state)return;const question=replaceIndex===undefined?state.question:state.history[replaceIndex]?.question;
  if(!question||replaceIndex===undefined&&(state.phase!=='question'||state.history.length>=MAX_QUESTIONS))return;
  if(response.kind==='choice'&&!question.options.some(o=>o.id===response.optionId))throw Error('Invalid option');
  if(response.kind==='correction'&&(!response.text.trim()||response.text.length>500))throw Error('Correction must be 1–500 characters');
  if(!['choice','skip','neither','unfamiliar','correction'].includes(response.kind))throw Error('Invalid answer');
  const prefix=replaceIndex===undefined?state.history:state.history.slice(0,replaceIndex);
  const history:readonly Answer[]=[...prefix,{id:`answer-${serial+1}`,question,response:structuredClone(response)}];
  const reconstructed=replay(state.originalInput,prefix);if(replaceIndex===undefined){reconstructed.vibe_so_far=state.vibe_so_far;reconstructed.qualifiers=state.qualifiers;}const evidence=evidenceFrom(state.originalInput.text,history);
  userResults=false;if(replaceIndex!==undefined)priorVectors=[];
  bump({...reconstructed,evidence,history,askedFamilies:history.map(a=>a.question.family),askedTopics:history.map(a=>a.question.topic),question:null,phase:'generating',generation:'pending',notice:null,completion:{recommended:false,reason:'refining',canContinue:history.length<MAX_QUESTIONS}});
  void generateCurrent();
 }
 return {
  publisher,getSnapshot:()=>state,
  start(text:string,imageCount=0,sessionId:string=crypto.randomUUID()) {
   generation?.abort();embedding?.abort();userResults=false;priorVectors=[];mapDisplay.setShowAll(false);
   const originalInput={text:text.trim().slice(0,2000),imageCount:Math.max(0,Math.min(5,imageCount)),imageProcessing:'not_sent' as const};
   publish({schemaVersion:'1.0.0',sessionId,version:++serial,originalInput,...replay(originalInput,[]),history:[],qualifiers:[],question:null,phase:'generating',generation:'pending',notice:null,
    embedding:{status:'idle',modelKey:MODEL_KEY,version:serial},completion:{recommended:false,reason:'refining',canContinue:true}});
   void generateCurrent();
  },
  answer:(response:Response)=>accept(response),
  revise(index:number,response:Response){if(!Number.isInteger(index)||index<0||!state||index>=state.history.length)throw Error('Invalid history index');accept(response,index);},
  showMatches(){if(!state)return;userResults=true;publish({...state,phase:'results',completion:{...state.completion,recommended:true,reason:state.history.length>=10?'maximum':'user_request'}});},
  continueRefining(){if(!state||state.history.length>=10||!state.completion.canContinue)return;userResults=false;if(state.question)publish({...state,phase:'question',completion:{...state.completion,recommended:false,reason:'refining'}});else{bump({phase:'generating',generation:'pending'});void generateCurrent();}},
  retry(){if(!state)return;bump({phase:userResults?'results':'generating',generation:'pending'});void generateCurrent();},
  retryEmbedding:embedCurrent,
  clear(){generation?.abort();embedding?.abort();state=null;serial++;mapDisplay.setShowAll(false);publisher.publish(null);},
  destroy(){generation?.abort();embedding?.abort();},
 };
}
export type LiveVibeSession=ReturnType<typeof createLiveVibeSession>;
