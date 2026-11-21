import { emptyAxis, inferTextVibe, normalizedAxisTags, type VibeEstimates, type VibeAxis } from './model';
import { VIBE_QUESTIONS, type VibeQuestion } from './questions';

export type VibeAnswer = 'left' | 'right' | 'either' | 'skip';
export interface QuizAnswer {
  questionId: string;
  answer: VibeAnswer;
}
export interface QuizSession {
  /** Original user text stays intact, including unresolved music/movie references. */
  inputText: string;
  /** Prevent an unending questionnaire; default is 4 questions. */
  maxQuestions: number;
  estimates: VibeEstimates;
  answers: readonly QuizAnswer[];
}

export function startVibeQuiz(inputText = '', maxQuestions = 4): QuizSession {
  return {
    inputText,
    maxQuestions: Math.max(1, Math.min(VIBE_QUESTIONS.length, Math.floor(Number.isFinite(maxQuestions) ? maxQuestions : 4))),
    estimates: inferTextVibe(inputText),
    answers: [],
  };
}

/**
 * Unresolved dimensions go first, but a self-contradictory description gets
 * priority for clarification. Deterministic ties use product-relevant priority.
 * Later, true venue-discrimination/information gain can replace this heuristic.
 */
export function nextVibeQuestion(session: QuizSession): VibeQuestion | null {
  if (session.answers.length >= session.maxQuestions) return null;
  const seen = new Set(session.answers.map(a => a.questionId));
  const available = VIBE_QUESTIONS.filter(q => !seen.has(q.id));
  if (!available.length) return null;

  available.sort((a, b) => {
    const score = (q: VibeQuestion) => {
      const estimate = session.estimates[q.axis];
      return (1 - estimate.strength) * (q.priority / 7) + (estimate.conflicted ? 0.35 : 0);
    };
    return score(b) - score(a) || b.priority - a.priority || a.id.localeCompare(b.id);
  });
  return available[0];
}

export function submitVibeAnswer(session: QuizSession, questionId: string, answer: VibeAnswer): QuizSession {
  const active = nextVibeQuestion(session);
  if (!active || active.id !== questionId) throw new Error('This is not the active vibe question.');
  if (!(['left', 'right', 'either', 'skip'] as VibeAnswer[]).includes(answer)) throw new Error('Invalid answer.');

  const estimates: VibeEstimates = { ...session.estimates };
  const axis: VibeAxis = active.axis;
  if (answer === 'left' || answer === 'right') {
    estimates[axis] = {
      value: answer === 'left' ? -1 : 1,
      strength: 1,
      source: 'quiz',
      evidence: [`Question: ${active.title}`],
      conflicted: false,
      neutral: false,
    };
  } else if (answer === 'either') {
    estimates[axis] = { ...emptyAxis(), source: 'quiz', neutral: true };
  } // skip keeps any original text evidence but never asks this question again.

  return {
    ...session,
    estimates,
    answers: [...session.answers, { questionId, answer }],
  };
}

export interface VibeQuizSnapshot {
  /** Explicitly heuristic signals for a prospective recommendations adapter. */
  tags: Partial<Record<VibeAxis, number>>;
  /** A factor per axis to avoid over-weighting weak text guesses. */
  evidenceStrength: Partial<Record<VibeAxis, number>>;
  questionCount: number;
  complete: boolean;
}

export function vibeQuizSnapshot(session: QuizSession): VibeQuizSnapshot {
  const tags = normalizedAxisTags(session.estimates);
  const evidenceStrength: Partial<Record<VibeAxis, number>> = {};
  for (const key of Object.keys(tags) as VibeAxis[]) {
    evidenceStrength[key] = session.estimates[key].strength;
  }
  return {
    tags,
    evidenceStrength,
    questionCount: session.answers.length,
    complete: nextVibeQuestion(session) === null,
  };
}
