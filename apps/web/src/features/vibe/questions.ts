import type { VibeAxis } from './model';

export interface VibeQuestion {
  id: string;
  axis: VibeAxis;
  title: string;
  /** Left answer = -1, right answer = +1. Either/skip are separate options. */
  left: { label: string; description: string };
  right: { label: string; description: string };
  /** Used only as a stable tie-breaker after evidence-based selection. */
  priority: number;
}

/** One small, reusable question per axis. Real photos can be attached later. */
export const VIBE_QUESTIONS: readonly VibeQuestion[] = [
  {
    id: 'energy', axis: 'energy', title: 'What kind of energy feels right?',
    left: { label: 'Easygoing', description: 'Low-key and peaceful' },
    right: { label: 'Electric', description: 'Lively and full of energy' },
    priority: 7,
  },
  {
    id: 'social', axis: 'social', title: 'What should the crowd feel like?',
    left: { label: 'Intimate', description: 'Room to talk and connect' },
    right: { label: 'Social', description: 'People and activity all around' },
    priority: 6,
  },
  {
    id: 'setting', axis: 'setting', title: 'Where would you rather be?',
    left: { label: 'Tucked inside', description: 'A welcoming indoor space' },
    right: { label: 'Out in the open', description: 'Fresh air and open surroundings' },
    priority: 5,
  },
  {
    id: 'lighting', axis: 'lighting', title: 'What lighting matches the feeling?',
    left: { label: 'Dim and atmospheric', description: 'Low light, moody corners' },
    right: { label: 'Bright and airy', description: 'Light-filled and open' },
    priority: 4,
  },
  {
    id: 'aesthetic', axis: 'aesthetic', title: 'Which design feels closer?',
    left: { label: 'Old-school charm', description: 'Vintage, historic, nostalgic' },
    right: { label: 'Modern edge', description: 'Minimal, sleek, contemporary' },
    priority: 4,
  },
  {
    id: 'formality', axis: 'formality', title: 'How dressed-up should it feel?',
    left: { label: 'Casual', description: 'Relaxed and unpretentious' },
    right: { label: 'Upscale', description: 'Polished and elegant' },
    priority: 3,
  },
  {
    id: 'outing', axis: 'outing', title: 'What sounds better for this outing?',
    left: { label: 'Stay awhile', description: 'Slow down, sit and unwind' },
    right: { label: 'Try something new', description: 'Explore, play, be active' },
    priority: 3,
  },
] as const;

export function questionById(id: string): VibeQuestion | undefined {
  return VIBE_QUESTIONS.find(q => q.id === id);
}
