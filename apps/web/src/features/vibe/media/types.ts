/** Vibenta media presentation (vibenta-media/1). Additive, optional on Question.
 * Gemini chooses registry IDs only; URLs, embeds and rights live in the registry. */

export const FORMATS = ['image_choice', 'image_reveal', 'image_blend', 'listening', 'free_text', 'text_choice'] as const;
export type MediaFormat = typeof FORMATS[number];
/** Creative register of the question copy. Chosen per input, never universal. */
export const VOICES = ['irreverent', 'deadpan', 'hype', 'nostalgic', 'mysterious', 'romantic', 'tender', 'reflective', 'cinematic'] as const;
export type Voice = typeof VOICES[number];
/** Quiz palette that mirrors the current interpretation. Presentation only. */
export const MOODS = ['neon_noir', 'candlelit_gothic', 'warm_amber', 'sunlit', 'electric_party', 'misty_blue', 'dreamy_pastel', 'deep_forest', 'retro_film', 'starlit'] as const;
export type Mood = typeof MOODS[number];
/** CSS-filter transformations applied to adaptation-permitted images only. */
export const TRANSFORMS = ['golden_hour', 'blue_hour', 'neon', 'candlelight', 'fog', 'noir', 'dreamlike', 'storm'] as const;
export type Transform = typeof TRANSFORMS[number];

export interface QuestionDesign {
  /** What the initial vibe and previous answers already establish. */
  readonly known: string;
  /** The experiential uncertainty this question explores. */
  readonly uncertainty: string;
  /** Why this medium (image, sound, text…) helps resolve it. */
  readonly whyThisMedium: string;
  /** How each answer would change the next interaction. */
  readonly branches: readonly { readonly optionId: string; readonly leadsTo: string }[];
}

export interface QuestionPresentation {
  readonly schema: 'vibenta-media/1';
  readonly format: MediaFormat;
  readonly voice: Voice;
  readonly mood: Mood;
  readonly source: 'gemini' | 'local';
  /** image_choice: one distinct image per option. */
  readonly optionImages?: readonly { readonly optionId: string; readonly imageId: string }[];
  /** image_reveal / image_blend: the single explored image. */
  readonly stageImageId?: string;
  /** image_blend: the two transformations the slider moves between. */
  readonly blend?: { readonly from: Transform; readonly to: Transform; readonly fromLabel: string; readonly toLabel: string };
  /** listening: one verified official recording. */
  readonly trackId?: string;
  /** Cultural references the question draws on (registry IDs). */
  readonly referenceIds?: readonly string[];
  /** One short line explaining a reference for people who don't know it. */
  readonly referenceNote?: string;
  /** free_text: hint inside the answer box. */
  readonly placeholder?: string;
  readonly design: QuestionDesign;
}

export type ImageKind = 'photo' | 'public_domain_film_still' | 'space_photo' | 'original_storyboard';
export interface ImageAsset {
  readonly id: string;
  readonly kind: ImageKind;
  readonly src: string;
  readonly width: number;
  readonly height: number;
  /** Plain factual description of what is visible. */
  readonly subject: string;
  readonly alt: string;
  readonly tags: readonly string[];
  /** Outing language this image can stand for (used by the offline director). */
  readonly evokes: string;
  readonly film?: string;
  readonly rights: {
    readonly source: 'wikimedia_commons' | 'team_original';
    readonly license: string;
    readonly licenseUrl?: string;
    readonly author: string;
    readonly sourceUrl: string;
    readonly verifiedAt: string;
    readonly verification: string;
    /** Whether Vibenta may display a filtered version (PD, CC0, CC BY, team original). */
    readonly adaptation: boolean;
  };
}

export interface TrackAsset {
  readonly id: string;
  readonly kind: 'youtube';
  readonly videoId: string;
  readonly song: string;
  readonly artist: string;
  readonly year: number;
  readonly mood: string;
  /** How the recording sounds; also the sound-off fallback description. */
  readonly sound: string;
  readonly channel: string;
  readonly channelUrl: string;
  readonly officialBasis: string;
  readonly verifiedAt: string;
  readonly verification: string;
}

export type ReferenceKind = 'song' | 'film' | 'tv' | 'game' | 'meme' | 'moment' | 'book' | 'character' | 'album' | 'artwork';
export interface CulturalReference {
  readonly id: string;
  readonly kind: ReferenceKind;
  readonly title: string;
  readonly creator: string;
  readonly year: number;
  /** Original, non-prescriptive description of what it can evoke for some people. */
  readonly evokes: string;
  readonly tags: readonly string[];
  readonly source: string;
  /** Linked playable/displayable registry assets, if any are cleared. */
  readonly assetIds?: readonly string[];
}
