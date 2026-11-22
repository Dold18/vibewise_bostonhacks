import { FAMILY_IDS, guidanceFor, TOPICS } from './families.ts';
import type { GenerationContext, GenerationResult, Question } from './profile.ts';
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown,max:number,min=1):v is string=>typeof v==='string'&&v.trim().length>=min&&v.length<=max;
export function validContext(v:unknown):v is GenerationContext {
 if(!obj(v)||!text(v.sessionId,100)||!Number.isInteger(v.version)||Number(v.version)<1||!obj(v.originalInput)||!text(v.originalInput.text,2000,0)||!Number.isInteger(v.originalInput.imageCount)||Number(v.originalInput.imageCount)<0||Number(v.originalInput.imageCount)>5||v.originalInput.imageProcessing!=='not_sent'||!Array.isArray(v.history)||v.history.length>10||!text(v.vibe_so_far,6000,0)||!Array.isArray(v.evidence)||v.evidence.length>70||!Array.isArray(v.qualifiers)||v.qualifiers.length>8)return false;
 return v.history.every(a=>obj(a)&&validQuestion(a.question)&&obj(a.response)&&['choice','skip','neither','unfamiliar','correction'].includes(String(a.response.kind))&&(a.response.kind!=='choice'||text(a.response.optionId,80))&&(a.response.kind!=='correction'||text(a.response.text,500)))&&v.evidence.every(e=>obj(e)&&text(e.id,100)&&text(e.text,2200)&&['want','avoid','dealbreaker'].includes(String(e.polarity)))&&v.qualifiers.every(q=>text(q,250));
}
export function validQuestion(q:unknown):q is Question {
 if(!obj(q)||!text(q.id,80)||!text(q.family,40)||!FAMILY_IDS.has(q.family as never)||!TOPICS.includes(q.topic as never)||!text(q.prompt,500,20)||typeof q.cultural!=='boolean'||!Array.isArray(q.options)||q.options.length<2||q.options.length>4)return false;
 return q.options.every(o=>obj(o)&&text(o.id,80)&&text(o.label,100,3)&&text(o.description,350,20)&&['want','avoid'].includes(String(o.preference)))&&new Set(q.options.map(o=>o.id)).size===q.options.length&&new Set(q.options.map(o=>String(o.label).toLowerCase())).size===q.options.length;
}
const normalized=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export function validateGeneration(v:unknown,c:GenerationContext):GenerationResult {
 if(!obj(v)||!text(v.vibe_so_far,1800,10)||!Array.isArray(v.qualifiers)||v.qualifiers.length>8||!v.qualifiers.every(x=>text(x,250))||!['refine','finish'].includes(String(v.continuation))||!text(v.reason,300))throw Error('Invalid structured vibe response');
 if(v.nextQuestion!==null) {
  if(!validQuestion(v.nextQuestion))throw Error('Invalid question/options'); const q=v.nextQuestion;
  const guide=guidanceFor(c);
  if(c.history.at(-1)?.response.kind==='unfamiliar'&&q.cultural)throw Error('Use a culturally neutral question after unfamiliarity');
  const avoidCrowds=c.evidence.some(e=>e.polarity!=='want'&&/crowd|packed/i.test(e.text));
  if(avoidCrowds&&q.options.some(o=>o.preference==='want'&&/\b(crowded|packed|elbow.to.elbow)\b/i.test(o.description)&&!/(?:not|no|without|avoid|un)\s*(?:a |the |too )?(?:crowd|packed)/i.test(o.description)))throw Error('An option contradicts an explicit crowd exclusion');
  if(!guide.families.some(f=>f.id===q.family)||!guide.topics.includes(q.topic))throw Error('Repeated or irrelevant family/topic');
  if(c.history.some(a=>a.question.id===q.id||normalized(a.question.prompt)===normalized(q.prompt)||a.question.topic===q.topic))throw Error('Repeated semantic question');
  if(/^(?:do you prefer|are you more|would you rather be) (?:quiet|loud|indoor|outdoor|vintage|modern|relax|excit)/i.test(q.prompt))throw Error('Generic personality question');
  const meanings=q.options.map(o=>new Set(normalized(o.description).split(' ').filter(w=>w.length>3)));
  for(let i=0;i<meanings.length;i++)for(let j=0;j<i;j++){const a=meanings[i],b=meanings[j],intersection=[...a].filter(w=>b.has(w)).length;if(intersection/Math.max(1,new Set([...a,...b]).size)>.8)throw Error('Answers are near synonyms');}
 }
 return v as unknown as GenerationResult;
}
