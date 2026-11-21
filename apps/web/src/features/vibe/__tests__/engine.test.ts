import { describe, expect, it } from 'vitest';
import { inferTextVibe, normalizedAxisTags } from '../model';
import { nextVibeQuestion, startVibeQuiz, submitVibeAnswer, vibeQuizSnapshot } from '../engine';
import { VIBE_QUESTIONS } from '../questions';

describe('vibe input interpretation', () => {
  it('maps contrasting atmospheres in opposite directions', () => {
    const calm = inferTextVibe('A peaceful, mellow, intimate vintage place.');
    const lively = inferTextVibe('Energetic, buzzing, bustling and modern.');
    expect(calm.energy.value).toBeLessThan(0);
    expect(lively.energy.value).toBeGreaterThan(0);
    expect(calm.social.value).toBeLessThan(0);
    expect(lively.social.value).toBeGreaterThan(0);
    expect(calm.aesthetic.value).toBeLessThan(0);
    expect(lively.aesthetic.value).toBeGreaterThan(0);
  });

  it('recognizes simple negations without mistaking them for positive requests', () => {
    const inferred = inferTextVibe('Keep it casual, not too fancy, and avoid crowds.');
    expect(inferred.formality.value).toBeLessThan(0);
    expect(inferred.social.value).toBeLessThan(0);
  });

  it('prioritizes ambiguity rather than claiming certainty from conflicting text', () => {
    const session = startVibeQuiz('Something intimate but crowded.');
    expect(session.estimates.social.conflicted).toBe(true);
    expect(session.estimates.social.strength).toBe(0);
    expect(nextVibeQuestion(session)?.axis).toBe('social');
  });

  it('does not invent semantics for an unknown movie or song reference', () => {
    const estimated = inferTextVibe('Like my favorite song and a scene from a movie.');
    expect(Object.values(estimated).every(x => x.source === 'unset' && x.strength === 0)).toBe(true);
  });

  it('returns no preference tags on blank text', () => {
    expect(normalizedAxisTags(inferTextVibe(''))).toEqual({});
  });
});

describe('adaptive vibe quiz', () => {
  it('asks the highest-priority unresolved dimension after some clues are known', () => {
    const session = startVibeQuiz('Energetic, electric, upbeat and buzzing. Busy, bustling, crowded and social.');
    const next = nextVibeQuestion(session);
    expect(next).not.toBeNull();
    expect(next?.axis).not.toBe('energy');
    expect(next?.axis).not.toBe('social');
  });

  it('answers four questions then stops without repeating', () => {
    let session = startVibeQuiz('A place with warm light', 4);
    const asked: string[] = [];
    for (let i = 0; i < 4; i++) {
      const q = nextVibeQuestion(session);
      expect(q).not.toBeNull();
      asked.push(q!.id);
      session = submitVibeAnswer(session, q!.id, i % 2 ? 'right' : 'left');
    }
    expect(new Set(asked).size).toBe(4);
    expect(nextVibeQuestion(session)).toBeNull();
    expect(vibeQuizSnapshot(session).complete).toBe(true);
  });

  it('does not overwrite the original input object', () => {
    const session = startVibeQuiz('calm and nostalgic');
    const q = nextVibeQuestion(session)!;
    const updated = submitVibeAnswer(session, q.id, 'right');
    expect(session.answers).toHaveLength(0);
    expect(updated.answers).toHaveLength(1);
    expect(session.estimates[q.axis].source).not.toBe('quiz');
  });

  it('allows either answer without inventing a strong preference', () => {
    const start = startVibeQuiz('');
    const q = nextVibeQuestion(start)!;
    const result = submitVibeAnswer(start, q.id, 'either');
    expect(result.estimates[q.axis].neutral).toBe(true);
    expect(result.estimates[q.axis].strength).toBe(0);
    expect(vibeQuizSnapshot(result).tags[q.axis]).toBeUndefined();
    expect(nextVibeQuestion(result)?.id).not.toBe(q.id);
  });

  it('skip does not erase tentative text evidence and never repeats', () => {
    const start = startVibeQuiz('intimate but crowded');
    const question = nextVibeQuestion(start)!;
    expect(question.axis).toBe('social');
    const result = submitVibeAnswer(start, question.id, 'skip');
    expect(result.estimates.social).toEqual(start.estimates.social);
    expect(nextVibeQuestion(result)?.id).not.toBe(question.id);
  });

  it('requires the active question so stale button clicks cannot corrupt state', () => {
    const session = startVibeQuiz('');
    const active = nextVibeQuestion(session)!;
    const other = VIBE_QUESTIONS.find(x => x.id !== active.id)!;
    expect(() => submitVibeAnswer(session, other.id, 'right')).toThrow();
    const updated = submitVibeAnswer(session, active.id, 'left');
    expect(() => submitVibeAnswer(updated, active.id, 'right')).toThrow();
  });

  it('normalizes output range and distinguishes text from a user answer', () => {
    const session = startVibeQuiz('nostalgic, old-fashioned and retro');
    const q = nextVibeQuestion(session)!;
    const result = submitVibeAnswer(session, q.id, 'right');
    const snapshot = vibeQuizSnapshot(result);
    for (const value of Object.values(snapshot.tags)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    expect(result.estimates[q.axis].source).toBe('quiz');
    expect(result.estimates[q.axis].strength).toBe(1);
  });

  it('caps out-of-range question counts safely', () => {
    expect(startVibeQuiz('', 999).maxQuestions).toBe(VIBE_QUESTIONS.length);
    expect(startVibeQuiz('', -1).maxQuestions).toBe(1);
  });
});
