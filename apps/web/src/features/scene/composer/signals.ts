/**
 * Composition signals: everything the composer may know about what the user
 * wants right now, and its interpretation into the continuous style space.
 *
 * Inputs are untrusted (they come from quiz answers, Gemini summaries or free
 * text). `interpretSignals` never throws; unknown words are ignored and listed.
 *
 * Safety rules encoded here:
 * - National/regional cuisines and religious or cultural observances are
 *   *recognized* so they are never misread as style words, but they produce no
 *   style pull and no decoration. Culture-specific assets need verified venue
 *   context or an explicit opt-in (see decor.ts and the layout activation rules).
 * - Dish words describe a dining mode ("noodle soup" ⇒ steam, warmth, a small
 *   counter), never a culture.
 * - Negated words ("not too neon") are treated as things to avoid.
 */
import { SCENE_CATALOG, type SceneCatalog } from '../catalog';
import type { SceneOverride } from '../intent';
import { addPull, clamp, round3, squash, ZERO, type Axis, type Pull, type StyleVector } from './axes';

export type TimeOfDay = 'dawn' | 'morning' | 'midday' | 'afternoon' | 'golden' | 'dusk' | 'night' | 'late_night';
export const TIMES_OF_DAY: readonly TimeOfDay[] = ['dawn', 'morning', 'midday', 'afternoon', 'golden', 'dusk', 'night', 'late_night'];

/** A term with an optional weight (0..1, default 1), e.g. how strongly an answer expressed it. */
export type Term = string | { readonly term: string; readonly weight?: number };

/** Verified facts about a selected venue (from the place catalog, never from the model). */
export interface VenueContext {
  readonly placeId: string;
  /** Only verified facts may activate cuisine/music-specific decorations. */
  readonly verified: boolean;
  readonly cuisines?: readonly string[];
  readonly music?: readonly string[];
  /** A season the venue verifiably observes right now (e.g. a listed winter market). */
  readonly seasonal?: 'winter' | 'spring' | 'summer' | 'autumn' | null;
  /** An observance the *user explicitly asked for* (e.g. "hanukkah"); never inferred. */
  readonly observanceOptIn?: string | null;
}

export interface CompositionSignals {
  readonly mood?: readonly Term[];
  /** What the outing is for: "date", "study", "celebrate", "wander"... */
  readonly experience?: readonly Term[];
  /** Dish or dining words. National cuisines are recognized but not styled. */
  readonly cuisine?: readonly Term[];
  readonly music?: readonly Term[];
  /** Explicit aesthetic words: "brutalist", "storybook", "synthwave"... */
  readonly aesthetic?: readonly Term[];
  /** Free text (quiz evidence, summaries); negation-aware. */
  readonly text?: readonly string[];
  /** Words the user wants to avoid. */
  readonly avoid?: readonly string[];
  readonly timeOfDay?: TimeOfDay | null;
  /** 0 (calm) .. 1 (high energy). */
  readonly energy?: number | null;
  /** 0 (alone / just us) .. 1 (big crowd). */
  readonly social?: number | null;
  /** Explicit stylistic preferences in catalog terms ("make it rain" ⇒ air_and_atmosphere.rain). */
  readonly explicit?: readonly { readonly key: string; readonly value: string; readonly intensity?: number }[];
  /** Quiz progress: answers given and/or the engine's confidence (0..1). */
  readonly progression?: { readonly answers?: number; readonly confidence?: number } | null;
  readonly venue?: VenueContext | null;
}

export interface Recognized {
  readonly channel: string;
  readonly term: string;
  readonly entry: string;
  readonly polarity: 'want' | 'avoid';
}

export interface Interpretation {
  readonly style: StyleVector;
  /** Tags the user's words point at directly (e.g. "rain" ⇒ rain), with weight. */
  readonly hints: Readonly<Record<string, number>>;
  /** Tags the user asked to avoid. */
  readonly avoidTags: Readonly<Record<string, number>>;
  readonly timeOfDay: TimeOfDay | null;
  /** 0..1: how sure the quiz is; scales boldness and decoration density. */
  readonly confidence: number;
  /** 0..1: how present the scene is over the plain map (0 = plain map). */
  readonly presence: number;
  /** 0..1: intensity multiplier for every chosen component. */
  readonly boldness: number;
  readonly explicit: readonly SceneOverride[];
  readonly venue: VenueContext | null;
  readonly recognized: readonly Recognized[];
  /** Recognized cultural/observance terms that deliberately produced no style. */
  readonly culturalTerms: readonly string[];
  readonly ignored: readonly string[];
}

interface Entry {
  readonly id: string;
  /** Token stems; a trailing `$` means an exact token. Phrases use `_` between words. */
  readonly match: readonly string[];
  readonly pull: Pull;
  readonly tags?: Readonly<Record<string, number>>;
}

const e = (id: string, match: string, pull: Pull, tags?: Record<string, number>): Entry => ({ id, match: match.split(' '), pull, tags });

/** Mood, aesthetic, experience and free-text vocabulary. */
const STYLE_WORDS: readonly Entry[] = [
  e('cozy', 'cozy cosy snug hygge comfort homey homely', { warmth: 0.8, intimacy: 0.7, softness: 0.4, energy: -0.3 }, { 'warm-glow': 0.6 }),
  e('warm', 'warm$ warmth$', { warmth: 0.7 }),
  e('calm', 'calm peace tranquil serene relax chill mellow unwind slow$ laid_back', { energy: -0.8, softness: 0.4, chroma: -0.2 }),
  e('quiet', 'quiet solitude alone$ solo$ private hideaway nook secluded', { intimacy: 0.7, energy: -0.6 }),
  e('moody', 'moody brood melanchol wistful pensive somber sombre', { luminance: -0.5, chroma: -0.4, moisture: 0.3, softness: 0.1 }, { cinematic: 0.6 }),
  e('romantic', 'romantic romance tender intimate date$ date_night', { warmth: 0.5, intimacy: 0.9, softness: 0.5, luminance: -0.2 }),
  e('joyful', 'joy happy cheer playful fun$ giddy silly upbeat', { energy: 0.6, chroma: 0.6, luminance: 0.4, softness: 0.2 }),
  e('whimsy', 'whimsi magic fairy enchant dream ethereal surreal otherworld', { softness: 0.8, ornament: 0.4, chroma: 0.2 }, { whimsy: 0.7, sparkle: 0.4 }),
  e('mystery', 'myster enigma secret hidden', { luminance: -0.5, moisture: 0.5, intimacy: 0.4 }, { murk: 0.5 }),
  e('spooky', 'spooky haunt eerie creepy gothic ghost', { luminance: -0.6, era: 0.5, moisture: 0.4, chroma: -0.3 }, { spooky: 1, nocturnal: 0.4 }),
  e('electric', 'electric vibrant bold$ loud wild$ rowdy hype intense', { energy: 0.9, chroma: 0.8 }),
  e('elegant', 'elegant refined classy sophisticat luxur upscale glamor glamour posh fancy fine_dining', { grit: -0.8, ornament: 0.3, chroma: -0.2 }, { luxe: 0.7, glossy: 0.3 }),
  e('gritty', 'gritty raw$ grunge scrappy underground basement diy$ dive$ dives$ divey', { grit: 0.9, chroma: -0.2, luminance: -0.3 }, { grunge: 0.7 }),
  e('nostalgic', 'nostalg vintage retro antique old$ olde$ classic heritage historic timeless', { era: 0.8, chroma: -0.2 }, { retro: 0.6 }),
  e('futurist', 'futur cyber sci$ scifi sci_fi space$ tech$ techno holo chrome', { era: -0.9, chroma: 0.6, luminance: -0.4 }, { futurist: 0.7 }),
  e('neon', 'neon glowing', { chroma: 0.8, luminance: -0.6, era: -0.4, energy: 0.3 }, { neon: 1 }),
  e('minimal', 'minimal modern sleek clean$ crisp contemporar sparse simple$ scandi', { ornament: -0.8, grit: -0.5, era: -0.4 }, { minimal: 0.7, crisp: 0.4 }),
  e('ornate', 'ornate baroque maximal opulent decorat lavish', { ornament: 0.9 }, { ornate: 0.7 }),
  e('nature', 'nature green$ greenery garden forest woods$ woodland leaf leafy botanic park$ parks$ outdoor fresh_air trees$', { nature: 0.9, luminance: 0.2 }, { verdant: 0.8 }),
  e('coastal', 'beach coast harbor harbour waterfront sea$ ocean seaside nautical bay$ river$ waterside pier$', { nature: 0.4, moisture: 0.4, luminance: 0.3, warmth: 0.1 }, { coastal: 1 }),
  e('sunny', 'sun$ sunny sunlit sunshine bright$ airy daylight breez', { luminance: 0.8, warmth: 0.3 }, { sun: 0.7 }),
  e('summer', 'summer summery', { luminance: 0.6, warmth: 0.5, nature: 0.3 }, { summer: 0.8 }),
  e('rain', 'rain$ rainy raining rainlit rain_lit drizzl storm stormy', { moisture: 0.9, luminance: -0.3 }, { rain: 1 }),
  e('mist', 'misty mist$ fog$ foggy hazy haze$ dewy', { moisture: 0.7, softness: 0.4 }, { murk: 0.7 }),
  e('winter', 'snow snowy winter wintry frost icy frozen', { warmth: -0.6, luminance: 0.2 }, { winter: 0.8, snow: 0.6 }),
  e('autumn', 'autumn autumnal harvest foliage', { warmth: 0.5, nature: 0.4, era: 0.2 }, { autumn: 0.8 }),
  e('spring', 'spring$ blossom bloom floral flower', { nature: 0.5, softness: 0.5, chroma: 0.3 }, { spring: 0.8, petals: 0.5 }),
  e('night', 'night nighttime midnight nocturn late$ late_night after_dark evening', { luminance: -0.9 }, { night: 0.8 }),
  e('stars', 'star$ stars$ starry starlit celestial cosmic constellation', { luminance: -0.7, softness: 0.3 }, { stars: 0.8, nocturnal: 0.6 }),
  e('glow', 'candle lamp lamplit lantern fireside firelit glow$ hearth', { warmth: 0.7, luminance: -0.3, intimacy: 0.5 }, { 'warm-glow': 0.8, lantern: 0.5 }),
  e('cinematic', 'cinematic film$ movie noir$ filmic', { chroma: -0.4, luminance: -0.4 }, { cinematic: 0.8 }),
  e('noir', 'noir$ smoky shadowy', { chroma: -0.5, luminance: -0.6, grit: 0.1 }, { noir: 0.8 }),
  e('pastel', 'pastel blush soft$ gentle delicate', { softness: 0.8, chroma: -0.1, luminance: 0.4 }, { pastel: 0.6 }),
  e('bookish', 'book bookish literary library study scholarly reading', { intimacy: 0.6, era: 0.5, warmth: 0.4, energy: -0.5 }, { paper: 0.3 }),
  e('paper', 'paper zine sketch illustrat hand_drawn storybook papercraft', { softness: 0.4, era: 0.3, ornament: 0.2 }, { paper: 0.8 }),
  e('painterly', 'watercolor watercolour painterly impressionis', { softness: 0.7, chroma: 0.1 }, { painterly: 0.9, paper: 0.4 }),
  e('graphic', 'comic pop_art graphic bauhaus', { chroma: 0.7, softness: -0.6 }, { graphic: 0.8 }),
  e('arcade', 'arcade game$ games$ gaming pixel 8_bit', { energy: 0.7, chroma: 0.8, era: -0.3 }, { digital: 0.8 }),
  e('gilded', 'gold$ golden gilded glam$ velvet', { warmth: 0.6, ornament: 0.4 }, { luxe: 0.6 }),
  e('rustic', 'rustic cabin cottage farm$ countryside barn', { nature: 0.6, era: 0.5, grit: 0.3, warmth: 0.4 }, { rustic: 0.8 }),
  e('industrial', 'industrial warehouse brick concrete loft', { grit: 0.6, ornament: -0.3, chroma: -0.4, era: 0.1 }),
  e('brutalist', 'brutalis monolith', { ornament: -0.8, chroma: -0.6, grit: 0.5, softness: -0.5 }, { minimal: 0.5 }),
  e('festive', 'celebrat party carnival confetti birthday festive fiesta gala$', { energy: 0.9, chroma: 0.8, luminance: 0.1 }, { sparkle: 0.6 }),
  e('lively', 'lively bustl crowd crowded busy social$ buzzing buzzy packed', { energy: 0.7, intimacy: -0.5 }),
  e('explore', 'explore wander adventure discover stroll walk$ walking', { energy: 0.4, intimacy: -0.3, nature: 0.2 }),
  e('focus', 'focus work$ productive laptop', { energy: -0.6, intimacy: 0.4, ornament: -0.3 }),
  e('friends', 'friends group catch_up hangout people_watch', { energy: 0.3, intimacy: -0.2, warmth: 0.2 }),
  e('art', 'art$ artsy gallery museum creative design', { ornament: 0.2, chroma: 0.2, era: -0.1 }, { minimal: 0.2 }),
  // Energy, sensuality and light level: independent axes, so "energetic but intimate" keeps both.
  e('energetic', 'energ exciting excite thrill dynamic adrenalin pumped high_energy action', { energy: 1, chroma: 0.3 }),
  e('uplifting', 'euphori uplift hopeful bliss elat', { energy: 0.5, luminance: 0.5, chroma: 0.3 }, { sun: 0.3 }),
  e('sleepy', 'sleepy lazy drowsy unhurried', { energy: -0.8, softness: 0.4 }),
  e('sultry', 'sultry sexy sensual seduct steamy flirt', { warmth: 0.5, luminance: -0.5, intimacy: 0.7, chroma: 0.3 }, { 'warm-glow': 0.4, cinematic: 0.3 }),
  e('dark', 'dark$ darker dim$ dimly dimmed unlit shadows$', { luminance: -0.7 }, { night: 0.3 }),
  e('dramatic', 'dramatic theatrical epic operatic', { luminance: -0.3, chroma: 0.2, ornament: 0.4 }, { cinematic: 0.6 }),
  e('eclectic', 'quirky eclectic bohemian boho hipster offbeat kitsch', { ornament: 0.6, chroma: 0.5, grit: 0.2, era: 0.2 }),
  e('edgy', 'edgy alternative subversive rebel', { grit: 0.7, luminance: -0.2 }, { grunge: 0.4 }),
  e('psychedelic', 'psychedelic trippy kaleidoscop hallucin groovy far_out', { chroma: 1, softness: 0.4, era: 0.3, ornament: 0.4 }, { whimsy: 0.3 }),
  e('chaotic', 'chaotic chaos frenetic hectic messy', { energy: 0.9, grit: 0.5, ornament: 0.4 }),
  e('nerdy', 'nerdy geek studious board_game trivia', { intimacy: 0.4, energy: -0.2, chroma: 0.2 }, { paper: 0.2 }),
  e('adventurous', 'adventurous daring', { energy: 0.6, intimacy: -0.3, nature: 0.2 }),
  // Activities and settings (what the outing is, not who runs it).
  e('nightlife', 'nightlife club$ clubs$ clubbing danc', { energy: 0.9, luminance: -0.6, chroma: 0.5, intimacy: -0.2 }, { night: 0.6, neon: 0.3 }),
  e('karaoke', 'karaoke', { energy: 0.8, chroma: 0.8, luminance: -0.3 }, { neon: 0.4 }),
  e('live_music', 'concert gig$ gigs$ live_music', { energy: 0.7, luminance: -0.4, chroma: 0.3 }, { night: 0.3, lamps: 0.3 }),
  e('active', 'hike hiking active$ sporty sport$ sports$ running biking cycling climbing', { energy: 0.7, nature: 0.5, luminance: 0.4 }, { day: 0.4 }),
  e('picnic', 'picnic lawn$ lawns$ meadow', { nature: 0.7, luminance: 0.6, warmth: 0.3, softness: 0.3 }, { sun: 0.4, verdant: 0.4, day: 0.4 }),
  e('rooftop', 'rooftop skyline terrace', { intimacy: -0.2, era: -0.2 }),
  // Time of day in free text (the explicit timeOfDay signal stays authoritative).
  e('morning', 'morning sunrise dawn$ daybreak', { luminance: 0.5, softness: 0.2, warmth: 0.1 }, { morning: 0.8, day: 0.4 }),
  e('afternoon', 'afternoon midday noon$ daytime', { luminance: 0.6 }, { day: 0.8, noon: 0.3 }),
  e('sunset', 'sunset dusk twilight golden_hour sundown', { luminance: -0.2, warmth: 0.5, chroma: 0.2 }, { dusk: 0.8, evening: 0.6 }),
  // Weather, temperature and air.
  e('heat', 'hot$ humid swelter heat$ heatwave', { warmth: 0.7, moisture: 0.4, luminance: 0.3 }, { summer: 0.5, sun: 0.3 }),
  e('cold', 'cold$ chilly freezing brisk', { warmth: -0.6, luminance: 0.1 }, { crisp: 0.4, winter: 0.3 }),
  e('wind', 'windy wind$ gust blustery', { energy: 0.3, moisture: 0.2, softness: -0.2 }, { overcast: 0.3 }),
  e('lush', 'lush tropical jungle overgrown palm$ palms$', { nature: 1, moisture: 0.4, chroma: 0.3, warmth: 0.2 }, { verdant: 1, summer: 0.3 }),
  e('earthy', 'earthy earth_tone terracotta clay$', { nature: 0.4, warmth: 0.4, chroma: -0.3, grit: 0.2 }, { rustic: 0.3 }),
  // Colour and surface.
  e('vivid', 'colorful colourful vivid saturated$ rainbow technicolor', { chroma: 0.9, luminance: 0.2, energy: 0.2 }),
  e('muted', 'muted faded desaturat washed_out monochrom black_and_white greyscale grayscale', { chroma: -0.9 }, { cinematic: 0.2 }),
  e('glossy', 'glossy shiny polished lacquer', { grit: -0.5 }, { glossy: 0.7 }),
  e('sparkle', 'sparkl glitter shimmer twinkl dazzl', { chroma: 0.3, luminance: 0.1, softness: 0.2 }, { sparkle: 0.7, particles: 0.4 }),
];

/** Music genres: tempo and texture, never a claim that a venue plays it. */
const MUSIC_WORDS: readonly Entry[] = [
  e('jazz', 'jazz bebop swing', { luminance: -0.6, intimacy: 0.6, grit: -0.2, warmth: 0.3, era: 0.5 }, { cinematic: 0.4 }),
  e('blues', 'blues', { luminance: -0.5, grit: 0.4, warmth: 0.3, era: 0.5 }),
  e('soul', 'soul$ rnb r_b motown neo_soul', { warmth: 0.6, luminance: -0.3, era: 0.4 }),
  e('lofi', 'lofi lo_fi', { softness: 0.7, warmth: 0.4, energy: -0.5, grit: 0.2 }),
  e('ambient', 'ambient drone new_age', { softness: 0.8, energy: -0.8, moisture: 0.3 }, { murk: 0.3 }),
  e('classical', 'classical orchestra opera chamber piano baroque symphon string_quartet', { ornament: 0.7, era: 0.8, grit: -0.6 }, { luxe: 0.4 }),
  e('folk', 'folk acoustic bluegrass country americana singer_songwriter', { nature: 0.5, era: 0.6, warmth: 0.5, grit: 0.2 }, { rustic: 0.5 }),
  e('indie', 'indie shoegaze dream_pop', { grit: 0.4, era: 0.2, chroma: -0.1, softness: 0.2 }),
  e('rock', 'rock$ grunge_rock garage', { energy: 0.7, grit: 0.6 }),
  e('punk', 'punk hardcore', { grit: 1, energy: 0.9 }, { grunge: 0.6 }),
  e('metal', 'metal$ doom', { luminance: -0.7, grit: 0.8, energy: 0.9 }),
  e('electronic', 'electronic edm techno house$ trance rave dnb drum_and_bass', { energy: 0.9, era: -0.8, luminance: -0.7 }, { neon: 0.6 }),
  e('synthwave', 'synthwave vaporwave retrowave outrun synth', { era: -0.4, chroma: 0.9, luminance: -0.7 }, { neon: 0.8, retro: 0.4 }),
  e('hiphop', 'hip_hop hiphop rap$ trap$', { energy: 0.7, grit: 0.5, era: -0.3 }),
  e('pop', 'pop$ k_pop kpop dance_pop', { energy: 0.6, chroma: 0.7, luminance: 0.3 }),
  e('dance', 'latin salsa reggaeton cumbia bachata afrobeat', { energy: 0.8, warmth: 0.6, chroma: 0.6 }),
  e('reggae', 'reggae ska dub$', { warmth: 0.6, energy: 0.2, softness: 0.3 }),
  e('disco', 'disco funk', { energy: 0.8, chroma: 0.8, era: 0.5 }, { sparkle: 0.5 }),
];

/** Dish and dining-mode words. */
const DINING_WORDS: readonly Entry[] = [
  e('steam', 'noodle noodles soup broth stew hot_pot hotpot dumpling', { warmth: 0.6, moisture: 0.5, intimacy: 0.3, energy: 0.3, luminance: -0.2, grit: 0.2 }, { 'warm-glow': 0.5, murk: 0.4 }),
  e('bakery', 'bakery pastry pastries croissant bread cafe coffee espresso brunch breakfast', { luminance: 0.5, warmth: 0.4, softness: 0.3 }),
  e('sweet', 'dessert ice_cream gelato cake sweet boba bubble_tea donut', { softness: 0.5, chroma: 0.4, luminance: 0.3 }, { pastel: 0.4 }),
  e('cocktail', 'cocktail cocktails wine bar$ bars$ speakeasy lounge whisk martini drink', { luminance: -0.6, grit: -0.4, intimacy: 0.5 }, { luxe: 0.4 }),
  e('pub', 'beer brewery pub$ tavern taproom', { warmth: 0.5, grit: 0.4, energy: 0.3, era: 0.3 }),
  e('seafood', 'seafood oyster oysters lobster clam clams chowder fish$', { nature: 0.3, moisture: 0.4, luminance: 0.2 }, { coastal: 0.6 }),
  e('smoke', 'bbq barbecue grill smoked smokehouse', { warmth: 0.6, grit: 0.5 }),
  e('fresh', 'vegan vegetarian salad plant_based farm_to_table organic healthy', { nature: 0.7, luminance: 0.4 }, { verdant: 0.4 }),
  e('street_food', 'street_food food_truck stall stalls food_hall', { energy: 0.6, intimacy: -0.3, grit: 0.3 }),
  e('tasting', 'tasting_menu chef$ prix_fixe', { grit: -0.8, ornament: 0.3 }, { luxe: 0.5 }),
  e('diner', 'diner burger burgers fries comfort_food pizza', { warmth: 0.4, era: 0.4, energy: 0.2 }, { retro: 0.4 }),
  e('spicy', 'spicy spice', { warmth: 0.5, chroma: 0.4 }),
  e('tea', 'tea$ teahouse matcha', { softness: 0.4, intimacy: 0.5, energy: -0.4 }),
];

/**
 * Recognized but deliberately unstyled: national/regional cuisines and
 * cultural or religious observances. They never become a style or decoration
 * from preference alone.
 */
const CULTURAL_TERMS = new Set([
  'italian', 'japanese', 'chinese', 'mexican', 'thai', 'indian', 'korean', 'vietnamese', 'french', 'greek', 'ethiopian',
  'lebanese', 'moroccan', 'persian', 'caribbean', 'african', 'spanish', 'turkish', 'cuban', 'peruvian', 'brazilian',
  'filipino', 'jewish', 'kosher', 'halal', 'irish', 'sushi', 'ramen', 'izakaya', 'dim_sum', 'taco', 'tacos', 'tajine',
  'tagine', 'pho', 'omakase', 'tapas', 'christmas', 'xmas', 'hanukkah', 'chanukah', 'diwali', 'kwanzaa', 'ramadan',
  'eid', 'lunar_new_year', 'easter', 'passover', 'halloween', 'thanksgiving', 'holi', 'nowruz', 'religious', 'church',
  'temple', 'mosque', 'synagogue',
]);

const PHRASES = [
  'after dark', 'late night', 'date night', 'hot pot', 'street food', 'food truck', 'food hall', 'fine dining',
  'tasting menu', 'prix fixe', 'farm to table', 'plant based', 'ice cream', 'bubble tea', 'comfort food', 'lo fi',
  'hip hop', 'k pop', 'dance pop', 'drum and bass', 'new age', 'neo soul', 'r b', 'string quartet', 'singer songwriter',
  'dream pop', 'grunge rock', '8 bit', 'pop art', 'hand drawn', 'people watch', 'catch up', 'laid back', 'fresh air',
  'dim sum', 'lunar new year', 'sci fi', 'rain lit', 'golden hour', 'live music', 'high energy', 'black and white', 'washed out',
  'earth tone', 'board game', 'far out',
];

const NEGATORS = new Set(['not', 'no', 'without', 'avoid', 'never', 'nothing', 'less', 'non', 'dont', 'hate', 'skip']);

/** Lowercase, join known phrases with `_`, split to tokens. */
export function tokenize(text: string): string[] {
  let t = ` ${text.toLowerCase().replace(/[’']/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ')} `;
  for (const p of PHRASES) t = t.split(` ${p} `).join(` ${p.replace(/ /g, '_')} `);
  return t.split(/\s+/).filter(Boolean);
}

const matches = (token: string, stem: string) => (stem.endsWith('$') ? token === stem.slice(0, -1) : token.startsWith(stem));

function entriesFor(token: string, table: readonly Entry[]): Entry[] {
  return table.filter((entry) => entry.match.some((stem) => matches(token, stem)));
}

/** Channel → (vocabulary, scale). Free text and explicit aesthetics read every vocabulary. */
const ALL = [...STYLE_WORDS, ...MUSIC_WORDS, ...DINING_WORDS];
const CHANNELS: Readonly<Record<string, readonly [readonly Entry[], number]>> = {
  mood: [STYLE_WORDS, 1],
  aesthetic: [ALL, 1],
  experience: [STYLE_WORDS, 0.8],
  music: [[...MUSIC_WORDS, ...STYLE_WORDS], 0.7],
  cuisine: [[...DINING_WORDS, ...STYLE_WORDS], 0.5],
  text: [ALL, 0.6],
  avoid: [ALL, 0.6],
};

const TIME_PULLS: Readonly<Record<TimeOfDay, Pull>> = {
  dawn: { luminance: 0.2, warmth: 0.3, softness: 0.3 },
  morning: { luminance: 0.8, warmth: 0.1 },
  midday: { luminance: 1 },
  afternoon: { luminance: 0.7, warmth: 0.2 },
  golden: { luminance: 0.25, warmth: 0.8 },
  dusk: { luminance: -0.25, warmth: 0.3, chroma: 0.2 },
  night: { luminance: -0.85 },
  late_night: { luminance: -1, energy: 0.2 },
};
const TIME_SCALE = 1.4;
/** Time of day also points at the coherence tags of matching skies and lights. */
const TIME_HINTS: Readonly<Record<TimeOfDay, Readonly<Record<string, number>>>> = {
  dawn: { morning: 1 }, morning: { morning: 0.8, day: 0.6 }, midday: { noon: 1, day: 0.8, clear: 0.3 }, afternoon: { day: 0.8 },
  golden: { evening: 1 }, dusk: { dusk: 1, evening: 0.3 }, night: { night: 1, nocturnal: 0.3 }, late_night: { night: 1, nocturnal: 0.3 },
};

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp01 = (n: number) => clamp(n, 0, 1);

function termOf(t: unknown): { term: string; weight: number } | null {
  if (typeof t === 'string') return { term: t, weight: 1 };
  if (t && typeof t === 'object' && typeof (t as { term?: unknown }).term === 'string') {
    const w = (t as { weight?: unknown }).weight;
    return { term: (t as { term: string }).term, weight: finite(w) ? clamp01(w) : 1 };
  }
  return null;
}

/** Confidence from progress: given confidence wins; otherwise grows with answers; descriptor-only input is 0.5. */
export function confidenceFor(progression: CompositionSignals['progression']): number {
  if (progression && finite(progression.confidence)) return round3(clamp01(progression.confidence));
  if (progression && finite(progression.answers) && progression.answers >= 0) return round3(1 - Math.exp(-progression.answers / 4));
  return 0.5;
}

export function interpretSignals(raw: CompositionSignals | null | undefined, catalog: SceneCatalog = SCENE_CATALOG): Interpretation {
  const signals: CompositionSignals = raw && typeof raw === 'object' ? raw : {};
  const sum: Record<Axis, number> = { ...ZERO };
  const hints: Record<string, number> = {};
  const avoidTags: Record<string, number> = {};
  const recognized: Recognized[] = [];
  const cultural: string[] = [];
  const ignored: string[] = [];
  let anything = false;

  const take = (channel: string, text: string, weight: number, forcedAvoid: boolean) => {
    const [table, scale] = CHANNELS[channel];
    const tokens = tokenize(text);
    const used = new Set<string>();
    let hit = false;
    tokens.forEach((token, i) => {
      if (CULTURAL_TERMS.has(token)) {
        if (!cultural.includes(token)) cultural.push(token);
        hit = true;
        return;
      }
      const negated = forcedAvoid || tokens.slice(Math.max(0, i - 2), i).some((t) => NEGATORS.has(t));
      for (const entry of entriesFor(token, table)) {
        if (used.has(entry.id)) continue; // each entry counts once per term
        used.add(entry.id);
        hit = true;
        anything = true;
        const s = scale * weight * (negated ? -1 : 1);
        addPull(sum, entry.pull, s);
        for (const [tag, w] of Object.entries(entry.tags ?? {})) {
          const into = negated ? avoidTags : hints;
          into[tag] = round3(Math.min(1.5, (into[tag] ?? 0) + w * weight));
        }
        recognized.push({ channel, term: token, entry: entry.id, polarity: negated ? 'avoid' : 'want' });
      }
    });
    if (!hit && text.trim()) ignored.push(text.trim().slice(0, 48));
  };

  for (const channel of ['mood', 'aesthetic', 'experience', 'music', 'cuisine'] as const) {
    const list = signals[channel];
    if (!Array.isArray(list)) continue;
    for (const t of list.slice(0, 24)) {
      const term = termOf(t);
      if (term && term.term.length <= 80) take(channel, term.term, term.weight, false);
    }
  }
  if (Array.isArray(signals.text)) for (const t of signals.text.slice(0, 24)) if (typeof t === 'string') take('text', t.slice(0, 400), 1, false);
  if (Array.isArray(signals.avoid)) for (const t of signals.avoid.slice(0, 24)) if (typeof t === 'string') take('avoid', t.slice(0, 80), 1, true);

  const timeOfDay = typeof signals.timeOfDay === 'string' && (TIMES_OF_DAY as readonly string[]).includes(signals.timeOfDay) ? signals.timeOfDay : null;
  if (timeOfDay) {
    addPull(sum, TIME_PULLS[timeOfDay], TIME_SCALE);
    for (const [tag, w] of Object.entries(TIME_HINTS[timeOfDay])) hints[tag] = round3(Math.min(1.5, (hints[tag] ?? 0) + w));
    anything = true;
  }
  if (finite(signals.energy)) {
    const en = clamp01(signals.energy) * 2 - 1;
    addPull(sum, { energy: en * 1.2, chroma: en * 0.3 });
    anything = true;
  }
  if (finite(signals.social)) {
    const so = clamp01(signals.social) * 2 - 1;
    addPull(sum, { intimacy: -so * 0.8, energy: so * 0.3 });
    anything = true;
  }

  // Explicit catalog preferences: model-editable keys and documented values only.
  const explicit: SceneOverride[] = [];
  for (const o of Array.isArray(signals.explicit) ? signals.explicit.slice(0, catalog.aiOverrideLimit) : []) {
    const setting = o && typeof o.key === 'string' ? catalog.byKey.get(o.key) : undefined;
    if (!setting || !setting.group.aiSelectable || typeof o.value !== 'string' || !setting.values.includes(o.value)) {
      ignored.push(`explicit ${String(o?.key)}=${String(o?.value)}`.slice(0, 48));
      continue;
    }
    if (explicit.some((x) => x.key === o.key)) continue;
    explicit.push(finite(o.intensity) && setting.allowIntensity ? { key: o.key, value: o.value, intensity: round3(clamp01(o.intensity)) } : { key: o.key, value: o.value });
    anything = true;
  }

  const venue = sanitizeVenue(signals.venue);
  const confidence = confidenceFor(signals.progression);
  const presence = anything ? round3(Math.min(0.85, 0.3 + 0.55 * confidence)) : 0;
  return Object.freeze({
    style: squash(sum),
    hints: Object.freeze(hints),
    avoidTags: Object.freeze(avoidTags),
    timeOfDay,
    confidence,
    presence,
    boldness: anything ? round3(0.55 + 0.45 * confidence) : 0,
    explicit: Object.freeze(explicit),
    venue,
    recognized: Object.freeze(recognized),
    culturalTerms: Object.freeze(cultural),
    ignored: Object.freeze(ignored),
  });
}

function sanitizeVenue(v: unknown): VenueContext | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.placeId !== 'string' || !o.placeId) return null;
  const words = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string').map((s) => s.toLowerCase().trim()).slice(0, 8) : []);
  const seasons = ['winter', 'spring', 'summer', 'autumn'];
  return Object.freeze({
    placeId: o.placeId,
    verified: o.verified === true,
    cuisines: words(o.cuisines),
    music: words(o.music),
    seasonal: typeof o.seasonal === 'string' && seasons.includes(o.seasonal) ? (o.seasonal as VenueContext['seasonal']) : null,
    observanceOptIn: typeof o.observanceOptIn === 'string' && o.observanceOptIn.trim() ? o.observanceOptIn.toLowerCase().trim() : null,
  });
}
