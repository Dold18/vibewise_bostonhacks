import fs from 'node:fs/promises';
import path from 'node:path';
import { STUDY_BBOX } from './config.ts';
import type { PlaceTypeConfig } from './placeTypes.ts';
import type { Bbox } from './types.ts';

function primaryLabelFilter(topLevels: string[]): string {
  if (topLevels.length === 0) throw new Error('no Foursquare top-level categories configured');
  const tests = topLevels.map((t) => `starts_with(fsq_category_labels[1], '${t.replaceAll("'", "''")}')`);
  return tests.length === 1 ? `  and ${tests[0]}` : `  and (${tests.join(' or ')})`;
}

export function buildFsqQuery(release: string, bbox: Bbox, cfg: PlaceTypeConfig): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(release)) throw new Error(`invalid FSQ release '${release}' (expected YYYY-MM-DD)`);
  return [
    'select fsq_place_id, name, latitude, longitude, address, locality, postcode, tel, website,',
    '  fsq_category_labels, date_refreshed',
    `from read_parquet('hf://datasets/foursquare/fsq-os-places/release/dt=${release}/places/parquet/*.parquet')`,
    `where latitude between ${bbox.south} and ${bbox.north}`,
    `  and longitude between ${bbox.west} and ${bbox.east}`,
    '  and date_closed is null',
    primaryLabelFilter(cfg.fsqTopLevels),
  ].join('\n');
}

export async function loadFsqRows(
  opts: { hfToken: string | undefined; release: string; refresh: boolean; cacheDir: string; cfg: PlaceTypeConfig },
): Promise<{ rows: Record<string, unknown>[]; skipped: boolean; fromCache: boolean }> {
  const query = buildFsqQuery(opts.release, STUDY_BBOX, opts.cfg);
  const file = path.join(opts.cacheDir, `fsq-${opts.cfg.type}-${opts.release}.json`);
  if (!opts.refresh) {
    try {
      const rows = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>[];
      return { rows, skipped: false, fromCache: true };
    } catch {
      // no usable cache: fall through to a live query
    }
  }
  if (!opts.hfToken) {
    console.warn('HF_TOKEN not set: skipping Foursquare source');
    return { rows: [], skipped: true, fromCache: false };
  }
  const { DuckDBInstance } = await import('@duckdb/node-api');
  const instance = await DuckDBInstance.create(':memory:');
  const conn = await instance.connect();
  let rows: Record<string, unknown>[];
  try {
    await conn.run('INSTALL httpfs');
    await conn.run('LOAD httpfs');
    const token = opts.hfToken.replaceAll("'", "''");
    try {
      await conn.run(`CREATE SECRET hf (TYPE huggingface, TOKEN '${token}')`);
    } catch {
      throw new Error('failed to create the Hugging Face secret in DuckDB (statement withheld)');
    }
    const reader = await conn.runAndReadAll(query);
    rows = reader.getRowObjectsJson() as Record<string, unknown>[];
  } finally {
    conn.closeSync();
    instance.closeSync();
  }
  await fs.mkdir(opts.cacheDir, { recursive: true });
  await fs.writeFile(file, JSON.stringify(rows));
  return { rows, skipped: false, fromCache: false };
}
