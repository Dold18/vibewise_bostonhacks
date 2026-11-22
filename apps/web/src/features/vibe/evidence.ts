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

/** Explicit evidence is authoritative; the preserved AI summary supplies context only.
 * Keep exclusions first, then the newest corrections/preferences, before prose that
 * the model tokenizer may truncate. Deduplicate without dropping constraint clauses.
 */
export function embeddingText(summary:string,evidence:readonly Evidence[]) {
 const key=(s:string)=>s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
 const seen=new Set<string>();
 const unique=(s:string)=>{const k=key(s);if(!k||seen.has(k))return false;seen.add(k);return true;};
 const ordered=[...evidence.filter(e=>e.polarity!=='want'),...evidence.filter(e=>e.polarity==='want').reverse()];
 const lines=ordered.filter(e=>unique(e.text)).map(e=>`${e.polarity==='dealbreaker'?'Dealbreaker':e.polarity==='avoid'?'Exclude':e.source==='correction'?'Correction':'Want'}: ${e.text}`);
 // Avoid repeating verbatim evidence already present in the summary. Never invent
 // a replacement summary: these are only exact clauses from the retained text.
 const context=summary.split('Explicit exclusions (keep these):')[0].split(/[,.;\n]|\bbut\b/i).map(s=>s.trim()).filter(s=>unique(s)&&!evidence.some(e=>key(e.text).includes(key(s)))).join(' ');
 return [...lines,context?`Earlier summary (current explicit evidence takes precedence): ${context}`:''].filter(Boolean).join('\n');
}
