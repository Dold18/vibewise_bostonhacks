/** Canonical current-outing profile. Account taste and practical constraints remain separate. */
export const MODEL = Object.freeze({ id: 'Xenova/all-MiniLM-L6-v2', revision: '751bff37182d3f1213fa05d7196b954e230abad9', dimensions: 384, dtype: 'fp32', pooling: 'mean', normalization: 'l2' } as const);
export const MODEL_KEY = `${MODEL.id}@${MODEL.revision}:${MODEL.dtype}:${MODEL.pooling}:${MODEL.normalization}`;
export const MAX_QUESTIONS = 10;
export type Topic = 'lighting'|'sound'|'crowding'|'setting'|'texture'|'pace'|'social'|'occasion'|'discovery'|'emotion'|'comfort'|'design'|'clarification';
export interface Choice { readonly id: string; readonly label: string; readonly description: string; readonly preference: 'want'|'avoid' }
export interface Question { readonly id: string; readonly family: string; readonly topic: Topic; readonly prompt: string; readonly options: readonly Choice[]; readonly cultural: boolean }
export type Response = { readonly kind: 'choice'; readonly optionId: string } | { readonly kind: 'skip'|'neither'|'unfamiliar' } | { readonly kind: 'correction'; readonly text: string; readonly retract?: readonly string[] };
export interface Answer { readonly id: string; readonly question: Question; readonly response: Response; readonly summaryAfter?: string; readonly qualifiersAfter?: readonly string[]; readonly summarySource?: 'gemini' }
export interface Evidence { readonly id: string; readonly text: string; readonly polarity: 'want'|'avoid'|'dealbreaker'; readonly source: 'original'|'answer'|'correction'; readonly kind: 'explicit'; readonly topic?: Topic }
export interface Embedding { readonly status: 'idle'|'pending'|'ready'|'unavailable'; readonly modelKey: string; readonly version: number; readonly vector?: readonly number[]; readonly reason?: string }
export interface OutingVibeProfile {
  readonly schemaVersion: '1.0.0'; readonly sessionId: string; readonly version: number;
  readonly originalInput: { readonly text: string; readonly imageCount: number; readonly imageProcessing: 'not_sent' };
  readonly vibe_so_far: string; readonly evidence: readonly Evidence[]; readonly qualifiers: readonly string[];
  readonly history: readonly Answer[]; readonly askedFamilies: readonly string[]; readonly askedTopics: readonly Topic[];
  readonly question: Question|null; readonly phase: 'generating'|'question'|'results';
  readonly generation: 'pending'|'gemini'|'fallback'; readonly notice: string|null;
  readonly embedding: Embedding;
  readonly completion: { readonly recommended: boolean; readonly reason: 'refining'|'sufficient_detail'|'stable_and_specific'|'no_new_topics'|'user_request'|'maximum'; readonly canContinue: boolean };
}
export interface GenerationResult { vibe_so_far: string; nextQuestion: Question|null; qualifiers: string[]; continuation: 'refine'|'finish'; reason: string }
export interface GenerationContext { sessionId: string; version: number; originalInput: OutingVibeProfile['originalInput']; vibe_so_far: string; history: readonly Answer[]; evidence: readonly Evidence[]; qualifiers: readonly string[] }
export interface GenerationProvider { generate(context: GenerationContext, signal: AbortSignal): Promise<GenerationResult> }
export interface EmbeddingProvider { embed(text: string, signal: AbortSignal): Promise<{ modelKey: string; vector: readonly number[] }> }
export function immutable<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for(const v of Object.values(value)) immutable(v); }
  return value;
}
export function validateVector(value: unknown, modelKey: unknown): number[] {
  if(modelKey!==MODEL_KEY || !Array.isArray(value) || value.length!==MODEL.dimensions || !value.every(v=>typeof v==='number'&&Number.isFinite(v))) throw new Error('Incompatible MiniLM model or vector');
  const norm=Math.hypot(...value); if(norm<1e-10) throw new Error('Empty MiniLM vector');
  return value.map(v=>v/norm);
}
export function cosine(a: readonly number[], b: readonly number[]) { return a.reduce((sum,v,i)=>sum+v*b[i],0); }
