import type { ProfilePublisher } from './publisher';
import { rankCandidates,safePinAppearance,type Ranking,type SemanticCandidate } from './adapters';
export const mapDisplay={showAll:false,setShowAll(value:boolean){this.showAll=value;for(const f of displaySubscribers)f();}};
const displaySubscribers=new Set<()=>void>();
export function createConvergence(publisher:ProfilePublisher,load:(signal:AbortSignal)=>Promise<readonly SemanticCandidate[]>,apply:(r:Ranking|null)=>void) {
 let latest:Ranking|null=null;let abort:AbortController|null=null;let revision=0;
 const render=()=>apply(latest);displaySubscribers.add(render);
 const refresh=async()=>{
  abort?.abort();const seq=++revision,p=publisher.getSnapshot();
  if(!p){latest=null;render();return;}
  latest=rankCandidates(p,[]);render();if(p.embedding.status!=='ready')return;
  const request=new AbortController();abort=request;
  try {const candidates=await load(request.signal);if(seq!==revision||request.signal.aborted)return;latest=rankCandidates(p,candidates);render();}catch{if(seq!==revision||request.signal.aborted)return;latest=rankCandidates(p,[]);render();}
 };
 const off=publisher.subscribe(()=>{void refresh();});
 return {refresh,destroy(){off();abort?.abort();revision++;displaySubscribers.delete(render);},appearance:(id:string,mode:'discovery'|'search'|'navigation')=>safePinAppearance(latest,id,mode,mapDisplay.showAll)};
}
