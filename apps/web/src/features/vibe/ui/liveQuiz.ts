import { scenePresentation, selectedCoffeeScene } from '../sessionB';
import { emptyScenePreview, renderSceneStage, type ScenePreviewState } from './sceneStage';
import { h } from '../../../discovery/ui/dom';
import { createLiveVibeSession, type LiveVibeSession } from '../liveEngine';
import { apiEmbeddingProvider, apiGenerationProvider } from '../providers';
import { mapDisplay } from '../convergence';
import { outingProfiles } from '../publisher';
import type { Answer, OutingVibeProfile, Response } from '../profile';
import './quiz.css';
/** Identify the focused control by role so it can be found again after a re-render. */
function focusKeyIn(root:HTMLElement):string|null {
 const el=document.activeElement;if(!(el instanceof HTMLElement)||!root.contains(el))return null;
 if(el.classList.contains('vb-quiz-prompt'))return 'prompt';
 if(el.classList.contains('vb-quiz-correction'))return 'correction';
 if(el instanceof HTMLButtonElement){const same=[...root.querySelectorAll('button')].filter(b=>b.textContent===el.textContent);return `button:${el.textContent}:${same.indexOf(el)}`;}
 return null;
}
function restoreFocus(root:HTMLElement,key:string|null) {
 if(!key)return;
 let target:HTMLElement|null|undefined;
 if(key==='prompt')target=root.querySelector<HTMLElement>('.vb-quiz-prompt[tabindex]');
 else if(key==='correction')target=root.querySelector<HTMLElement>('.vb-quiz-correction');
 else {const [,text,index]=key.match(/^button:(.*):(\d+)$/s)??[];target=[...root.querySelectorAll('button')].filter(b=>b.textContent===text)[Number(index)];}
 (target??root).focus({preventScroll:true});
}
export function createLiveQuiz(onBack:()=>void) {
 const session=createLiveVibeSession(apiGenerationProvider(),apiEmbeddingProvider(),outingProfiles);
 const root=h('section',{class:'vb-live-quiz','aria-label':'Vibe quiz',tabindex:'-1',hidden:true});
 let editing:number|null=null;let active=false;let lastQuestion='';
 const previews=new Map<string,ScenePreviewState>();
 const button=(text:string,run:()=>void,className='vb-text-btn')=>{const b=h('button',{type:'button',class:className},text);b.addEventListener('click',run);return b;};
 const respond=(response:Response)=>{const index=editing;editing=null;if(index===null)session.answer(response);else session.revise(index,response);};
 function render(p:OutingVibeProfile|null) {
  // Snapshots re-render this view (e.g. embedding status updates). Keep the
  // user's place: focused control and any half-typed correction survive.
  const focusKey=focusKeyIn(root),draft=root.querySelector<HTMLTextAreaElement>('.vb-quiz-correction')?.value??'',draftFor=lastQuestion;
  root.replaceChildren();root.removeAttribute('aria-busy');if(!p)return;
  const back=button('Back to vibe description',()=>{active=false;onBack();});
  root.append(h('div',{class:'vb-quiz-top'},back,h('span',{class:'vb-quiz-count'},`${p.history.length} answered · up to 10`)));
  const selected=selectedCoffeeScene(p);
  if(selected)root.append(h('p',{class:'vb-scene-selected','data-selected-scene':selected},`Selected environment: ${selected==='bakery'?'bakery counter':'window nook'}. You can change it in answer history.`));
  if(p.notice)root.append(h('p',{class:'vb-quiz-notice',role:'status'},p.notice),button('Try AI again',()=>session.retry()));
  if(p.phase==='generating'){root.setAttribute('aria-busy','true');root.append(h('p',{class:'vb-quiz-loading',role:'status','aria-live':'polite'},h('span',{class:'vb-quiz-spinner','aria-hidden':'true'}),p.history.length===0?'Writing your first question…':'Finding the next detail in your scene…'));}
  const question=editing===null?p.question:p.history[editing]?.question;
  if((p.phase==='question'||editing!==null)&&question) {
   const title=h('h3',{class:'vb-quiz-prompt',tabindex:'-1'},question.prompt);root.append(title);
   const presentation=scenePresentation(question);
   if(presentation) {
    const key=`${p.sessionId}:${question.id}:${editing??'current'}`;
    if(!previews.has(key))previews.set(key,emptyScenePreview());
    const previous=editing===null?undefined:p.history[editing]?.response;
    const stage=renderSceneStage(question,previews.get(key)!,optionId=>{
     respond({kind:'choice',optionId});
     // The visible B2 commit explicitly says See matches; use the existing user exit,
     // preserving automatic stopping thresholds and asynchronous summary guards.
     if(presentation.step==='B2')session.showMatches();
    },previous?.kind==='choice'?previous.optionId:undefined);
    if(stage)root.append(stage);
   } else {
    const cards=h('div',{class:'vb-quiz-answers'});
    for(const option of question.options)cards.append(button('',()=>respond({kind:'choice',optionId:option.id}),'vb-quiz-answer'));
    [...cards.children].forEach((card,i)=>card.append(h('strong',{},question.options[i].label),h('span',{},question.options[i].description)));
    root.append(cards);
   }
   const neutral=h('div',{class:'vb-quiz-neutral'},button('Skip',()=>respond({kind:'skip'})),button('Neither / something else',()=>respond({kind:'neither'})));
   if(question.cultural)neutral.append(button('I don’t know these',()=>respond({kind:'unfamiliar'})));root.append(neutral);
   const correction=h('textarea',{class:'vb-textarea vb-quiz-correction',rows:2,maxlength:500,placeholder:'Or tell us what feels right…','aria-label':'Your own answer or correction'});
   if(draft&&draftFor===question.id)correction.value=draft;
   const correct=button('Use my words',()=>{if(correction.value.trim())respond({kind:'correction',text:correction.value.trim()});});root.append(correction,correct);
   // A new question takes focus. Query at run time: a later render in the same tick may have replaced this title.
   if(active&&lastQuestion!==question.id){lastQuestion=question.id;queueMicrotask(()=>{if(active&&!root.hidden&&root.offsetParent!==null)root.querySelector<HTMLElement>('.vb-quiz-prompt[tabindex]')?.focus();});}
  }
  if(p.phase==='results'&&editing===null) {
   const toggle=button(mapDisplay.showAll?'Show ranked places':'Show all places',()=>mapDisplay.setShowAll(!mapDisplay.showAll));
   toggle.setAttribute('aria-pressed',String(mapDisplay.showAll));root.append(toggle);
   root.append(h('h3',{class:'vb-quiz-prompt'},p.completion.reason==='maximum'?'Your scene, in ten answers.':'Your outing, coming into focus.'),h('p',{class:'vb-quiz-results-note'},'You can explore the map now. Personalized venue matches will appear when compatible venue descriptions are available.'));
   if(p.completion.canContinue&&p.history.length<10)root.append(button('Continue Refining',()=>session.continueRefining(),'vb-primary-btn'));
  }
  if(p.history.length) {
   const last=p.history.at(-1)!;
   if(last.response.kind==='choice'&&scenePresentation(last.question)) {
    const chosen=last.question.options.find(o=>last.response.kind==='choice'&&o.id===last.response.optionId);
    root.append(h('p',{class:'vb-scene-readback'},`You chose: ${chosen?.description??''}`),button('Not quite',()=>{editing=p.history.length-1;lastQuestion='';render(session.getSnapshot());root.querySelector<HTMLTextAreaElement>('.vb-quiz-correction')?.focus();}));
   }
  }
  root.append(h('section',{class:'vb-quiz-summary','aria-label':'Evolving vibe summary'},h('h4',{},'Your vibe so far'),h('p',{},p.vibe_so_far||'Your scene will develop as you answer.')));
  const exclusions=p.evidence.filter(e=>e.polarity!=='want');
  if(exclusions.length)root.append(h('div',{class:'vb-quiz-exclusions'},h('strong',{},'Keeping in mind'),...exclusions.map(e=>h('span',{},e.text))));
  if(p.qualifiers.length)root.append(h('p',{class:'vb-quiz-notice'},`Still open: ${p.qualifiers.join(' · ')}`));
  root.append(h('p',{class:'vb-quiz-semantic-status',role:'status'},p.embedding.status==='ready'?'Semantic profile updated.':p.embedding.status==='pending'?'Updating the semantic profile…':p.embedding.status==='unavailable'?'Semantic matching is temporarily unavailable. Your answers are safe.':'Your text and answers are saved in this session.'));
  if(p.embedding.status==='unavailable')root.append(button('Retry semantic update',()=>void session.retryEmbedding()));
  const history=h('details',{class:'vb-quiz-history'},h('summary',{},'Review or edit answers'));
  p.history.forEach((answer:Answer,i)=>{
   const label=answer.response.kind==='choice'?answer.question.options.find(o=>answer.response.kind==='choice'&&o.id===answer.response.optionId)?.label:answer.response.kind==='correction'?answer.response.text:answer.response.kind;
   history.append(button(`${i+1}. ${label??'Answer'} — Edit`,()=>{editing=i;lastQuestion='';render(session.getSnapshot());}));
  });root.append(history);
  root.append(button('Start over',()=>{editing=null;previews.clear();session.start(p.originalInput.text,p.originalInput.imageCount);}));
  const matches=button('Show My Matches',()=>{editing=null;session.showMatches();},'vb-primary-btn vb-quiz-matches');root.append(matches);
  if(editing!==null)root.append(button('Cancel edit',()=>{editing=null;render(session.getSnapshot());}));
  if(p.originalInput.imageCount)root.append(h('p',{class:'vb-quiz-photo-note'},'Your photos stay in this browser. This quiz uses your text; photos are not uploaded or analyzed.'));
  restoreFocus(root,focusKey);
 }
 const off=outingProfiles.subscribe(render);
 const offDisplay=mapDisplay.subscribe(()=>render(session.getSnapshot()));
 return {root,session:session as LiveVibeSession,start(text:string,imageCount:number){active=true;editing=null;previews.clear();session.start(text,imageCount);},resume(){active=true;render(session.getSnapshot());},focus(){const target=root.querySelector<HTMLElement>('.vb-quiz-prompt[tabindex]')??root;target.focus();target.scrollIntoView?.({block:'nearest'});},destroy(){active=false;off();offDisplay();session.clear();session.destroy();}};
}
