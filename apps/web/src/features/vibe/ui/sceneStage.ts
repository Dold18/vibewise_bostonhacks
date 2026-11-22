import { h } from '../../../discovery/ui/dom';
import { scenePresentation, type SceneFrame } from '../sessionB';
import type { Question } from '../profile';

/** Disposable view state only. None of this is submitted to the session. */
export interface ScenePreviewState { opened: Set<string>; beat: Record<string,number>; failed: Set<string> }
export const emptyScenePreview=():ScenePreviewState=>({opened:new Set(),beat:{},failed:new Set()});
export function renderSceneStage(question:Question,state:ScenePreviewState,commit:(optionId:string)=>void,previous?:string) {
 const presentation=scenePresentation(question);
 if(!presentation)return null;
 const root=h('section',{class:'vb-scene-stage','aria-label':presentation.step==='B1'?'Inspect a coffee scene':'Continue your selected coffee scene','data-scene-step':presentation.step});
 const button=(label:string,run:()=>void,attrs:Record<string,string>={})=>{
  const b=h('button',{type:'button',class:'vb-scene-control',...attrs},label);b.addEventListener('click',run);return b;
 };
 function draw() {
  root.replaceChildren();
  root.append(h('p',{class:'vb-scene-provenance'},'Imagined scene · not a real venue. Original storyboard artwork; temporary visual prototype, pending finished atmospheric art.'));
  if(presentation!.reference) {
   const ref=presentation!.reference;
   root.append(h('details',{class:'vb-scene-reference'},h('summary',{},'Optional film comparison'),h('p',{},ref.title),h('p',{},ref.explanation),h('a',{href:ref.source,target:'_blank',rel:'noopener noreferrer'},'Film identity · Studio Ghibli')));
  }
  for(const item of presentation!.options) {
   const option=question.options.find(o=>o.id===item.optionId)!;
   const opened=state.opened.has(item.optionId);
   const index=Math.min(state.beat[item.optionId]??0,item.frames.length-1);
   const current:SceneFrame=item.frames[index];
   const article=h('article',{class:`vb-scene-option vb-scene-${item.scene}`,'data-scene-option':item.optionId});
   article.append(h('h4',{},option.label));
   const figure=h('figure',{},h('figcaption',{},current.caption));
   if(!state.failed.has(current.assetId)) {
    const img=h('img',{src:current.src,alt:current.alt,width:640,height:360,'data-asset-id':current.assetId});
    img.addEventListener('error',()=>{state.failed.add(current.assetId);img.hidden=true;figure.append(h('p',{class:'vb-scene-fallback',role:'status'},'Image unavailable. Use the scene description below.'));},{once:true});
    figure.prepend(img);
   } else figure.prepend(h('p',{class:'vb-scene-fallback'},'Image unavailable. Use the scene description below.'));
   article.append(figure);
   const inspect=button(opened?'Close preview':'Inspect scene',()=>{if(opened)state.opened.delete(item.optionId);else state.opened.add(item.optionId);draw();root.querySelector<HTMLButtonElement>(`[data-inspect="${item.optionId}"]`)?.focus();},{'data-inspect':item.optionId,'aria-expanded':String(opened),'aria-label':`${opened?'Close':'Inspect'} scene: ${option.label}`});
   article.append(inspect);
   if(opened) {
    const details=h('div',{class:'vb-scene-reveal'},h('p',{},option.description));
    if(item.frames.length>1) {
     details.append(h('p',{class:'vb-scene-beat','aria-live':'polite'},`Moment ${index+1} of ${item.frames.length}`));
     const advance=(delta:number)=>{state.beat[item.optionId]=Math.max(0,Math.min(item.frames.length-1,index+delta));draw();root.querySelector<HTMLButtonElement>(`[data-inspect="${item.optionId}"]`)?.focus();};
     const prev=button('Previous moment',()=>advance(-1),{'data-previous':item.optionId});prev.disabled=index===0;
     const next=button('Next moment',()=>advance(1),{'data-next':item.optionId});next.disabled=index===item.frames.length-1;
     details.append(prev,next);
    }
    const select=button(presentation!.step==='B1'?'Put me here':`${option.label} See matches`,()=>commit(item.optionId),{'data-commit':item.optionId,'aria-pressed':String(previous===item.optionId)});
    select.classList.add('vb-primary-btn');details.append(select);article.append(details);
   }
   root.append(article);
  }
 }
 draw();return root;
}
