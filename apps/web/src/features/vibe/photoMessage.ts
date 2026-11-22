export const MAX_PHOTO_DESCRIPTION = 280;
export const MAX_TYPED_TEXT = 500;
export const MAX_CORRECTION_TEXT = 800;
export const PHOTO_LINE_PREFIX = 'Photo: ';
export const photoLine = (description: string) => `${PHOTO_LINE_PREFIX}${description.trim()}`;
export function messageText(userText: string, description?: string): string {
 const typed = userText.trim(), photo = description?.trim() ? photoLine(description) : '';
 return typed && photo ? `${typed}\n${photo}` : typed || photo;
}
export const hasPhotoLine = (text: string) => text.split('\n').some(l => l.startsWith(PHOTO_LINE_PREFIX));
