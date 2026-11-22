import { scenePresentation, selectedCoffeeScene } from '../sessionB';
import { emptyScenePreview, renderSceneStage, type ScenePreviewState } from './sceneStage';
import { emptyMediaView, renderMediaStage, type MediaViewState } from './mediaStage';
import { presentationOf } from '../media/presentation';
import { h } from '../../../discovery/ui/dom';
import { createLiveVibeSession, type LiveVibeSession } from '../liveEngine';
import { apiEmbeddingProvider, apiGenerationProvider } from '../providers';
import { mapDisplay } from '../convergence';
import { outingProfiles } from '../publisher';
import type { Answer, OutingVibeProfile, Response } from '../profile';
import { photoAccess } from '../photoAccess';
import { noPhotoAccessMessage, photoClient } from '../photoClient';
import { prepareMessage } from '../photoSend';
import { hasPhotoLine, MAX_TYPED_TEXT } from '../photoMessage';
import { createPhotoAttachment, type PhotoAttachmentState } from './photoAttachment';
import './quiz.css';
/** Identify the focused control by role so it can be found again after a re-render. */
function focusKeyIn(root:HTMLElement):string|null {
 const el=document.activeElement;if(!(el instanceof HTMLElement)||!root.contains(el))return null;
 if(el.classList.contains('vb-quiz-prompt'))return 'prompt';
 if(el.classList.contains('vb-quiz-correction'))return 'correction';
 if(el.classList.contains('vb-media-freetext'))return 'freetext';
 // Its label changes while a photo is read, so find it by class, not text.
 if(el.classList.contains('vb-quiz-use-words'))return 'use-words';
 if(el.classList.contains('vb-media-send'))return 'media-send';
 if(el.closest('.vb-photo-attachment'))return 'photo';
 if(el instanceof HTMLButtonElement){const same=[...root.querySelectorAll('button')].filter(b=>b.textContent===el.textContent);return `button:${el.textContent}:${same.indexOf(el)}`;}
 return null;
}
function restoreFocus(root:HTMLElement,key:string|null) {
 if(!key)return;
 let target:HTMLElement|null|undefined;
 if(key==='prompt')target=root.querySelector<HTMLElement>('.vb-quiz-prompt[tabindex]');
 else if(key==='correction')target=root.querySelector<HTMLElement>('.vb-quiz-correction');
 else if(key==='freetext')target=root.querySelector<HTMLElement>('.vb-media-freetext');
 else if(key==='use-words')target=root.querySelector<HTMLElement>('.vb-quiz-use-words');
 else if(key==='media-send')target=root.querySelector<HTMLElement>('.vb-media-send');
 // Picking or removing a photo swaps Add photo for Remove (or back): land on whichever is there now.
 else if(key==='photo')target=root.querySelector<HTMLElement>('.vb-photo-attachment button:not(:disabled)')??root.querySelector<HTMLElement>('.vb-quiz-use-words');
 else {const [,text,index]=key.match(/^button:(.*):(\d+)$/s)??[];target=[...root.querySelectorAll('button')].filter(b=>b.textContent===text)[Number(index)];}
 (target??root).focus({preventScroll:true});
}
export function createLiveQuiz(onBack:()=>void) {
 const session=createLiveVibeSession(apiGenerationProvider(),apiEmbeddingProvider(),outingProfiles);
 const root=h('section',{class:'vb-live-quiz','aria-label':'Vibe quiz',tabindex:'-1',hidden:true});
 // One live region for photo messages that re-renders never remove, so a new message is announced.
 const photoAnnouncer=h('p',{class:'vb-photo-announcer',role:'status','aria-live':'polite'});root.append(photoAnnouncer);
 let editing:number|null=null;let active=false;let lastQuestion='';let lastSignature='';
 const previews=new Map<string,ScenePreviewState>();
 const mediaViews=new Map<string,MediaViewState>();
 // The own-words photo draft lives here, not in the DOM, so it survives the
 // re-renders snapshots cause. Keyed like `previews`; a new key starts empty.
 let photoDraft:{key:string;state:PhotoAttachmentState;via?:'correction'|'text'}|null=null;let attachment:{root:HTMLElement;destroy():void}|null=null;
 /** Key of the question on screen (null when none is shown): same session, question and edit slot. */
 const questionKey=(p:OutingVibeProfile|null)=>{const q=!p?null:editing===null?(p.phase==='question'?p.question:null):p.history[editing]?.question;return p&&q?`${p.sessionId}:${q.id}:${editing??'current'}`:null;};
 const button=(text:string,run:()=>void,className='vb-text-btn')=>{const b=h('button',{type:'button',class:className},text);b.addEventListener('click',run);return b;};
 // Photo-draft changes leave the profile untouched, so they must skip the unchanged-signature shortcut.
 const refresh=()=>{lastSignature='';render(session.getSnapshot());};
 const respond=(response:Response)=>{const index=editing;editing=null;if(index===null)session.answer(response);else session.revise(index,response);};
 const statusText=(p:OutingVibeProfile)=>p.embedding.status==='ready'?'Semantic profile updated.':p.embedding.status==='pending'?'Updating the semantic profile…':p.embedding.status==='unavailable'?'Semantic matching is temporarily unavailable. Your answers are safe.':'Your text and answers are saved in this session.';
 function render(p:OutingVibeProfile|null) {
  // Embedding progress alone must not rebuild the question: that would restart a playing
  // YouTube player, reset a reveal/slider and drop focus from a half-typed answer.
  const signature=p?JSON.stringify([p.sessionId,p.phase,p.question?.id,p.history.length,p.history.map(a=>a.response),p.vibe_so_far,p.qualifiers,p.notice,p.generation,p.completion,p.embedding.status==='unavailable',editing,mapDisplay.showAll]):'';
  const status=root.querySelector<HTMLElement>('.vb-quiz-semantic-status');
  if(p&&signature===lastSignature&&status){status.textContent=statusText(p);return;}
  lastSignature=signature;
  // Snapshots re-render this view (e.g. embedding status updates). Keep the
  // user's place: focused control and any half-typed correction survive.
  const focusKey=focusKeyIn(root),draft=root.querySelector<HTMLTextAreaElement>('.vb-quiz-correction')?.value??'',draftFor=lastQuestion;
  // Destroy the replaced attachment only after its successor exists, so the shared thumbnail URL is kept, not revoked and re-made.
  const replaced=attachment;attachment=null;
  const key=questionKey(p);if(photoDraft?.key!==key)photoDraft=key?{key,state:{file:null,description:null,status:null,busy:false}}:null;
  for(const child of [...root.childNodes])if(child!==photoAnnouncer)child.remove();root.removeAttribute('aria-busy');if(!p){photoAnnouncer.textContent='';replaced?.destroy();return;}
  // Controls that answer, move or leave the question; disabled while its photo is read so the read is never discarded.
  const locked:HTMLButtonElement[]=[];const lock=<T extends HTMLButtonElement>(b:T)=>{locked.push(b);return b;};
  // The quiz palette mirrors the latest interpretation (presentation only; the map follows the publisher).
  const moodSource=[p.question,...[...p.history].reverse().map(a=>a.question)].find(q=>q&&presentationOf(q));
  const mood=moodSource?presentationOf(moodSource)!.mood:undefined;if(mood)root.dataset.mood=mood;else delete root.dataset.mood;
  const back=lock(button('Back to vibe description',()=>{active=false;onBack();}));
  root.append(h('div',{class:'vb-quiz-top'},back,h('span',{class:'vb-quiz-count'},`${p.history.length} answered · up to 10`)));
  const selected=selectedCoffeeScene(p);
  if(selected)root.append(h('p',{class:'vb-scene-selected','data-selected-scene':selected},`Selected environment: ${selected==='bakery'?'bakery counter':'window nook'}. You can change it in answer history.`));
  if(p.notice)root.append(h('p',{class:'vb-quiz-notice',role:'status'},p.notice),lock(button('Try AI again',()=>session.retry())));
  if(p.phase==='generating'){root.setAttribute('aria-busy','true');root.append(h('p',{class:'vb-quiz-loading',role:'status','aria-live':'polite'},h('span',{class:'vb-quiz-spinner','aria-hidden':'true'}),p.history.length===0?'Writing your first question…':'Finding the next detail in your scene…'));}
  const question=editing===null?p.question:p.history[editing]?.question;
  if((p.phase==='question'||editing!==null)&&question&&key&&photoDraft) {
   const title=h('h3',{class:'vb-quiz-prompt',tabindex:'-1'},question.prompt);root.append(title);
   const presentation=scenePresentation(question);
   const media=presentationOf(question);
   // Own words: text, a photo, or both, from the own-words box or a free-text question's box. Both
   // share one photo draft. The words are read-only while the photo is read, so what is sent is what is shown.
   const draftState=photoDraft,photo=draftState.state,draftKey=key;
   const sendOwnWords=async(text:string,kind:'correction'|'text')=>{
    if(photo.busy)return;
    // A photo kept from before signing out is not sent until the user signs in again.
    const file=photoAccess.status()==='signed_in'?photo.file:null;
    // Not signed in with only a photo: nothing can be sent, so say why rather than ask for words or a photo.
    if(!file&&photo.file&&!text.trim()){photo.status={text:noPhotoAccessMessage(photoAccess.status()),kind:'error'};refresh();return;}
    photo.busy=true;photo.status=null;draftState.via=kind;if(file)refresh();
    const isCurrent=()=>photoDraft?.state===photo&&questionKey(session.getSnapshot())===draftKey;
    const result=await prepareMessage({text,photo:file,question:question.prompt,client:photoClient,isCurrent});
    if(!isCurrent())return; // Stale: the question changed and its own view has rendered.
    if(result.ok){
     photoDraft=null;
     if(kind==='correction'){const box=root.querySelector<HTMLTextAreaElement>('.vb-quiz-correction');if(box)box.value='';}
     else{const view=mediaViews.get(draftKey);if(view)view.draft='';}
     respond({kind,text:result.text});return;
    }
    // Keep the draft (words and photo) with the reason: retry, or remove the photo and send the words.
    photo.busy=false;photo.status={text:result.message,kind:result.reason==='empty'?'info':'error'};refresh();
   };
   const readingVia=(kind:'correction'|'text')=>photo.busy&&!!photo.file&&draftState.via===kind;
   attachment=createPhotoAttachment({state:photo,access:photoAccess,signInLabel:'Sign in to answer with a photo',announcer:photoAnnouncer,onFile:file=>{photo.file=file;photo.description=file?photoClient.cached(file,question.prompt)??null:null;refresh();}});
   // A free-text question's own box is the natural place for the photo; otherwise it sits with the own-words box.
   const photoInStage=media?.format==='free_text';
   if(media) {
    if(!mediaViews.has(key))mediaViews.set(key,emptyMediaView());
    const freeText=photoInStage?{attachment:attachment.root,busy:photo.busy,reading:readingVia('text'),hasPhoto:()=>!!photo.file,send:(text:string)=>void sendOwnWords(text,'text')}:undefined;
    const stage=renderMediaStage(question,mediaViews.get(key)!,respond,editing===null?undefined:p.history[editing]?.response,freeText);
    if(stage){root.append(stage);stage.querySelectorAll<HTMLButtonElement>('button[data-option]').forEach(lock);}
   } else if(presentation) {
    if(!previews.has(key))previews.set(key,emptyScenePreview());
    const previous=editing===null?undefined:p.history[editing]?.response;
    const stage=renderSceneStage(question,previews.get(key)!,optionId=>{
     respond({kind:'choice',optionId});
     // The visible B2 commit explicitly says See matches; use the existing user exit,
     // preserving automatic stopping thresholds and asynchronous summary guards.
     if(presentation.step==='B2')session.showMatches();
    },previous?.kind==='choice'?previous.optionId:undefined);
    if(stage){root.append(stage);stage.querySelectorAll<HTMLButtonElement>('button[data-commit]').forEach(lock);}
   } else {
    const cards=h('div',{class:'vb-quiz-answers'});
    for(const option of question.options)cards.append(lock(button('',()=>respond({kind:'choice',optionId:option.id}),'vb-quiz-answer')));
    [...cards.children].forEach((card,i)=>card.append(h('strong',{},question.options[i].label),h('span',{},question.options[i].description)));
    root.append(cards);
   }
   const neutral=h('div',{class:'vb-quiz-neutral'},lock(button('Skip',()=>respond({kind:'skip'}))),lock(button('Neither / something else',()=>respond({kind:'neither'}))));
   if(question.cultural)neutral.append(lock(button('I don’t know these',()=>respond({kind:'unfamiliar'}))));root.append(neutral);
   const correction=h('textarea',{class:'vb-textarea vb-quiz-correction',rows:2,maxlength:MAX_TYPED_TEXT,placeholder:'Or tell us what feels right…','aria-label':'Your own answer or correction',readonly:photo.busy});
   if(draft&&draftFor===question.id)correction.value=draft;
   // Always pressable, as before photos: an empty send explains what to add.
   const correct=button(readingVia('correction')?'Reading your photo…':'Use my words',()=>void sendOwnWords(correction.value,'correction'),'vb-text-btn vb-quiz-use-words');
   if(photo.busy)correct.setAttribute('aria-disabled','true');
   root.append(correction,...(photoInStage?[]:[attachment.root]),correct);
   // A new question takes focus. Query at run time: a later render in the same tick may have replaced this title.
   if(active&&lastQuestion!==question.id){lastQuestion=question.id;queueMicrotask(()=>{if(active&&!root.hidden&&root.offsetParent!==null)root.querySelector<HTMLElement>('.vb-quiz-prompt[tabindex]')?.focus();});}
  }
  if(p.phase==='results'&&editing===null) {
   const toggle=button(mapDisplay.showAll?'Show ranked places':'Show all places',()=>mapDisplay.setShowAll(!mapDisplay.showAll));
   toggle.setAttribute('aria-pressed',String(mapDisplay.showAll));root.append(toggle);
   root.append(h('h3',{class:'vb-quiz-prompt'},p.completion.reason==='maximum'?'Your scene, in ten answers.':'Your outing, coming into focus.'),h('p',{class:'vb-quiz-results-note'},'You can explore the map now. Your final matches load from the venue catalog using your budget, starting point and cuisine choices.'));
   if(p.completion.canContinue&&p.history.length<10)root.append(button('Continue Refining',()=>session.continueRefining(),'vb-primary-btn'));
  }
  const reading=p.phase==='question'&&editing===null&&p.question?presentationOf(p.question):undefined;
  if(reading&&p.history.length&&reading.source==='gemini')root.append(h('div',{class:'vb-quiz-reading'},h('p',{},h('strong',{},'What I’ve picked up: '),reading.design.known),lock(button('Not quite',()=>{editing=p.history.length-1;lastQuestion='';render(session.getSnapshot());root.querySelector<HTMLTextAreaElement>('.vb-quiz-correction')?.focus();}))));
  if(p.history.length) {
   const last=p.history.at(-1)!;
   if(last.response.kind==='choice'&&scenePresentation(last.question)) {
    const chosen=last.question.options.find(o=>last.response.kind==='choice'&&o.id===last.response.optionId);
    root.append(h('p',{class:'vb-scene-readback'},`You chose: ${chosen?.description??''}`),lock(button('Not quite',()=>{editing=p.history.length-1;lastQuestion='';render(session.getSnapshot());root.querySelector<HTMLTextAreaElement>('.vb-quiz-correction')?.focus();})));
   }
  }
  root.append(h('section',{class:'vb-quiz-summary','aria-label':'Evolving vibe summary'},h('h4',{},'Your vibe so far'),h('p',{},p.vibe_so_far||'Your scene will develop as you answer.')));
  const exclusions=p.evidence.filter(e=>e.polarity!=='want');
  if(exclusions.length)root.append(h('div',{class:'vb-quiz-exclusions'},h('strong',{},'Keeping in mind'),...exclusions.map(e=>h('span',{},e.text))));
  if(p.qualifiers.length)root.append(h('p',{class:'vb-quiz-notice'},`Still open: ${p.qualifiers.join(' · ')}`));
  root.append(h('p',{class:'vb-quiz-semantic-status',role:'status'},statusText(p)));
  if(p.embedding.status==='unavailable')root.append(button('Retry semantic update',()=>void session.retryEmbedding()));
  const history=h('details',{class:'vb-quiz-history'},h('summary',{},'Review or edit answers'));
  p.history.forEach((answer:Answer,i)=>{
   const label=answer.response.kind==='choice'?answer.question.options.find(o=>answer.response.kind==='choice'&&o.id===answer.response.optionId)?.label:answer.response.kind==='correction'||answer.response.kind==='text'?answer.response.text:answer.response.kind;
   history.append(lock(button(`${i+1}. ${label??'Answer'} — Edit`,()=>{editing=i;lastQuestion='';render(session.getSnapshot());})));
  });root.append(history);
  root.append(lock(button('Start over',()=>{editing=null;previews.clear();mediaViews.clear();session.start(p.originalInput.text,p.originalInput.imageCount);})));
  const matches=lock(button('Show My Matches',()=>{editing=null;session.showMatches();},'vb-primary-btn vb-quiz-matches'));root.append(matches);
  if(editing!==null)root.append(lock(button('Cancel edit',()=>{editing=null;render(session.getSnapshot());})));
  if(p.originalInput.imageCount>0||p.history.some(a=>(a.response.kind==='correction'||a.response.kind==='text')&&hasPhotoLine(a.response.text)))root.append(h('p',{class:'vb-quiz-photo-note'},"Photos are sent to Google Gemini to get a short text description. Vibenta doesn't store them; the description is part of what this quiz uses."));
  if(photoDraft?.state.busy)for(const b of locked)b.disabled=true;
  if(!attachment)photoAnnouncer.textContent='';
  replaced?.destroy();restoreFocus(root,focusKey);
 }
 // Media and scene stages can redraw their own options (Inspect, an image error), so also refuse option clicks while a photo is read.
 root.addEventListener('click',e=>{if(photoDraft?.state.busy&&e.target instanceof Element&&e.target.closest('button[data-option],button[data-commit]')){e.preventDefault();e.stopPropagation();}},true);
 const off=outingProfiles.subscribe(render);
 const offDisplay=mapDisplay.subscribe(()=>render(session.getSnapshot()));
 return {root,session:session as LiveVibeSession,start(text:string,imageCount:number){active=true;editing=null;previews.clear();mediaViews.clear();session.start(text,imageCount);},resume(){active=true;render(session.getSnapshot());},focus(){const target=root.querySelector<HTMLElement>('.vb-quiz-prompt[tabindex]')??root;target.focus();target.scrollIntoView?.({block:'nearest'});},destroy(){active=false;off();offDisplay();attachment?.destroy();attachment=null;photoDraft=null;session.clear();session.destroy();}};
}
