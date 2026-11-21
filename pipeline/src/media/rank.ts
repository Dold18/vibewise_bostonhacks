import type { PhotoCandidate, PhotoSource } from './types.ts';

const MAX_PHOTOS = 5;

// Display rank by source (spec §4.1): explicit links are near-certain, geosearch and street photos the least.
export const SOURCE_RANK: Record<PhotoSource, number> = { upload: 1, osm: 2, wikidata: 2, website: 3, commons: 4, mapillary: 5 };

export function rankPhotos(candidates: PhotoCandidate[], hiddenUrls: Set<string>): Array<PhotoCandidate & { rank: number }> {
  const ranked = candidates
    .filter((c) => c.url === null || !hiddenUrls.has(c.url))
    .map((c) => ({ ...c, rank: SOURCE_RANK[c.source] }))
    .sort((a, b) => a.rank - b.rank); // Array.prototype.sort is stable
  const seen = new Set<string>();
  const out: Array<PhotoCandidate & { rank: number }> = [];
  for (const c of ranked) {
    const key = c.url ?? (c.mapillaryId ? `mapillary:${c.mapillaryId}` : null);
    if (key === null || seen.has(key)) continue;
    seen.add(key);
    out.push(c);
    if (out.length === MAX_PHOTOS) break;
  }
  return out;
}
