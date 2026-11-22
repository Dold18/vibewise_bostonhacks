import type { ProfilePublisher } from './publisher.ts';
import { cosine, immutable, MODEL_KEY, preferenceScore, validateVector, type OutingVibeProfile } from './profile.ts';
import type { VibeKey, VibeScores } from '../account/vibes';
/** PR #32 boundary only: its compiler/assets are not assumed to exist. */
export interface SceneIntent { schemaVersion:'1.0.0';sessionVersion:number;presets:readonly {id:string;weight:number}[];descriptors:readonly string[];overrides:readonly {key:string;value:string;intensity?:number}[] }
const words:Record<VibeKey,RegExp>={cozy:/cozy|warm|comfort|book|amber/i,lively:/energetic|electric|upbeat|lively|dance/i,upscale:/elegant|polished|luxur/i,divey:/gritty|underground|raw|indie/i,aesthetic:/cinematic|neon|visual|art|dream/i,quiet:/quiet|calm|peaceful|conversation/i,date_night:/romantic|candle|intimate/i,group_friendly:/friends|small group|shared/i,late_night:/late.night|midnight|noir/i,outdoor:/outdoor|water|garden|sky|trees/i};
export function sceneFor(profile:OutingVibeProfile):{profile:OutingVibeProfile;intent:SceneIntent;preview:VibeScores} {
 const text=profile.evidence.filter(e=>e.polarity==='want').map(e=>e.text).join(' ');
 const preview:VibeScores={};for(const [key,pattern] of Object.entries(words))if(pattern.test(text))preview[key as VibeKey]=1;
 // These are existing account palette keys used for temporary visual preview, never venue-ranking features.
 return immutable({profile,intent:{schemaVersion:'1.0.0',sessionVersion:profile.version,presets:[],descriptors:Object.keys(preview),overrides:[]},preview});
}
export function subscribeScene(publisher:ProfilePublisher,consume:(scene:ReturnType<typeof sceneFor>|null)=>void){return publisher.subscribe(p=>consume(p?sceneFor(p):null));}
export interface SemanticCandidate { id:string;location:{lat:number;lng:number};embedding:readonly number[];modelKey:string;eligible:boolean;provenance:'catalog'|'fixture' }
export interface Ranking { sessionId:string;version:number;status:'ready'|'unavailable';reason?:string;all:readonly {id:string;location:{lat:number;lng:number};score:number;scale:number;weak:boolean}[];provenance:'catalog'|'fixture'|null }
// The exclusion penalty is shared with the final catalog search (profile.ts preferenceScore).
export { AVOID_WEIGHT } from './profile.ts';
/** Never invent venue vectors or compare unknown model spaces. Caller owns hard-filter eligibility. */
export function rankCandidates(p:OutingVibeProfile,candidates:readonly SemanticCandidate[]):Ranking {
 const unavailable=(reason:string):Ranking=>({sessionId:p.sessionId,version:p.version,status:'unavailable',reason,all:[],provenance:null});
 if(p.embedding.status!=='ready'||!p.embedding.vector)return unavailable('Semantic matching is waiting for MiniLM.');
 if(!candidates.length)return unavailable('Venue embeddings are not connected. Your quiz and scene preview still work.');
 let query:number[];try{query=validateVector(p.embedding.vector,p.embedding.modelKey);}catch{return unavailable('Incompatible query embedding');}
 const eligible=candidates.filter(c=>c.eligible);
 if(eligible.some(c=>c.modelKey!==MODEL_KEY))return unavailable('Catalog model metadata is incompatible or unverified.');
 // Explicit dislikes subtract similarity to what the user excluded (MiniLM cannot read negation inside one query).
 let negative:number[]|undefined;try{negative=p.embedding.negativeVector?validateVector(p.embedding.negativeVector,p.embedding.modelKey):undefined;}catch{return unavailable('Incompatible exclusion embedding');}
 let rows:Ranking['all'];try{rows=eligible.map(c=>{const v=validateVector(c.embedding,c.modelKey);return {id:c.id,location:{...c.location},score:preferenceScore(cosine(query,v),negative?cosine(negative,v):undefined),scale:1,weak:false};}).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));}catch{return unavailable('Invalid catalog embeddings');}
 const best=rows[0]?.score??0,worst=rows.at(-1)?.score??best,spread=best-worst;
 return immutable({sessionId:p.sessionId,version:p.version,status:'ready',provenance:eligible.some(c=>c.provenance==='fixture')?'fixture':'catalog',all:rows.map(c=>{const relative=spread>.02?(c.score-worst)/spread:1;return {...c,scale:.7+.55*relative,weak:relative<.12};})});
}
export function subscribeRecommendations(publisher:ProfilePublisher,getCandidates:()=>readonly SemanticCandidate[],consume:(ranking:Ranking|null)=>void){return publisher.subscribe(p=>consume(p?rankCandidates(p,getCandidates()):null));}
export function safePinAppearance(ranking:Ranking|null,id:string,focus:'discovery'|'search'|'navigation',showAll=false) {
 if(focus!=='discovery'||ranking?.status!=='ready')return {scale:1,hidden:false};
 const row=ranking.all.find(r=>r.id===id);return row?{scale:row.scale,hidden:!showAll&&row.weak}:{scale:1,hidden:false};
}
