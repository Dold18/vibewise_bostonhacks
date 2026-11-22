import type { Answer, Evidence, Topic } from './profile.ts';
const topicFor=(s:string):Topic|undefined=> /crowd|packed|people/.test(s)?'crowding':/noise|quiet|loud|music/.test(s)?'sound':/light|neon|candle/.test(s)?'lighting':/outdoor|indoor|waterfront/.test(s)?'setting':undefined;
export function textEvidence(text:string,source:Evidence['source'],prefix:string): Evidence[] {
 const clauses=text.split(/[,.;\n]|\bbut\b/i).map(s=>s.trim()).filter(Boolean);
 return clauses.map((s,i)=>({id:`${prefix}:${i}`,text:s,source,kind:'explicit',polarity:/\b(?:absolutely|never|must not)\b.*\b(?:not|crowd|noise)|\bnever\b/i.test(s)?'dealbreaker':/\b(?:not|no|without|avoid|never|don't|do not)\b/i.test(s)?'avoid':'want',topic:topicFor(s.toLowerCase())}));
}
export function evidenceFrom(original:string,history:readonly Answer[]): Evidence[] {
 let result=textEvidence(original,'original','original');
 history.forEach((a,i)=>{
  if(a.response.kind==='choice') {
   const option=a.question.options.find(o=>a.response.kind==='choice'&&o.id===a.response.optionId);
   if(option)result.push({id:`answer:${i}`,text:`${option.label}: ${option.description}`,source:'answer',kind:'explicit',polarity:option.preference==='avoid'?'avoid':'want',topic:a.question.topic});
  } else if(a.response.kind==='correction') {
   const correction=textEvidence(a.response.text,'correction',`correction:${i}`); const topics=new Set(correction.flatMap(e=>e.topic?[e.topic]:[]));
   const retract=new Set(a.response.retract??[]);
   result=result.filter(e=>!retract.has(e.id)&&!(e.topic&&topics.has(e.topic)));
   result.push(...correction);
  }
 }); return result;
}
export function constraintsText(evidence:readonly Evidence[]) {
 const avoid=evidence.filter(e=>e.polarity!=='want').map(e=>e.text);
 return avoid.length?`Explicit exclusions (keep these): ${avoid.join('; ')}.`:'';
}
