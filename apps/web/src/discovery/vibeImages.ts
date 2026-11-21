/** Browser-local image selection for the vibe step. This module NEVER uploads a file. */
export const MAX_VIBE_IMAGES = 5;
export const MAX_VIBE_IMAGE_BYTES = 8 * 1024 * 1024;
export const ACCEPTED_VIBE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export function supportedVibeImage(file: File): boolean {
  return ACCEPTED_VIBE_IMAGE_TYPES.includes(file.type as (typeof ACCEPTED_VIBE_IMAGE_TYPES)[number])
    && file.size > 0
    && file.size <= MAX_VIBE_IMAGE_BYTES;
}

function imageKey(file: File): string {
  return [file.name, file.size, file.lastModified].join(':');
}

export interface VibeImageSelection {
  files: File[];
  errors: string[];
}

/** Accepts as many valid distinct images as fit; reports reasons for skipped files. */
export function appendVibeImages(current: readonly File[], incoming: readonly File[]): VibeImageSelection {
  const files = [...current].filter(supportedVibeImage).slice(0, MAX_VIBE_IMAGES);
  const seen = new Set(files.map(imageKey));
  const errors: string[] = [];

  for (const file of incoming) {
    if (!ACCEPTED_VIBE_IMAGE_TYPES.includes(file.type as (typeof ACCEPTED_VIBE_IMAGE_TYPES)[number])) {
      errors.push(`${file.name}: use JPG, PNG or WebP.`);
    } else if (file.size <= 0 || file.size > MAX_VIBE_IMAGE_BYTES) {
      errors.push(`${file.name}: choose an image under 8 MB.`);
    } else if (seen.has(imageKey(file))) {
      errors.push(`${file.name}: already added.`);
    } else if (files.length >= MAX_VIBE_IMAGES) {
      errors.push(`Maximum ${MAX_VIBE_IMAGES} images. Remove one to add another.`);
      break;
    } else {
      files.push(file);
      seen.add(imageKey(file));
    }
  }
  return { files, errors };
}
