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
// Topic affinities keep each presentation mechanic grounded in an outing decision.
const affinities:Record<string,readonly Topic[]>={
 cinematic_world:['lighting','setting','emotion'],soundtrack:['sound','pace'],doorway:['discovery','setting'],objects:['texture','design'],sensory:['comfort','texture','sound'],opening_scene:['setting','pace','lighting'],unexpected:['discovery','social'],emotion:['emotion','occasion'],dealbreaker:['crowding','comfort','sound'],weather:['comfort','setting'],photograph:['design','lighting'],character:['social','pace'],game_world:['pace','discovery'],literary:['texture','emotion'],social_story:['social','occasion'],original:['occasion','clarification'],
};
function relevance(id:string,c:GenerationContext) {
 const text=c.evidence.filter(e=>e.polarity==='want').map(e=>e.text).join(' ')||c.originalInput.text;
 const cues:Record<string,RegExp>={cinematic_world:/cinema|film|neon/i,soundtrack:/music|energy|rhythm/i,doorway:/mystery|hidden|eerie/i,objects:/nostalg|memory|vintage/i,sensory:/quiet|soft|sensory/i,opening_scene:/outdoor|afternoon|water/i,unexpected:/playful|surprise/i,emotion:/romantic|feeling/i,dealbreaker:/avoid|never/i,weather:/rain|sun|weather/i,photograph:/photo|visual/i,character:/friend|character/i,game_world:/game|quest/i,literary:/book|story/i,social_story:/date|together/i,original:/cannot|unsure|unnamed/i};
 return cues[id]?.test(text)?1:0;
}
export function guidanceFor(c: GenerationContext) {
 const used=new Set(c.history.map(a=>a.question.topic)); const known=knownTopics(c);
 const topics=TOPICS.filter(t=>!used.has(t)&&!known.has(t));
 const last=c.history.at(-1)?.question.family;
 const counts=(id:string)=>c.history.filter(a=>a.question.family===id).length;
 const seed=c.originalInput.text+c.evidence.map(e=>e.text).join('|');
 const families=FAMILIES.filter(f=>f.id!==last).sort((a,b)=>counts(a.id)-counts(b.id)||relevance(b.id,c)-relevance(a.id,c)||hash(seed+c.version+a.id)-hash(seed+c.version+b.id)).slice(0,5);
 return {topics:topics.length?topics:TOPICS.filter(t=>!used.has(t)),families};
}
/** Each family has its own interaction: edit a film, sequence a track, open a
 * sealed clue, equip a quest, restore a memory... No cultural trivia required. */
function presentation(family:string,topic:Topic,variant:number) {
 const t=topic==='social'?'companionship':topic==='clarification'?'missing detail':topic;
 const scripts:Record<string,readonly [string,readonly string[]][]>={
 cinematic_world:[[`You are restoring a lost film set in Boston. Only its ${t} notes survived. Pick the frame to rebuild for your outing.`,['Restored frame A','Restored frame B','Restored frame C']],[`A director offers three alternate worlds for tonight. Read the ${t} notes, then choose the world you would actually step into.`,['World one','World two','World three']]],
 soundtrack:[[`Soundcheck for your outing: the ${t} is still undecided. These tracks have scene notes instead of titles. Put one first on the playlist.`,['Track 01','Track 02','Track 03']],[`Your evening needs a B-side. Match the ${t} in its sleeve notes to the experience you want. Which record goes on?`,['Side A','Side B','The hidden track']]],
 doorway:[[`An envelope contains three keys and a ${t} clue for each. Only one door becomes your next stop. Turn a key.`,['The brass key','The blue key','The crooked key']],[`A blank door has three messages slipped underneath it. Each promises a different ${t} inside. Which message earns a knock?`,['The folded note','The postcard','The wax seal']]],
 objects:[[`Pack one object for your outing's imaginary time capsule. Its attached note describes the ${t} you want to remember. What goes in?`,['A keepsake','A curious tool','A found treasure']],[`A lost-property drawer holds three clues to your ideal stop. Use their ${t} notes to decide which object could be yours.`,['The worn ticket','The silver token','The painted box']]],
 sensory:[[`Close your eyes at the first stop. The ${t} reaches you before its name does. Follow the sensation that makes you stay.`,['First impression','Second impression','Third impression']],[`Build a little field recording of tonight without a camera. Choose the ${t} sensation that should fill its first ten seconds.`,['Take one','Take two','Take three']]],
 opening_scene:[[`Storyboard the first thirty seconds of your outing. The camera can make only one move to establish ${t}. Call the opening shot.`,['Hold the close-up','Move through the scene','Reveal the wide shot']],[`The opening shot is missing from your evening's trailer. Which ${t} direction belongs on the camera operator's card?`,['Camera card A','Camera card B','Camera card C']]],
 unexpected:[[`Halfway through the outing, your plan acquires a detour. Choose the ${t} surprise worth changing course for.`,['Accept the invitation','Follow the clue','Take the side path']],[`A friend texts: “Small change of plan.” Read the ${t} promises below and send back the detour you would welcome.`,['Reply with a yes','Ask for the pin','Meet around the corner']]],
 emotion:[[`Tomorrow you leave yourself a voice memo about tonight. Which ${t} memory deserves the closing line?`,['Save this feeling','Remember this spark','Keep this moment']],[`Write the last sentence of your outing before it starts. Which ${t} ending would make the trip worthwhile?`,['Ending A','Ending B','Ending C']]],
 dealbreaker:[[`Your outing has one veto card. Spend it on the ${t} problem that would make you leave, even if everything else looked right.`,['Veto this','Keep this out','Cancel for this']],[`Before the imaginary invitation goes to print, cross out one ${t} condition that must never be part of tonight.`,['Cross out A','Cross out B','Cross out C']]],
 weather:[[`A weather alert interrupts your outing. Your backup stop can preserve one kind of ${t}. Which refuge gets the last reservation?`,['Plan for drizzle','Plan for a chill','Plan for a bright sky']],[`The forecast changes halfway there. Choose the ${t} you want your new shelter to preserve.`,['Shelter one','Shelter two','Shelter three']]],
 photograph:[[`You have one exposure left on a disposable camera. Read the ${t} notes and choose what deserves your final photograph of the outing.`,['Expose frame one','Expose frame two','Expose frame three']],[`Lay three imaginary contact prints on a table. Which ${t} note belongs under the photograph you would keep from tonight?`,['Circle print A','Circle print B','Circle print C']]],
 character:[[`Your guide need not be famous: a patient observer, a restless scout, or an inventive host. Their plans reveal ${t}. Whose plan do you accept?`,['The observer’s plan','The scout’s plan','The host’s plan']],[`Cast a companion for a tiny Boston adventure. Judge each character by the ${t} they arrange for you, rather than by a name or a costume.`,['Cast the archivist','Cast the explorer','Cast the maker']]],
 game_world:[[`Tonight is a game with no score to chase. Equip one quest card; its ${t} notes describe the real outing it unlocks.`,['Equip the lantern quest','Equip the compass quest','Equip the workshop quest']],[`You reached a save point before heading out. Choose the ${t} reward that makes this next small quest worth playing.`,['Unlock a refuge','Unlock a new route','Unlock an encounter']]],
 literary:[[`A library book has three possible first paragraphs for your outing. Follow the ${t} in the margin notes and turn one page.`,['Open chapter one','Open the travel journal','Open the illustrated tale']],[`Someone has penciled three ${t} notes into a story about tonight. Which note would you carry out of the book and into Boston?`,['Keep the first margin note','Keep the second margin note','Keep the third margin note']]],
 social_story:[[`Send one invitation for tonight. Each draft promises a different ${t} experience. Choose the invitation you would mean.`,['Send the first draft','Send the second draft','Send the third draft']],[`The group chat pauses for your decision. Complete “Let's make tonight about…” with the ${t} plan that fits.`,['A plan to linger','A plan to share','A plan to explore']]],
 original:[[`A tiny Boston museum offers to exhibit an hour of your future evening. Choose the ${t} note on its display card.`,['Display case one','Display case two','Display case three']],[`An imaginary city bureau grants one small wish for your outing. Choose the ${t} promise you would put on the form.`,['Stamp this wish','Stamp this possibility','Stamp this surprise']]],
 };
 return scripts[family][variant%2];
}
export function fallbackQuestion(c: GenerationContext): Question|null {
 if(c.history.length>=10)return null;
 const guide=guidanceFor(c);if(!guide.topics.length)return null;
 const family=guide.families[0];
 const topic=affinities[family.id].find(t=>guide.topics.includes(t))??guide.topics[0];
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
 const vetoes:Partial<Record<Topic,string[][]>>={
 crowding:[['An elbow-to-elbow room','A packed space without room to move or find a calm edge.'],['A compulsory mixer','An activity that requires you to interact with a large group of strangers.'],['A long crowded queue','Spending the outing waiting shoulder to shoulder rather than enjoying the stop.']],
 sound:[['Music over conversation','Music so loud that you have to shout to hear one another.'],['An intrusive broadcast','Screens and announcements repeatedly interrupting the atmosphere.'],['Unbroken silence','A place where even a quiet conversation would feel unwelcome.']],
 comfort:[['Nowhere to settle','A stop without a comfortable place to pause during your outing.'],['A rigid welcome','Formal rules that make it difficult to relax and enjoy being there.'],['Constant interruptions','An experience that keeps rushing you on before you can settle in.']],
 };
 const fallbackChoices=family.id==='dealbreaker'?(vetoes[topic]??choices.map(([label,description])=>[`Avoid: ${label}`,`Keep this experience out of my outing: ${description}`])):choices;
 const [script,roles]=presentation(family.id,topic,hash(c.originalInput.text+family.id));
 const last=c.history.at(-1);
 const selected=last?.response.kind==='choice'?last.question.options.find(o=>last.response.kind==='choice'&&o.id===last.response.optionId)?.label:last?.response.kind==='correction'?last.response.text:undefined;
 // The selected detail is context, never an inference about unselected options.
 const bridge=selected?` Carrying forward “${selected.slice(0,65)}”.`:'';
 return {id:`fallback-${c.version}-${topic}`,family:family.id,topic,cultural:false,prompt:`${script}${context?` For “${context}”.`:''}${bridge}`,options:fallbackChoices.map(([label,description],i)=>({id:`option-${i+1}`,label:`${roles[i]}: ${label}`.slice(0,100),description,preference:family.id==='dealbreaker'?'avoid':'want'}))};
}
