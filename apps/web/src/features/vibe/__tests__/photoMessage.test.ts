import {describe,it,expect} from 'vitest';
import {messageText,hasPhotoLine,MAX_TYPED_TEXT,MAX_PHOTO_DESCRIPTION,MAX_CORRECTION_TEXT} from '../photoMessage';
describe('photo message helpers',()=>{
 it('joins typed text and photo line',()=>{expect(messageText('Cozy jazz','Warm amber light')).toBe('Cozy jazz\nPhoto: Warm amber light');});
 it('allows either part alone',()=>{expect(messageText('  ','Warm')).toBe('Photo: Warm');expect(messageText('Cozy')).toBe('Cozy');expect(messageText('',undefined)).toBe('');});
 it('stays within the correction limit at max parts',()=>{expect(messageText('x'.repeat(MAX_TYPED_TEXT),'y'.repeat(MAX_PHOTO_DESCRIPTION)).length).toBeLessThanOrEqual(MAX_CORRECTION_TEXT);});
 it('detects photo lines',()=>{expect(hasPhotoLine('a\nPhoto: b')).toBe(true);expect(hasPhotoLine('Photography club')).toBe(false);});
});
