import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createAssetLibrary } from '../assets';
import { MAX_FACADES, normalizeAppearance, type BuildingAppearance } from '../contract';
import { GLASS_MODERN, HEIGHT_ZONED_DUSK, MASONRY, NEUTRAL_MASSING, QA_FIXTURES, WEATHERED_STONE_PLASTER } from '../fixtures';
import { ATTR, MeshBuffer, STRIDE, appendBuilding, footprintArea } from '../geometry';
import { eyePosition, invert } from '../layer';
import { assignBuilding, eligibleFacades, hashString } from '../rules';
import { triangulate } from '../triangulate';
import { assetRefs, sunDirection, uniformValues } from '../uniforms';

const square = (s: number, ox = 0, oy = 0): [number, number][] => [
  [ox, oy],
  [ox + s, oy],
  [ox + s, oy + s],
  [ox, oy + s],
];

function triArea(flat: number[], tris: number[]) {
  let a = 0;
  for (let i = 0; i < tris.length; i += 3) {
    const [p, q, r] = [tris[i]!, tris[i + 1]!, tris[i + 2]!];
    a += Math.abs((flat[q * 2]! - flat[p * 2]!) * (flat[r * 2 + 1]! - flat[p * 2 + 1]!) - (flat[r * 2]! - flat[p * 2]!) * (flat[q * 2 + 1]! - flat[p * 2 + 1]!)) / 2;
  }
  return a;
}

describe('triangulate', () => {
  it('covers a square exactly', () => {
    const flat = square(10).flat();
    const tris = triangulate(flat);
    expect(tris.length).toBe(6);
    expect(triArea(flat, tris)).toBeCloseTo(100);
  });
  it('leaves courtyard holes open', () => {
    const flat = [...square(30).flat(), ...square(10, 10, 10).flat()];
    const tris = triangulate(flat, [4]);
    expect(triArea(flat, tris)).toBeCloseTo(800);
  });
  it('handles concave L-shaped footprints', () => {
    const l = [[0, 0], [20, 0], [20, 8], [8, 8], [8, 20], [0, 20]].flat();
    expect(triArea(l, triangulate(l))).toBeCloseTo(20 * 8 + 8 * 12);
  });
});

describe('geometry', () => {
  const input = { height: 20, minHeight: 0, parapet: 1, facade: 2, roof: 1, seed: 0.5, jitter: 0, floorOffset: 0, alignRoof: true };
  it('extrudes walls with metre surface coordinates and outward normals', () => {
    const mesh = new MeshBuffer();
    expect(appendBuilding(mesh, { ...input, rings: [square(10)] })).toBe(true);
    const walls: { nx: number; ny: number; u: number; v: number; len: number; x: number; y: number }[] = [];
    for (let i = 0; i < mesh.vertexCount; i++) {
      const o = i * STRIDE;
      const a = mesh.vertices;
      if (a[o + ATTR.kind] === 0) walls.push({ x: a[o]!, y: a[o + 1]!, nx: a[o + ATTR.normal]!, ny: a[o + ATTR.normal + 1]!, u: a[o + ATTR.uv]!, v: a[o + ATTR.uv + 1]!, len: a[o + ATTR.edge]! });
    }
    expect(walls.length).toBe(16);
    for (const w of walls) {
      // Normal points away from the footprint centre.
      expect((w.x - 5) * w.nx + (w.y - 5) * w.ny).toBeGreaterThan(0);
      expect(w.len).toBeCloseTo(10);
      expect([0, 10]).toContain(Math.round(w.u));
      expect([0, 20]).toContain(Math.round(w.v));
    }
  });
  it('lowers the roof by the parapet inside the real height and packs slots', () => {
    const mesh = new MeshBuffer();
    appendBuilding(mesh, { ...input, rings: [square(10)] });
    const roofs = [];
    for (let i = 0; i < mesh.vertexCount; i++) if (mesh.vertices[i * STRIDE + ATTR.kind] === 1) roofs.push(i);
    expect(roofs.length).toBe(4);
    for (const i of roofs) {
      expect(mesh.vertices[i * STRIDE + 2]).toBeCloseTo(19);
      expect(mesh.vertices[i * STRIDE + ATTR.top]).toBeCloseTo(20);
      expect(mesh.vertices[i * STRIDE + ATTR.slots]).toBe(2 + 16 * 1);
    }
  });
  it('skips tile-clip seam walls and keeps courtyard walls facing the courtyard', () => {
    const mesh = new MeshBuffer();
    appendBuilding(mesh, { ...input, parapet: 0, rings: [square(30), square(10, 10, 10)], skipEdge: (r, i) => r === 0 && i === 1 });
    let courtyard = 0;
    for (let i = 0; i < mesh.vertexCount; i++) {
      const o = i * STRIDE;
      const a = mesh.vertices;
      if (a[o + ATTR.kind] !== 0) continue;
      const x = a[o]!, y = a[o + 1]!;
      if (x >= 10 && x <= 20 && y >= 10 && y <= 20) {
        courtyard++;
        expect((15 - x) * a[o + ATTR.normal]! + (15 - y) * a[o + ATTR.normal + 1]!).toBeGreaterThan(0);
      }
    }
    expect(courtyard).toBe(16);
    expect(mesh.vertexCount).toBe(3 * 4 + 4 * 4 + 8); // 3 outer walls + 4 courtyard walls + roof
  });
  it('roof surface coordinates do not depend on the mesh origin', () => {
    const uvs = (ox: number) => {
      const mesh = new MeshBuffer();
      appendBuilding(mesh, { ...input, rings: [square(10, ox, 3)] });
      const out: number[] = [];
      for (let i = 0; i < mesh.vertexCount; i++) if (mesh.vertices[i * STRIDE + ATTR.kind] === 1) out.push(mesh.vertices[i * STRIDE + ATTR.uv]!, mesh.vertices[i * STRIDE + ATTR.uv + 1]!);
      return out;
    };
    expect(uvs(500)).toEqual(uvs(-120));
  });
  it('computes footprint area minus holes', () => {
    expect(footprintArea([square(30), square(10, 10, 10)])).toBeCloseTo(800);
  });
});

describe('procedural rules', () => {
  const b = { key: 'way/123:5,6', height: 12, area: 150, cx: 1000, cy: 2000 };
  it('is deterministic per seed and building', () => {
    expect(assignBuilding(MASONRY, b)).toEqual(assignBuilding(MASONRY, b));
    const other = { ...MASONRY, variation: { ...MASONRY.variation, seed: 'another-session' } };
    const differs = Array.from({ length: 50 }, (_, i) => ({ ...b, key: `k${i}` })).some((x) => assignBuilding(MASONRY, x).seed !== assignBuilding(other, x).seed);
    expect(differs).toBe(true);
  });
  it('respects height ranges (height-dependent architecture)', () => {
    for (let i = 0; i < 200; i++) {
      const low = assignBuilding(HEIGHT_ZONED_DUSK, { ...b, key: `l${i}`, height: 8 });
      const high = assignBuilding(HEIGHT_ZONED_DUSK, { ...b, key: `h${i}`, height: 120 });
      expect(HEIGHT_ZONED_DUSK.facades[low.facade]!.heightRange![1]).toBeLessThanOrEqual(14);
      expect(HEIGHT_ZONED_DUSK.facades[high.facade]!.label).toBe('high glass');
    }
    expect(eligibleFacades(MASONRY, { height: 10, area: 100 })).toEqual([0, 1]);
  });
  it('distributes treatments by weight', () => {
    const counts = [0, 0, 0];
    for (let i = 0; i < 6000; i++) counts[assignBuilding(MASONRY, { ...b, key: `w${i}`, height: 50 }).facade]!++;
    // weights 3 : 2 : 1
    expect(counts[0]! / 6000).toBeGreaterThan(0.45);
    expect(counts[0]! / 6000).toBeLessThan(0.55);
    expect(counts[2]! / 6000).toBeGreaterThan(0.12);
    expect(counts[2]! / 6000).toBeLessThan(0.21);
  });
  it('district coherence makes neighbours share treatments', () => {
    const district = { ...MASONRY, variation: { ...MASONRY.variation, districtSize: 500, districtCoherence: 1 } };
    const picks = new Set(Array.from({ length: 40 }, (_, i) => assignBuilding(district, { ...b, key: `d${i}`, cx: 10 + i, cy: 10 }).facade));
    expect(picks.size).toBe(1);
  });
  it('hashString is stable', () => {
    expect(hashString('vibenta')).toBe(hashString('vibenta'));
    expect(hashString('a')).not.toBe(hashString('b'));
  });
});

describe('contract normalisation', () => {
  it('accepts every QA fixture without issues', () => {
    for (const [name, a] of Object.entries(QA_FIXTURES)) expect(normalizeAppearance(a).issues, name).toEqual([]);
  });
  it('clamps out-of-range values and reports them', () => {
    const bad: BuildingAppearance = {
      ...MASONRY,
      strength: 3,
      facades: Array.from({ length: MAX_FACADES + 2 }, () => ({ ...MASONRY.facades[0]!, wall: { ...MASONRY.facades[0]!.wall, color: 'red', roughness: -1 } })),
    };
    const { appearance, issues } = normalizeAppearance(bad);
    expect(appearance.strength).toBe(1);
    expect(appearance.facades.length).toBe(MAX_FACADES);
    expect(appearance.facades[0]!.wall.color).toBe('#9a9a9a');
    expect(appearance.facades[0]!.wall.roughness).toBe(0.02);
    expect(issues.map((i) => i.path)).toEqual(expect.arrayContaining(['strength', 'facades', 'facades[0].wall.color', 'facades[0].wall.roughness']));
  });
});

describe('uniform packing', () => {
  it('maps asset refs to texture layers and kinds to indices', () => {
    const refs = assetRefs(MASONRY);
    const table = new Map(refs.map((r, i) => [r, i + 1]));
    const u = uniformValues(MASONRY, table);
    const wallB = u.u_fWallB!.value as Float32Array;
    expect(wallB[0]).toBe(table.get('brick_masonry.running_bond.warm'));
    expect(wallB[3]).toBe(0); // brick
    const glass = uniformValues(GLASS_MODERN, new Map());
    expect((glass.u_fWinA!.value as Float32Array)[0]).toBe(4); // curtain
    expect((glass.u_rB!.value as Float32Array)[3]).toBe(5); // solar
  });
  it('different material configs produce different shader inputs, not just colours', () => {
    const a = uniformValues(MASONRY, new Map());
    const b = uniformValues(WEATHERED_STONE_PLASTER, new Map());
    const n = uniformValues(NEUTRAL_MASSING, new Map());
    expect(Array.from(a.u_fTrimB!.value as Float32Array)).not.toEqual(Array.from(n.u_fTrimB!.value as Float32Array));
    expect((b.u_fWallC!.value as Float32Array)[2]).toBeGreaterThan(0.5); // weathering
    expect((n.u_fWinA!.value as Float32Array)[0]).toBe(0); // no windows
  });
  it('sun direction is map-anchored (x east, y south, z up)', () => {
    const [x, y, z] = sunDirection(90, 0);
    expect(x).toBeCloseTo(1);
    expect(y).toBeCloseTo(0);
    expect(z).toBeCloseTo(0);
    expect(sunDirection(0, 0)[1]).toBeCloseTo(-1); // north = −y in mercator
  });
});

describe('camera recovery', () => {
  it('recovers the eye from a view-projection matrix', () => {
    // perspective(fov 60°) × lookAt(eye → origin), column-major
    const eye = [30, -40, 120];
    const f = [-eye[0]!, -eye[1]!, -eye[2]!];
    const fl = Math.hypot(...f);
    const fw = f.map((v) => v / fl);
    const up = [0, 0, 1];
    const s = [fw[1]! * up[2]! - fw[2]! * up[1]!, fw[2]! * up[0]! - fw[0]! * up[2]!, fw[0]! * up[1]! - fw[1]! * up[0]!];
    const sl = Math.hypot(...s);
    const sx = s.map((v) => v / sl);
    const u = [sx[1]! * fw[2]! - sx[2]! * fw[1]!, sx[2]! * fw[0]! - sx[0]! * fw[2]!, sx[0]! * fw[1]! - sx[1]! * fw[0]!];
    const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
    const view = [sx[0], u[0], -fw[0], 0, sx[1], u[1], -fw[1], 0, sx[2], u[2], -fw[2], 0, -dot(sx, eye), -dot(u, eye), dot(fw, eye), 1] as number[];
    const t = 1 / Math.tan(Math.PI / 6), n = 1, fz = 1000;
    const proj = [t / 1.5, 0, 0, 0, 0, t, 0, 0, 0, 0, (fz + n) / (n - fz), -1, 0, 0, (2 * fz * n) / (n - fz), 0];
    const vp = new Float64Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let acc = 0; for (let k = 0; k < 4; k++) acc += proj[k * 4 + r]! * view[c * 4 + k]!; vp[c * 4 + r] = acc; }
    const e = eyePosition(vp)!;
    expect(e[0]).toBeCloseTo(30, 4);
    expect(e[1]).toBeCloseTo(-40, 4);
    expect(e[2]).toBeCloseTo(120, 4);
    expect(invert(new Float64Array(16))).toBeNull();
  });
});

describe('asset library', () => {
  const web = fileURLToPath(new URL('../../../../public/scene-assets/', import.meta.url));
  const lib = createAssetLibrary(JSON.parse(readFileSync(`${web}v2/manifest.json`, 'utf8')), JSON.parse(readFileSync(`${web}v1/manifest.json`, 'utf8')), '/scene-assets/');
  it('resolves every asset the fixtures reference to a real atlas cell', () => {
    for (const a of Object.values(QA_FIXTURES)) for (const ref of assetRefs(a)) {
      const r = lib.resolve(ref);
      expect(r, ref).not.toBeNull();
      expect(r!.rect[2]).toBe(256);
    }
    expect(lib.resolve('stone-blocks')?.url).toBe('/scene-assets/v1/stone-blocks.svg');
    expect(lib.resolve('not-an-asset')).toBeNull();
  });
});

describe('composability guard', () => {
  it('renderer code contains no cuisine, mood or preset-theme branches', () => {
    const dir = fileURLToPath(new URL('..', import.meta.url));
    const banned = /\b(italian|japanese|ramen|sushi|pizza|taco|cyberpunk|haunted|noir|romantic|cozy|spooky|fantasy|folk|cuisine|mood)\b/i;
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts') && n !== 'fixtures.ts')) {
      const src = readFileSync(`${dir}${f}`, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect(src, f).not.toMatch(banned);
    }
  });
});
