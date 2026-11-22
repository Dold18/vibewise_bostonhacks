/**
 * Team-checked corrections for single places (pipeline/place-overrides.json), applied by ingest after merging so a
 * re-run never brings a known-wrong value back. Each entry names its source, like the curated deals file.
 */
import type { PlaceRow } from './types.ts';

export const OVERRIDE_FIELDS = ['address', 'website', 'phone', 'hours_raw'] as const;
export type OverrideField = (typeof OVERRIDE_FIELDS)[number];

export interface PlaceOverride {
  place_id: string;
  /** Fields to set; null clears a field (unknown is better than wrong). */
  set: Partial<Record<OverrideField, string | null>>;
  reason: string;
  source_url: string;
  checked_on: string; // YYYY-MM-DD
}

function isHttpUrl(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

function isDate(v: unknown): boolean {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Bad entries are reported and skipped; the good ones are returned. */
export function validateOverrides(raw: unknown): { overrides: PlaceOverride[]; errors: string[] } {
  if (!Array.isArray(raw)) return { overrides: [], errors: ['overrides file must be a JSON array'] };
  const overrides: PlaceOverride[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  const allowed: readonly string[] = OVERRIDE_FIELDS;
  for (const [i, entry] of raw.entries()) {
    const fail = (why: string) => errors.push(`entry ${i}: ${why}`);
    const e = (entry ?? {}) as Record<string, unknown>;
    if (typeof e.place_id !== 'string' || e.place_id.trim() === '') { fail('place_id is required'); continue; }
    const set = e.set;
    if (set === null || typeof set !== 'object' || Array.isArray(set) || Object.keys(set).length === 0) {
      fail('set must be an object with at least one field'); continue;
    }
    const bad = Object.entries(set).find(([k, v]) => !allowed.includes(k) || (v !== null && (typeof v !== 'string' || v.trim() === '')));
    if (bad) { fail(`set.${bad[0]} is not allowed (fields: ${OVERRIDE_FIELDS.join(', ')}; values: non-empty string or null)`); continue; }
    if (typeof e.reason !== 'string' || e.reason.trim() === '') { fail('reason is required'); continue; }
    if (!isHttpUrl(e.source_url)) { fail('source_url must be an http(s) URL'); continue; }
    if (!isDate(e.checked_on)) { fail('checked_on must be a valid YYYY-MM-DD date'); continue; }
    if (seen.has(e.place_id)) { fail(`duplicate place_id ${e.place_id}`); continue; }
    seen.add(e.place_id);
    overrides.push({
      place_id: e.place_id, set: set as PlaceOverride['set'], reason: e.reason,
      source_url: e.source_url as string, checked_on: e.checked_on as string,
    });
  }
  return { overrides, errors };
}

/** Sets the listed fields on rows in this run; returns the place_ids that were changed. Rows are updated in place. */
export function applyOverrides(rows: PlaceRow[], overrides: PlaceOverride[]): string[] {
  const byId = new Map(overrides.map((o) => [o.place_id, o]));
  const applied: string[] = [];
  for (const row of rows) {
    const o = byId.get(row.place_id);
    if (!o) continue;
    for (const field of OVERRIDE_FIELDS) {
      if (Object.hasOwn(o.set, field)) row[field] = o.set[field] ?? null;
    }
    applied.push(row.place_id);
  }
  return applied;
}
