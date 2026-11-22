import type { GenerationContext, Question, Topic } from './profile.ts';
/** Presentation families guide prose, never a second venue-feature catalog. */
export const TOPICS: readonly Topic[] = ['lighting','sound','crowding','setting','texture','pace','social','occasion','discovery','emotion','comfort','design','clarification'];
const definitions = [
 ['cinematic_world','Step through a film frame','Rain-lit neon alley; an eccentric hotel lobby; a sunlit seaside opening shot','Amélie’s playful colors and intimate streets; a wordless late-night city montage; an original candlelit opening scene'],
 ['soundtrack','Score the opening minute','A hazy synth introduction; loose live jazz; bright percussion and open air','A floating dream-pop introduction; crisp house rhythms; a warm acoustic rehearsal'],
 ['doorway','Discover an unmarked door','A hidden listening room; a rooftop garden; a tiny hands-on workshop','An observatory after hours; a lantern-lit courtyard; an arcade glowing after rain'],
 ['objects','Find the object that belongs here','A worn paperback and brass lamp; chrome headphones; a pocket full of arcade tokens','A rain-speckled camera; a hand-thrown mug; a star chart folded into a coat pocket'],
 ['sensory','Let one sensation introduce the scene','Rain tapping glass; warm bread and wood; salt air over a quiet boardwalk','A low bass pulse felt through a floor; cool stone in afternoon shade; the soft click of a projector'],
 ['opening_scene','Choose the first camera shot','A slow close-up of a booth; a wide waterfront frame; a restless street-level tracking shot','A tracking shot through a covered market; a still frame of an empty gallery; a golden-hour rooftop pan'],
 ['unexpected','Choose a welcome interruption','A secret performance; an unexpected art room; a path opening onto water','Someone brings out a board game; an artist invites you to try a print; a hidden staircase reveals a view'],
 ['emotion','Choose the feeling in the final frame','Beautiful melancholy; shared exhilaration; gentle curiosity','Relief after a noisy week; the delight of finding something odd; a sense of cinematic wonder'],
 ['dealbreaker','Name what would break the spell','An elbow-to-elbow crowd; music that buries conversation; a rigid formal atmosphere','Harsh fluorescent light; nowhere comfortable to linger; a scene that feels staged rather than welcoming'],
 ['weather','Let the weather change the story','Rain becomes a warm-window refuge; wind brings a dramatic overlook; clouds lead to a covered garden','A sudden chill changes your destination; mist softens a skyline; sunshine reveals a shaded courtyard'],
 ['photograph','Keep one photograph from the outing','A grainy pool of neon; a soft portrait beside a window; an unusual architectural detail','A tiny table set for two; a colorful wall of handmade objects; the reflection of a late train'],
 ['character','Choose a guide by their plan, not recognition','An observant detective finds a tucked-away room; an inventive tinkerer finds an interactive exhibit; a curious wanderer finds a garden','A charming eccentric plans surprising little stops; a thoughtful host finds a place to linger; an explorer follows an unexpected turn'],
 ['game_world','Borrow an atmosphere from a game','A cozy life-sim village; a luminous sci-fi hub; an overgrown exploration world','A bustling fantasy tavern described without lore; a quiet puzzle garden; a colorful cooperative arcade'],
 ['literary','Open a book at the right scene','A magical-realism courtyard; a used-bookshop mystery; a spare modern travel journal','A warmly detailed neighborhood novel; a dreamlike city fable; an illustrated field guide beside the water'],
 ['social_story','Choose how the evening unfolds with others','Two people trade stories in a booth; a small group makes something; strangers share a performance','A friend introduces you to a tiny gathering; you explore beside someone without rushing; you people-watch from a quiet edge'],
 ['original','Invent a relevant small adventure','Transform an unresolved detail into an unexpected but answerable scene','Borrow an unfamiliar object as a guide; follow a trail of colored light; imagine an invitation written for this outing'],
] as const;
export const FAMILIES = definitions.map(([id,guidance,example,alternative])=>({id,guidance,examples:[example,alternative]}));
export const FAMILY_IDS = new Set(FAMILIES.map(f=>f.id));
export function hash(text: string) { let n=2166136261; for(const c of text) n=Math.imul(n^c.charCodeAt(0),16777619); return n>>>0; }
export function knownTopics(c: GenerationContext): Set<Topic> {
 const text=c.evidence.map(e=>e.text).join(' ').toLowerCase(); const out=new Set<Topic>();
 if(/crowd|packed|uncrowded/.test(text))out.add('crowding'); if(/quiet|loud|music|sound/.test(text))out.add('sound');
 if(/neon|candle|lighting|sunlight/.test(text))out.add('lighting'); if(/outdoor|indoor|waterfront/.test(text))out.add('setting'); return out;
}
export function guidanceFor(c: GenerationContext) {
 const used=new Set(c.history.map(a=>a.question.topic)); const known=knownTopics(c);
 const topics=TOPICS.filter(t=>!used.has(t)&&!known.has(t));
 const last=c.history.at(-1)?.question.family;
 const counts=(id:string)=>c.history.filter(a=>a.question.family===id).length;
 const families=FAMILIES.filter(f=>f.id!==last).sort((a,b)=>counts(a.id)-counts(b.id)||hash(c.sessionId+c.version+a.id)-hash(c.sessionId+c.version+b.id)).slice(0,5);
 return {topics:topics.length?topics:TOPICS.filter(t=>!used.has(t)),families};
}
export function fallbackQuestion(c: GenerationContext): Question|null {
 if(c.history.length>=10)return null;
 const guide=guidanceFor(c); const topic=guide.topics[0]; if(!topic)return null;
 const family=guide.families[0];
 const choices = topic==='crowding' ? [['A private invitation','A small gathering with space to move and no packed room.'],['The city at a distance','Watch an animated street from a calm, uncrowded edge.'],['A shared discovery','Join a small workshop where conversation happens naturally.']]
 : topic==='sound' ? [['The listening-room door','Warm instruments close by, at a level that leaves room to talk.'],['The night-drive introduction','Layered electronic textures and a steady rhythmic pulse.'],['The open-window scene','Street sounds and air moving through a quiet space.']]
 : topic==='lighting' ? [['A pool of amber','Small warm lamps pick out the details and soften the edges.'],['Electric reflections','Saturated color glances off glass and metal, like a night photograph.'],['A bright opening frame','Natural light, clear shapes and an airy sense of space.']]
 : topic==='pace' ? [['A chapter you can linger in','Settle into one inviting place with time for details and conversation.'],['An unexpected side quest','Explore a few surprising corners and keep a sense of movement.'],['A performance worth pausing for','Let one absorbing experience become the center of the outing.']]
 : topic==='texture' ? [['A well-worn story','Weathered wood, paper and objects that feel full of history.'],['A precise future','Clean geometry, glass and a few striking modern details.'],['A handmade surprise','Layered colors, mismatched objects and playful small discoveries.']]
 : topic==='design' ? [['A carefully composed frame','A few deliberate shapes and open space make each detail stand out.'],['A wall full of stories','Layered art, contrasting colors and visual discoveries reward a closer look.'],['A playful visual rhythm','Unexpected shapes and a little asymmetry make the scene feel inventive.']]
 : topic==='social' ? [['A scene for two','An intimate corner where the experience leaves room for one another.'],['A small creative circle','A few friends making, discovering or sharing something together.'],['Your own vantage point','Explore independently and choose when to join in.']]
 : topic==='comfort' ? [['The soft landing','An easy seat, a warm welcome and a place to stay for a while.'],['The intriguing threshold','A little unfamiliarity and surprise make the experience rewarding.'],['The open horizon','Space to wander and choose your own comfortable rhythm.']]
 : topic==='occasion' ? [['A small celebration','Mark something with a memorable but welcoming experience.'],['An ordinary night transformed','Make a familiar evening feel unexpectedly cinematic.'],['A restorative interlude','Leave room to decompress without turning the outing into a production.']]
 : topic==='emotion' ? [['A beautiful mystery','A reflective, slightly eerie scene that invites curiosity.'],['A welcome spark','An optimistic, playful experience with unexpected little delights.'],['A warm memory','Comfort and nostalgia that linger after the evening ends.']]
 : topic==='setting' ? [['A hidden interior','A tucked-away room with layers to notice.'],['An open-air frame','Sky, water or greenery make the surroundings part of the experience.'],['A street-level story','A neighborhood to explore with interesting stops close together.']]
 : topic==='discovery' ? [['The secret room','Find a small, surprising experience behind an ordinary entrance.'],['The broad view','Discover a new perspective across the city or water.'],['The unexpected object','Encounter something creative you can examine or try.']]
 : [['A detail worth following','Follow one unusual detail into a scene that fits the atmosphere you described.'],['A quieter alternate ending','Keep the core mood but leave more room to linger and notice.'],['A surprising new chapter','Keep the essentials and introduce a small creative twist.']];
 const context=c.originalInput.text.trim().slice(0,90);
 const fallbackChoices=family.id==='dealbreaker'?[['A scene that ignores the mood','An atmosphere that overwhelms the particular details you came here to enjoy.'],['An evening without room to choose','A rigid experience that gives you little freedom to settle in or explore.'],['A story with no texture','A generic setting that offers nothing distinctive to notice or remember.']]:choices;
 return {id:`fallback-${c.version}-${topic}`,family:family.id,topic,cultural:false,prompt:`${family.guidance}${context?` — for “${context}”`:''}. Which detail belongs in the scene?`,options:fallbackChoices.map(([label,description],i)=>({id:`option-${i+1}`,label,description,preference:family.id==='dealbreaker'?'avoid':'want'}))};
}
