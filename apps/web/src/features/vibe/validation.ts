import { canonicalSceneQuestion, sessionBQuestion } from './sessionB.ts';
import { FAMILY_IDS, guidanceFor, TOPICS } from './families.ts';
import { presentationSessionError, presentationShapeError } from './media/presentation.ts';
import { MAX_CORRECTION_TEXT } from './photoMessage.ts';
import type { GenerationContext, GenerationResult, Question } from './profile.ts';
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown,max:number,min=1):v is string=>typeof v==='string'&&v.trim().length>=min&&v.length<=max;
export function validContext(v:unknown):v is GenerationContext {
 if(!obj(v)||!text(v.sessionId,100)||!Number.isInteger(v.version)||Number(v.version)<1||!obj(v.originalInput)||!text(v.originalInput.text,2000,0)||!Number.isInteger(v.originalInput.imageCount)||Number(v.originalInput.imageCount)<0||Number(v.originalInput.imageCount)>1||!['not_sent','described'].includes(String(v.originalInput.imageProcessing))||!Array.isArray(v.history)||v.history.length>10||!text(v.vibe_so_far,6000,0)||!Array.isArray(v.evidence)||v.evidence.length>70||!Array.isArray(v.qualifiers)||v.qualifiers.length>8)return false;
 return v.history.every(a=>obj(a)&&validQuestion(a.question)&&obj(a.response)&&['choice','skip','neither','unfamiliar','correction','text'].includes(String(a.response.kind))&&(a.response.kind!=='choice'||text(a.response.optionId,80))&&(a.response.kind!=='correction'||text(a.response.text,MAX_CORRECTION_TEXT))&&(a.response.kind!=='text'||text(a.response.text,500)))&&v.evidence.every(e=>obj(e)&&text(e.id,100)&&text(e.text,2200)&&['want','avoid','dealbreaker'].includes(String(e.polarity)))&&v.qualifiers.every(q=>text(q,250));
}
export function validQuestion(q:unknown):q is Question { return !questionError(q); }
/** Why a question is invalid, phrased so the repair attempt knows what to fix. */
export function questionError(q:unknown):string|undefined {
 if(!obj(q))return 'nextQuestion must be an object';
 if(!text(q.id,80))return 'id must be 1–80 characters';
 if(!text(q.family,40)||!FAMILY_IDS.has(q.family as never))return `family must be one of: ${[...FAMILY_IDS].join(', ')}`;
 if(!TOPICS.includes(q.topic as never))return `topic must be one of: ${TOPICS.join(', ')}`;
 if(!text(q.prompt,500,20))return 'prompt must be 20–500 characters';
 if(typeof q.cultural!=='boolean')return 'cultural must be a boolean';
 if(!Array.isArray(q.options)||q.options.length<2||q.options.length>4)return 'use 2–4 options';
 if(q.id.startsWith('session-b/')&&!canonicalSceneQuestion(q as unknown as Question))return 'session-b ids are reserved';
 const shape=presentationShapeError(q as unknown as Question);if(shape)return shape;
 for(const o of q.options){
  if(!obj(o)||!text(o.id,80))return 'each option needs an id of 1–80 characters';
  if(!text(o.label,100,3))return `option label "${String(o.label).slice(0,40)}" must be 3–100 characters`;
  if(!text(o.description,350,20))return `option description for "${String(o.label).slice(0,40)}" must be 20–350 characters`;
  if(!['want','avoid'].includes(String(o.preference)))return 'option preference must be want or avoid';
 }
 if(new Set(q.options.map(o=>o.id)).size!==q.options.length)return 'option ids must be distinct';
 if(new Set(q.options.map(o=>String(o.label).toLowerCase())).size!==q.options.length)return 'option labels must be distinct';
}
const normalized=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export function validateGeneration(v:unknown,c:GenerationContext):GenerationResult {
 if(!obj(v)||!text(v.vibe_so_far,1800,10)||!Array.isArray(v.qualifiers)||v.qualifiers.length>8||!v.qualifiers.every(x=>text(x,250))||!['refine','finish'].includes(String(v.continuation))||!text(v.reason,300))throw Error('Invalid structured vibe response');
 if(v.nextQuestion!==null) {
  const invalid=questionError(v.nextQuestion);if(invalid)throw Error(`Invalid question: ${invalid}`); const q=v.nextQuestion as Question;
  const guide=guidanceFor(c);
  if(c.history.at(-1)?.response.kind==='unfamiliar'&&q.cultural)throw Error('Use a culturally neutral question after unfamiliarity');
  const avoidCrowds=c.evidence.some(e=>e.polarity!=='want'&&/crowd|packed/i.test(e.text));
  if(avoidCrowds&&q.options.some(o=>o.preference==='want'&&/\b(crowded|packed|elbow.to.elbow)\b/i.test(o.description)&&!/(?:not|no|without|avoid|un)\s*(?:a |the |too )?(?:crowd|packed)/i.test(o.description)))throw Error('An option contradicts an explicit crowd exclusion');
  const authored=sessionBQuestion(c);
  if(q.id.startsWith('session-b/')&&q.id!==authored?.id)throw Error('Scene does not continue the selected history');
  if(!canonicalSceneQuestion(q)&&(!guide.topics.includes(q.topic)||(q.presentation?q.family===c.history.at(-1)?.question.family:!guide.families.some(f=>f.id===q.family))))throw Error('Repeated or irrelevant family/topic');
  const shape=presentationShapeError(q);if(shape)throw Error(shape);
  if(!canonicalSceneQuestion(q)){const session=presentationSessionError(q,c.history);if(session)throw Error(session);}
  if(c.history.some(a=>a.question.id===q.id||normalized(a.question.prompt)===normalized(q.prompt)||a.question.topic===q.topic))throw Error('Repeated semantic question');
  if(/^(?:do you prefer|are you more|would you rather be) (?:quiet|loud|indoor|outdoor|vintage|modern|relax|excit)/i.test(q.prompt))throw Error('Generic personality question');
  const meanings=q.options.map(o=>new Set(normalized(o.description).split(' ').filter(w=>w.length>3)));
  for(let i=0;i<meanings.length;i++)for(let j=0;j<i;j++){const a=meanings[i],b=meanings[j],intersection=[...a].filter(w=>b.has(w)).length;if(intersection/Math.max(1,new Set([...a,...b]).size)>.8)throw Error('Answers are near synonyms');}
 }
 return v as unknown as GenerationResult;
}
