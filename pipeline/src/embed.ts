/**
 * The ONE embedder for the catalog and, later, every query (docs/EMBEDDING_PIPELINE.md §1).
 * Query-time code must import these same constants and `createEmbedder`, so the two sides cannot drift:
 * same model, same fp32 weights, mean pooling, L2-normalized. Normalized vectors make cosine
 * similarity equal the dot product (PROJECT_BRIEF §6.1).
 */
import { pipeline } from '@huggingface/transformers';

export const EMBED_MODEL = 'Xenova/all-MiniLM-L6-v2';
/**
 * Pinned to the web app's model revision (apps/web/src/features/vibe/profile.ts MODEL.revision): the map only
 * compares catalog vectors whose fingerprint matches. Checked 2026-11-22: stored vectors re-embedded at this
 * revision give cosine 1.000000 for every place type.
 */
export const EMBED_REVISION = '751bff37182d3f1213fa05d7196b954e230abad9';
export const EMBED_DIM = 384;
/** Unquantized weights: the brief asks that index and query match "including quantization". */
export const EMBED_DTYPE = 'fp32';
export const EMBED_POOLING = { pooling: 'mean', normalize: true } as const;

export type Embedder = (text: string) => Promise<number[]>;

export async function createEmbedder(): Promise<Embedder> {
  const extractor = await pipeline('feature-extraction', EMBED_MODEL, { dtype: EMBED_DTYPE, revision: EMBED_REVISION });
  const embed: Embedder = async (text) => {
    const out = await extractor(text, EMBED_POOLING);
    const v = Array.from(out.data as Float32Array);
    if (v.length !== EMBED_DIM) throw new Error(`embedding has ${v.length} dims, expected ${EMBED_DIM}`);
    return v;
  };
  // Fail fast on a wrong variant or missing normalization before any row is written.
  const probe = await embed('probe');
  const norm = Math.sqrt(probe.reduce((s, x) => s + x * x, 0));
  if (Math.abs(norm - 1) > 1e-3) throw new Error(`embedding is not L2-normalized (norm ${norm.toFixed(4)})`);
  return embed;
}
