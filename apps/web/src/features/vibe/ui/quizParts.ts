/** Presentation-only pieces shared by the quiz renderers (Vibewise V3). */
import { h } from '../../../discovery/ui/dom';

/** V3 answer spine: one stop per completed answer plus the current open stop. Decorative; the count text is the accessible value. */
export function answerSpine(answered:number,open:boolean){
 const spine=h('span',{class:'vb-quiz-spine','aria-hidden':'true'});
 for(let i=0;i<answered;i++)spine.append(h('i',{class:'vb-quiz-stop'}));
 if(open)spine.append(h('i',{class:'vb-quiz-stop is-current'}));
 return spine;
}
const LETTERS='ABCDEFGH';
/** Letter badge for answer cards (aria-hidden, so names and textContent-based lookups are unchanged in meaning). */
export const answerLetter=(i:number)=>h('span',{class:'vb-quiz-answer-no','aria-hidden':'true'},LETTERS[i]??String(i+1));
