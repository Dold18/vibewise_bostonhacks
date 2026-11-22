/** Minimal WebGL2 helpers and float64 matrix math for camera-relative rendering. */

export type Mat4 = ArrayLike<number>;

export function compileProgram(gl: WebGL2RenderingContext, vs: string, fs: string, label: string, attribs: Record<string, number> = {}): WebGLProgram {
  const shader = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error(`[atmosphere] ${label} ${type === gl.VERTEX_SHADER ? 'vertex' : 'fragment'} shader: ${log}`);
    }
    return s;
  };
  const v = shader(gl.VERTEX_SHADER, vs);
  const f = shader(gl.FRAGMENT_SHADER, fs);
  const p = gl.createProgram()!;
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  for (const [name, loc] of Object.entries(attribs)) gl.bindAttribLocation(p, loc, name);
  gl.linkProgram(p);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`[atmosphere] ${label} link: ${gl.getProgramInfoLog(p)}`);
  return p;
}

/** Cached uniform locations for one program. */
export function uniforms(gl: WebGL2RenderingContext, program: WebGLProgram) {
  const cache = new Map<string, WebGLUniformLocation | null>();
  return (name: string) => {
    if (!cache.has(name)) cache.set(name, gl.getUniformLocation(program, name));
    return cache.get(name)!;
  };
}

/** Column-major a × b in float64. */
export function mul(a: Mat4, b: Mat4): Float64Array {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  return o;
}

/** Translate then non-uniform scale: T(t) · S(s), column-major. */
export function translateScale(t: readonly [number, number, number], s: readonly [number, number, number]): Float64Array {
  const m = new Float64Array(16);
  m[0] = s[0];
  m[5] = s[1];
  m[10] = s[2];
  m[12] = t[0];
  m[13] = t[1];
  m[14] = t[2];
  m[15] = 1;
  return m;
}

export function transform(m: Mat4, x: number, y: number, z: number): [number, number, number, number] {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
    m[3] * x + m[7] * y + m[11] * z + m[15],
  ];
}

/**
 * Camera centre of a perspective view-projection matrix: the point whose clip
 * x, y and w are all zero (rows 0, 1, 3 of M · [C, 1] = 0). Null if degenerate.
 */
export function cameraPosition(m: Mat4): [number, number, number] | null {
  const row = (r: number) => [m[r], m[4 + r], m[8 + r], m[12 + r]];
  const [a, b, c] = [row(0), row(1), row(3)];
  const det = (m3: number[][]) =>
    m3[0][0] * (m3[1][1] * m3[2][2] - m3[1][2] * m3[2][1]) -
    m3[0][1] * (m3[1][0] * m3[2][2] - m3[1][2] * m3[2][0]) +
    m3[0][2] * (m3[1][0] * m3[2][1] - m3[1][1] * m3[2][0]);
  const A = [a.slice(0, 3), b.slice(0, 3), c.slice(0, 3)];
  const rhs = [-a[3], -b[3], -c[3]];
  const D = det(A);
  if (Math.abs(D) < 1e-30) return null;
  const solve = (col: number) => det(A.map((r, i) => r.map((v, j) => (j === col ? rhs[i] : v)))) / D;
  return [solve(0), solve(1), solve(2)];
}

/** Deterministic pseudo-random seeds in [0, 1) (mulberry32). */
export function seeds(count: number, seed = 0x9e3779b9): Float32Array {
  const out = new Float32Array(count);
  let s = seed >>> 0;
  for (let i = 0; i < count; i++) {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    out[i] = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return out;
}
