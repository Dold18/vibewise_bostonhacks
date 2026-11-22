/** Verified asset registry. Only this module resolves media IDs to URLs.
 * Commons photos and YouTube tracks are machine-verified (see data/*.ts headers);
 * Session B storyboards are team-original placeholders. */
import { COMMONS_IMAGES } from './data/images.ts';
import { YOUTUBE_TRACKS } from './data/tracks.ts';
import { REFERENCE_BY_ID } from './references.ts';
import type { ImageAsset, TrackAsset } from './types.ts';

const storyboard = (scene: 'bakery' | 'nook', beat: 'arrive' | 'stay' | 'leave', subject: string, evokes: string, tags: string): ImageAsset => ({
  id: `img-storyboard-${scene}-${beat}`, kind: 'original_storyboard', src: `/quiz-scenes/session-b-v1/${scene}-${beat}.svg`, width: 640, height: 360,
  subject, alt: `Original storyboard illustration: ${subject}`, tags: tags.split(' '), evokes,
  rights: { source: 'team_original', license: 'Team original (placeholder storyboard)', author: 'Vibenta team (code-native SVG)', sourceUrl: '/quiz-scenes/session-b-v1/manifest.json', verifiedAt: '2026-11-21', verification: 'SHA-256 recorded in Session B manifest', adaptation: true },
});
const STORYBOARDS: readonly ImageAsset[] = [
  storyboard('bakery', 'arrive', 'a warm bakery counter with pastry trays and a coffee cup', 'A bakery counter with a little everyday activity to watch', 'cozy bakery warm cafe counter'),
  storyboard('nook', 'arrive', 'a blue-green window nook with an empty chair, a closed notebook and coffee', 'A quiet window seat where tasks can stay closed', 'quiet nook window calm coffee'),
  storyboard('bakery', 'leave', 'a takeaway coffee cup outside a bakery doorway', 'A short coffee reset before heading back out', 'takeaway walk reset coffee'),
];

export const IMAGES: readonly ImageAsset[] = Object.freeze([...COMMONS_IMAGES, ...STORYBOARDS]);
export const TRACKS: readonly TrackAsset[] = Object.freeze([...YOUTUBE_TRACKS]);
export const IMAGE_BY_ID: ReadonlyMap<string, ImageAsset> = new Map(IMAGES.map((i) => [i.id, i]));
export const TRACK_BY_ID: ReadonlyMap<string, TrackAsset> = new Map(TRACKS.map((t) => [t.id, t]));
export { REFERENCE_BY_ID };

/** Display credit for an image. Required by CC BY/BY-SA; harmless elsewhere. */
export function imageCredit(image: ImageAsset): string {
  if (image.rights.source === 'team_original') return 'Original storyboard · Vibenta team · not a real venue';
  const film = image.film ? `Still from ${image.film} · ` : '';
  return `${film}${image.rights.author} · ${image.rights.license} · Wikimedia Commons`;
}

/** YouTube's own visible player. No autoplay, no hidden video, no audio extraction. */
export function trackEmbedUrl(track: TrackAsset): string {
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(track.videoId)}?rel=0&modestbranding=1&playsinline=1`;
}
export const trackWatchUrl = (track: TrackAsset) => `https://www.youtube.com/watch?v=${encodeURIComponent(track.videoId)}`;
