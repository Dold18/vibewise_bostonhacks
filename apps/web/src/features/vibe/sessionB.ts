/** Authored Session B presentation v1. Shared Question/Response/Profile stay at 1.0.0.
 * Question + option IDs carry identity through the existing immutable history.
 * Preview state is UI-only and never becomes evidence. */
import { immutable, type GenerationContext, type Question } from './profile.ts';

export type CoffeeScene = 'bakery' | 'nook';
export interface SceneFrame {
 readonly assetId: string;
 readonly src: string;
 readonly alt: string;
 readonly caption: string;
 readonly status: 'original_storyboard';
}
export interface ScenePresentation {
 readonly schema: 'session-b-scene/1';
 readonly type: 'scene_stage';
 readonly step: 'B1' | 'B2';
 readonly scene?: CoffeeScene;
 readonly reference?: { readonly title: string; readonly explanation: string; readonly source: string };
 readonly options: readonly { readonly optionId: string; readonly scene: CoffeeScene; readonly frames: readonly SceneFrame[] }[];
}
const frame=(scene:CoffeeScene,beat:'arrive'|'settle'|'stay'|'leave'):SceneFrame=>({
 assetId:`session-b-v1-${scene}-${beat}`,src:`/quiz-scenes/session-b-v1/${scene}-${beat}.svg`,
 status:'original_storyboard',
 alt:scene==='bakery'?(beat==='arrive'?'Original storyboard: a warm bakery counter, pastry trays, two people chatting and a coffee cup.':(beat==='stay'||beat==='settle')?'Original storyboard of the same bakery: another tray has arrived; the coffee stays at a counter seat.':'Original storyboard: the same bakery counter through its doorway; a takeaway cup is outside.'):(beat==='arrive'?'Original storyboard: a blue-green window nook, an empty chair with a coat, a closed notebook and coffee.':(beat==='stay'||beat==='settle')?'Original storyboard of the same window nook: daylight has shifted across the table; the notebook stays closed.':'Original storyboard: the same blue-green nook seen through its doorway; a takeaway cup is outside.'),
 caption:beat==='arrive'?(scene==='bakery'?'Coffee arrives. A customer and server share a laugh while a tray is arranged.':'Coffee within reach. A coat on the other chair. The notebook can stay closed.'):(beat==='stay'||beat==='settle')?(scene==='bakery'?'Another tray comes out. You are still sitting comfortably, watching the room.':'The light moves across the table. You stay; the closed notebook asks nothing.'): 'Take the coffee with you and step outside. A reset, then back to your day.',
});
const b1:Question=immutable({id:'session-b/v1/B1',family:'opening_scene',topic:'comfort',prompt:'Your brain has closed 47 tabs. Where does it go?',cultural:false,options:[
 {id:'bakery',label:'Let the room do something.',description:'I want a bakery counter with a little everyday activity to watch, without a task to do.',preference:'want'},
 {id:'nook',label:'I would like to become furniture.',description:'I want a quiet window nook, coffee within reach and space to put my tasks aside.',preference:'want'},
]});
const b2=(scene:CoffeeScene):Question=>immutable({id:`session-b/v1/B2/${scene}`,family:'social_story',topic:'pace',prompt:scene==='bakery'?'The next tray comes out. Is this a pit stop or the afternoon?':'The light moves across your table. Is this a pit stop or the afternoon?',cultural:false,options:[
 {id:`${scene}-stay`,label:'Let the afternoon happen here.',description:`Keep the ${scene==='bakery'?'bakery counter and everyday activity':'quiet window nook'}; I want comfortable seating and an unhurried stay with my coffee.`,preference:'want'},
 {id:`${scene}-leave`,label:'Reset, then back out.',description:`Keep the ${scene==='bakery'?'bakery atmosphere':'quiet nook for a short pause'}; I want a brief coffee stop before heading back outside.`,preference:'want'},
]});
const questions:readonly Question[]=[b1,b2('bakery'),b2('nook')];
/** Exact identity check: model-generated IDs cannot attach art to different prose/evidence. */
export function canonicalSceneQuestion(q:Question):boolean {
 const canonical=questions.find(x=>x.id===q.id);
 return !!canonical&&q.family===canonical.family&&q.topic===canonical.topic&&q.prompt===canonical.prompt&&q.cultural===canonical.cultural&&q.options.length===canonical.options.length&&q.options.every((o,i)=>o&&o.id===canonical.options[i].id&&o.label===canonical.options[i].label&&o.description===canonical.options[i].description&&o.preference===canonical.options[i].preference);
}
export function selectedCoffeeScene(c:Pick<GenerationContext,'history'>):CoffeeScene|undefined {
 const first=c.history[0];
 return first&&canonicalSceneQuestion(first.question)&&first.question.id===b1.id&&first.response.kind==='choice'&&(first.response.optionId==='bakery'||first.response.optionId==='nook')?first.response.optionId:undefined;
}
/** Product decision 2026-11-22: "Coffee. Brain's fried." uses the same adaptive Gemini-driven quiz as
 * every other input. The authored opener is retired (off by default); its storyboards remain in the
 * media registry for suitable questions, and canonical history replays still validate. */
let authoredOpener=false;
/** Test/prototype hook only. */
export function setAuthoredSessionB(enabled:boolean){authoredOpener=enabled;}
/** Bounded trigger; do not turn arbitrary café requests into this authored demo. */
export function sessionBQuestion(c:GenerationContext):Question|undefined {
 if(!authoredOpener)return;
 const input=c.originalInput.text.toLowerCase().replace(/[’']/g,'').replace(/[^a-z]+/g,' ').trim();
 if(input!=='coffee brains fried')return;
 if(c.history.length===0)return b1;
 const scene=selectedCoffeeScene(c);
 if(c.history.length===1&&scene)return questions.find(q=>q.id===`session-b/v1/B2/${scene}`);
 // Neutral answers / own-word corrections return to ordinary contextual generation.
}
export function scenePresentation(q:Question):ScenePresentation|undefined {
 if(!canonicalSceneQuestion(q))return;
 if(q.id===b1.id)return immutable({schema:'session-b-scene/1',type:'scene_stage',step:'B1',options:(['bakery','nook'] as const).map(scene=>({optionId:scene,scene,frames:[frame(scene,'arrive')]}))});
 const scene:CoffeeScene=q.id.endsWith('/bakery')?'bakery':'nook';
 return immutable({schema:'session-b-scene/1',type:'scene_stage',step:'B2',scene,
 ...(scene==='bakery'?{reference:{title:"A little Kiki's Delivery Service bakery comfort? No delivery shift required.",explanation:"Haven't seen it? Think a small bakery with everyday life going on around you. An optional comparison, not a recreated film set.",source:'https://www.ghibli.jp/works/majo/'}}:{}),
 options:[{optionId:`${scene}-stay`,scene,frames:[frame(scene,'arrive'),frame(scene,'settle'),frame(scene,'stay')]},{optionId:`${scene}-leave`,scene,frames:[frame(scene,'arrive'),frame(scene,'leave')]}]});
}
