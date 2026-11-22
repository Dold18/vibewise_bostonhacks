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
  } else if(a.response.kind==='text') {
   // A free-text answer is the user's own explicit request. It adds evidence; unlike a correction it retracts nothing.
   result.push(...textEvidence(a.response.text,'answer',`text:${i}`).map(e=>({...e,topic:e.topic??a.question.topic})));
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

const NEGATED=/\b(?:absolutely|definitely|really|please)?\s*(?:not|no|never|without|avoid|don't|do not|must not|nothing|nobody)\b/i;
/** Positive MiniLM query. Exclusions are NOT embedded here: measured with the pinned MiniLM,
 * "Exclude: a loud packed dance floor" raised a loud-club description's similarity (0.450 → 0.667),
 * so negated phrases would rank disliked places higher. They go to negativeText instead.
 * Newest positive evidence first, then non-negated summary context (truncation-safe).
 */
export function embeddingText(summary:string,evidence:readonly Evidence[]) {
 const key=(s:string)=>s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
 const seen=new Set<string>();
 const unique=(s:string)=>{const k=key(s);if(!k||seen.has(k))return false;seen.add(k);return true;};
 const wanted=evidence.filter(e=>e.polarity==='want').reverse();
 const lines=wanted.filter(e=>unique(e.text)).map(e=>`${e.source==='correction'?'Correction':'Want'}: ${e.text}`);
 // Only exact clauses from the retained summary, never an invented replacement; skip negated clauses.
 const context=summary.split('Explicit exclusions (keep these):')[0].split(/[,.;\n]|\bbut\b/i).map(s=>s.trim()).filter(s=>!NEGATED.test(s)&&unique(s)&&!evidence.some(e=>key(e.text).includes(key(s)))).join(' ');
 return [...lines,context?`Earlier summary (current explicit evidence takes precedence): ${context}`:''].filter(Boolean).join('\n');
}
/** What the user wants to avoid, phrased positively so MiniLM can recognise it ("no loud music" → "loud music").
 * Ranking subtracts similarity to this; it is never added to the positive query. */
export function negativeText(evidence:readonly Evidence[]) {
 const seen=new Set<string>();
 return evidence.filter(e=>e.polarity!=='want').map(e=>e.text.replace(/^(?:avoid|exclude|veto|keep out)\s*:\s*/i,'').replace(new RegExp(NEGATED.source,'gi'),' ').replace(/\s+/g,' ').trim())
  .filter(t=>t.length>2&&!seen.has(t.toLowerCase())&&!!seen.add(t.toLowerCase())).join('\n');
}
