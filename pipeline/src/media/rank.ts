import type { PhotoCandidate, PhotoSource } from './types.ts';

const MAX_PHOTOS = 5;

// Display rank by source (spec §4.1): explicit links are near-certain, geosearch and street photos the least.
export const SOURCE_RANK: Record<PhotoSource, number> = { upload: 1, osm: 2, wikidata: 2, website: 3, commons: 4, mapillary: 5 };

/** Identity of a photo across runs: its URL, or `mapillary:<id>` for Mapillary photos (whose URLs expire). */
export function photoKey(p: { url: string | null; mapillaryId: string | null }): string | null {
  return p.url ?? (p.mapillaryId ? `mapillary:${p.mapillaryId}` : null);
}

export function rankPhotos(candidates: PhotoCandidate[], hiddenKeys: Set<string>): Array<PhotoCandidate & { rank: number }> {
  const ranked = candidates
    .map((c) => ({ ...c, rank: SOURCE_RANK[c.source] }))
    .sort((a, b) => a.rank - b.rank); // Array.prototype.sort is stable
  const seen = new Set<string>();
  const out: Array<PhotoCandidate & { rank: number }> = [];
  for (const c of ranked) {
    const key = photoKey(c);
    if (key === null || hiddenKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(c);
    if (out.length === MAX_PHOTOS) break;
  }
  return out;
}
