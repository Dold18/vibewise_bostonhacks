import { describe, expect, it } from 'vitest';
import {
  appendVibeImages,
  MAX_VIBE_IMAGES,
  MAX_VIBE_IMAGE_BYTES,
} from '../vibeImages';
import { initialPreferences, normalizePreferences, preferencesReducer } from '../preferences';

// Pure validation tests use File-like metadata; no browser DOM/File API required.
const file = (name: string, type = 'image/jpeg', size = 1000, lastModified = 1): File =>
  ({ name, type, size, lastModified } as File);

describe('vibe photo selection', () => {
  it('accepts JPG, PNG and WebP files, each added into an empty selection', () => {
    for (const picked of [file('cozy.jpg'), file('cinema.png', 'image/png'), file('music.webp', 'image/webp')]) {
      const selected = appendVibeImages([], [picked]);
      expect(selected.files).toEqual([picked]);
      expect(selected.errors).toEqual([]);
    }
  });

  it('does not allow duplicate selection after revisiting a step', () => {
    const one = file('same.jpg', 'image/jpeg', 1000, 5);
    const duplicate = file('same.jpg', 'image/jpeg', 1000, 5);
    const selected = appendVibeImages([one], [duplicate]);
    expect(selected.files).toEqual([one]);
    expect(selected.errors.join(' ')).toContain('already added');
  });

  it('rejects unsupported types and oversized files', () => {
    const selected = appendVibeImages([], [
      file('script.svg', 'image/svg+xml'),
      file('huge.jpg', 'image/jpeg', MAX_VIBE_IMAGE_BYTES + 1),
      file('valid.jpg', 'image/jpeg', MAX_VIBE_IMAGE_BYTES),
    ]);
    expect(selected.files).toHaveLength(1);
    expect(selected.errors).toHaveLength(2);
  });

  it('holds at most one photo', () => {
    expect(MAX_VIBE_IMAGES).toBe(1);
  });

  it('keeps the first of two files and explains how to swap', () => {
    const first = file('first.jpg');
    const selected = appendVibeImages([], [first, file('second.jpg')]);
    expect(selected.files).toEqual([first]);
    expect(selected.errors).toEqual(['Maximum 1 image. Remove it to add another.']);
  });

  it('refuses a second photo while one is attached', () => {
    const current = file('current.jpg');
    const selected = appendVibeImages([current], [file('another.png', 'image/png')]);
    expect(selected.files).toEqual([current]);
    expect(selected.errors).toEqual(['Maximum 1 image. Remove it to add another.']);
  });
});

describe('vibe images in preferences state', () => {
  it('keeps photos and typed vibe when practical preferences change and returns to them', () => {
    const picture = file('scene.jpg');
    const withVibe = preferencesReducer(
      preferencesReducer(initialPreferences(), { type: 'setVibeText', text: 'dim lighting and jazz' }),
      { type: 'setVibeImages', files: [picture] },
    );
    const withActivity = preferencesReducer(withVibe, { type: 'setActivity', activity: 'food_drinks' });
    expect(withActivity.vibeText).toBe('dim lighting and jazz');
    expect(withActivity.vibeImages).toEqual([picture]);
  });

  it('keeps only one photo when two are dispatched', () => {
    const first = file('one.jpg');
    const state = preferencesReducer(initialPreferences(), { type: 'setVibeImages', files: [first, file('two.jpg')] });
    expect(state.vibeImages).toEqual([first]);
  });

  it('clear all removes the browser-local File references', () => {
    const selected = preferencesReducer(initialPreferences(), { type: 'setVibeImages', files: [file('scene.jpg')] });
    expect(preferencesReducer(selected, { type: 'reset' })).toEqual(initialPreferences());
  });

  it('does not revive serialized photo objects as real File references', () => {
    const normalized = normalizePreferences({
      vibeText: 'moody',
      vibeImages: [{ name: 'fake.jpg', type: 'image/jpeg', size: 100, lastModified: 1 }],
    });
    expect(normalized.vibeText).toBe('moody');
    expect(normalized.vibeImages).toEqual([]);
  });
});
