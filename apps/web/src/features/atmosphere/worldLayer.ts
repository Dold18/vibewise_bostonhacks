/**
 * World-space atmosphere: a MapLibre custom layer in `3d` mode, so it shares
 * the depth buffer with the building extrusions and buildings occlude it.
 *
 * - Height fog: N horizontal slices from the ground up to 3 scale heights.
 *   Each fragment adds the optical depth of its slice along the real view ray
 *   (σ(h)·Δh / |cos θ|), so fog thickens with distance and grazing angles,
 *   pools around the lower floors of buildings, and brightens toward the scene
 *   light (forward scattering). Drifting fog banks come from periodic noise
 *   anchored to the world. A sliced volume approximation, not ray marching.
 * - Rain (lines) and snow / dust / fireflies / sparkle / petals (points):
 *   positions are computed in the vertex shader from static seeds and a time
 *   uniform, in a world-anchored volume around the view (no per-frame CPU or
 *   buffer uploads). Stylized size and speed scale with camera distance.
 *
 * All geometry is expressed in local meters around the map centre through a
 * matrix built in float64 (mercator coordinates in float32 would jitter by ~1 m).
 */
import { MercatorCoordinate, type CustomLayerInterface, type CustomRenderMethodInput, type Map as MapLibreMap } from 'maplibre-gl';
import { cameraPosition, compileProgram, mul, seeds, transform, translateScale, uniforms } from './gl';
import type { FrameState, LayerStats } from './frame';

export const WORLD_LAYER_ID = 'vb-atmosphere-world';

/** Fog extinction (1/m) at the ground for fogDensity = 1, before the centre cap. */
export const SIGMA_MAX = 0.014;
const FOG_NOISE_CELL = 320; // m
const FOG_NOISE_PERIOD = 64; // cells (the hash repeats every 64 cells)

const FOG_VS = `#version 300 es
precision highp float;
precision highp int;
in vec2 a_pos;
uniform mat4 u_matrix;
uniform float u_radius, u_dh, u_z0;
out vec3 v_world;
out float v_w;
void main() {
  float z = u_z0 + float(gl_InstanceID) * u_dh;
  v_world = vec3(a_pos * u_radius, z);
  gl_Position = u_matrix * vec4(v_world, 1.0);
  v_w = gl_Position.w;
}`;

const NOISE = `
float hash(vec2 p) { p = mod(p, ${FOG_NOISE_PERIOD.toFixed(1)}); return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}`;

const FOG_FS = `#version 300 es
precision highp float;
precision highp int;
in vec3 v_world;
in float v_w;
uniform vec3 u_cam, u_fogColor, u_lightColor;
uniform vec2 u_lightDir, u_anchor;
uniform float u_sigma, u_H, u_dh, u_time, u_drift, u_wind, u_scatter, u_centerW, u_farGain;
out vec4 fragColor;
${NOISE}
void main() {
  vec3 d = v_world - u_cam;
  float len = length(d);
  vec3 dir = d / len;
  float cosv = max(abs(dir.z), 0.035);
  vec2 wp = (v_world.xy + u_anchor) / ${FOG_NOISE_CELL.toFixed(1)} + vec2(u_time * (0.01 + 0.03 * abs(u_wind)), u_time * 0.004);
  float n = vnoise(wp);
  float bank = mix(1.0, 0.45 + 1.1 * n, u_drift);
  // Aerial perspective: extinction grows with view depth beyond the focus distance
  // (1× at the screen centre, where the legibility cap is computed, up to u_farGain far away).
  float depth = v_w / u_centerW;
  float gain = 1.0 + (u_farGain - 1.0) * smoothstep(0.85, 2.3, depth);
  float sigma = u_sigma * exp(-v_world.z / u_H) * bank * gain;
  float a = (1.0 - exp(-sigma * u_dh / cosv)) * smoothstep(0.0, 80.0, len);
  vec2 h = dir.xy / max(length(dir.xy), 1e-4);
  float fwd = pow(max(dot(h, u_lightDir), 0.0), 6.0);
  vec3 col = u_fogColor + u_lightColor * fwd * u_scatter;
  fragColor = vec4(col * a, a);
}`;

/** Shared world-anchored wrap: seeds in [0,1) → local meters, fixed to the ground while panning. */
const WRAP = `
vec2 wrapXY(vec2 seed, vec2 drift) {
  return mod(seed * 2.0 * u_R - u_anchor + drift, 2.0 * u_R) - u_R;
}`;

const RAIN_VS = `#version 300 es
precision highp float;
precision highp int;
in vec4 a_seed;
uniform mat4 u_matrix;
uniform vec2 u_anchor;
uniform float u_R, u_top, u_time, u_speed, u_len, u_wind, u_centerW;
out float v_a;
${WRAP}
void main() {
  float lane = fract(a_seed.x * 7.13);
  float fall = a_seed.z * u_top + u_time * u_speed * (0.85 + 0.3 * lane);
  float z = u_top - mod(fall, u_top);
  vec2 xy = wrapXY(a_seed.xy, vec2(u_wind * 0.35 * (u_top - z), 0.0));
  vec3 head = vec3(xy, z);
  vec3 up = normalize(vec3(-u_wind * 0.35, 0.0, 1.0));
  float tail = a_seed.w;
  gl_Position = u_matrix * vec4(head + up * u_len * tail, 1.0);
  float edge = smoothstep(0.0, 0.06 * u_top, z) * (1.0 - smoothstep(0.8 * u_top, u_top, z));
  float dist = clamp(1.7 - gl_Position.w / (u_centerW * 1.5), 0.3, 1.0);
  v_a = edge * dist * (0.55 + 0.45 * fract(a_seed.y * 13.7)) * mix(1.0, 0.1, tail);
}`;

const RAIN_FS = `#version 300 es
precision highp float;
precision highp int;
in float v_a;
uniform vec3 u_color;
uniform float u_amount;
out vec4 fragColor;
void main() {
  float a = v_a * u_amount;
  fragColor = vec4(u_color * a, a);
}`;

// kinds: 0 snow, 1 dust, 2 fireflies, 3 sparkle, 4 petals
const POINT_VS = `#version 300 es
precision highp float;
precision highp int;
in vec4 a_seed;
uniform mat4 u_matrix;
uniform vec2 u_anchor;
uniform int u_kind;
uniform float u_R, u_top, u_time, u_wind, u_centerW, u_dpr, u_sizeScale;
out float v_a;
out float v_rot;
out float v_tw;
${WRAP}
void main() {
  vec2 drift = vec2(0.0);
  float z;
  float size;
  float r1 = fract(a_seed.w * 7.31), r2 = fract(a_seed.w * 13.7);
  v_rot = 0.0;
  v_tw = 1.0;
  if (u_kind == 0) {
    float fall = a_seed.z * u_top + u_time * u_top * 0.035 * (0.6 + 0.8 * r1);
    z = u_top - mod(fall, u_top);
    drift = vec2(sin(u_time * 0.7 + r2 * 40.0) * 6.0 + u_wind * 0.4 * (u_top - z), cos(u_time * 0.5 + r1 * 30.0) * 4.0);
    size = 2.2 + 3.2 * r1;
  } else if (u_kind == 1) {
    z = mix(6.0, u_top * 0.45, a_seed.z) + sin(u_time * 0.3 + r1 * 30.0) * 8.0;
    drift = vec2(sin(u_time * 0.11 + r2 * 20.0) * 18.0 + u_wind * u_time * 2.0, cos(u_time * 0.09 + r1 * 25.0) * 14.0);
    size = 1.6 + 2.0 * r2;
    v_tw = 0.6 + 0.4 * sin(u_time * 1.3 + r1 * 50.0);
  } else if (u_kind == 2) {
    z = 1.5 + 22.0 * a_seed.z + sin(u_time * 0.8 + r1 * 20.0) * 2.5;
    drift = vec2(sin(u_time * 0.35 + r2 * 31.0) * 10.0, sin(u_time * 0.27 + r1 * 17.0) * 10.0);
    size = 5.0 + 4.0 * r2;
    float blink = sin(u_time * (1.2 + r1) + r2 * 60.0);
    v_tw = smoothstep(0.1, 0.9, blink);
  } else if (u_kind == 3) {
    z = mix(8.0, u_top * 0.6, a_seed.z);
    size = 5.0 + 5.0 * r1;
    v_tw = pow(max(sin(u_time * (2.0 + 2.0 * r2) + r1 * 80.0), 0.0), 6.0);
  } else {
    float fall = a_seed.z * u_top + u_time * u_top * 0.02 * (0.7 + 0.6 * r1);
    z = u_top * 0.7 - mod(fall, u_top * 0.7);
    drift = vec2(sin(u_time * 0.6 + r2 * 40.0) * 14.0 + u_wind * 0.6 * (u_top - z), cos(u_time * 0.4 + r1 * 30.0) * 9.0);
    size = 5.0 + 4.0 * r2;
    v_rot = u_time * (0.8 + r1) + r2 * 6.283;
  }
  vec2 xy = wrapXY(a_seed.xy, drift);
  gl_Position = u_matrix * vec4(xy, max(z, 0.3), 1.0);
  float persp = clamp(u_centerW / gl_Position.w, 0.45, 2.6);
  gl_PointSize = size * u_dpr * u_sizeScale * persp;
  float edge = smoothstep(0.0, 0.08 * u_top, z) * (1.0 - smoothstep(0.85 * u_top, u_top, z));
  v_a = (u_kind == 2 || u_kind == 3 || u_kind == 1) ? 1.0 : edge;
  v_a *= clamp(1.8 - gl_Position.w / (u_centerW * 1.4), 0.25, 1.0);
}`;

const POINT_FS = `#version 300 es
precision highp float;
precision highp int;
in float v_a;
in float v_rot;
in float v_tw;
uniform int u_kind;
uniform vec3 u_color, u_rim;
uniform float u_amount, u_occlusion;
out vec4 fragColor;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float r = length(q);
  vec3 col = u_color;
  float a;
  if (u_kind == 0) {
    a = smoothstep(0.5, 0.32, r);
    col = mix(u_rim, u_color, smoothstep(0.42, 0.18, r));
  } else if (u_kind == 1) {
    a = smoothstep(0.5, 0.0, r) * 0.7;
  } else if (u_kind == 2) {
    a = smoothstep(0.5, 0.0, r);
    a = a * a + smoothstep(0.12, 0.0, r);
  } else if (u_kind == 3) {
    float star = max(exp(-abs(q.x) * 40.0) * exp(-abs(q.y) * 5.0), exp(-abs(q.y) * 40.0) * exp(-abs(q.x) * 5.0));
    a = clamp(star + smoothstep(0.15, 0.0, r), 0.0, 1.0);
  } else {
    float c = cos(v_rot), s = sin(v_rot);
    vec2 p = mat2(c, -s, s, c) * q;
    float e = length(p / vec2(0.46, 0.24));
    a = smoothstep(1.0, 0.75, e);
    col = mix(u_rim, u_color, smoothstep(1.0, 0.55, e));
  }
  a *= v_a * v_tw * u_amount;
  fragColor = vec4(col * a, a * u_occlusion);
}`;

interface Kind {
  readonly id: number;
  readonly key: 'snow' | 'dust' | 'fireflies' | 'sparkle' | 'petals';
  /** Share of the point budget at amount 1. */
  readonly share: number;
  /** Premultiplied alpha weight: 1 = covers, < 1 = partly additive glow. */
  readonly occlusion: number;
  /** Where in the shared seed buffer this kind starts (0..1). */
  readonly seedOffset: number;
}
const KINDS: readonly Kind[] = [
  { id: 0, key: 'snow', share: 1, occlusion: 1, seedOffset: 0 },
  { id: 1, key: 'dust', share: 0.6, occlusion: 0.35, seedOffset: 0.2 },
  { id: 2, key: 'fireflies', share: 0.18, occlusion: 0.25, seedOffset: 0.8 },
  { id: 3, key: 'sparkle', share: 0.3, occlusion: 0.4, seedOffset: 0.55 },
  { id: 4, key: 'petals', share: 0.35, occlusion: 1, seedOffset: 0.4 },
];

const mix3 = (a: readonly number[], b: readonly number[], t: number) => a.map((v, i) => v + (b[i] - v) * t) as [number, number, number];

export function createWorldLayer(getFrame: () => FrameState | null, stats: LayerStats): CustomLayerInterface {
  let map: MapLibreMap | null = null;
  let gl: WebGL2RenderingContext | null = null;
  let fog: { program: WebGLProgram; u: ReturnType<typeof uniforms>; vao: WebGLVertexArrayObject; buf: WebGLBuffer } | null = null;
  let rain: { program: WebGLProgram; u: ReturnType<typeof uniforms>; vao: WebGLVertexArrayObject; buf: WebGLBuffer; count: number } | null = null;
  let points: { program: WebGLProgram; u: ReturnType<typeof uniforms>; vao: WebGLVertexArrayObject; buf: WebGLBuffer; count: number } | null = null;

  function seedBuffer(g: WebGL2RenderingContext, program: WebGLProgram, data: Float32Array) {
    const vao = g.createVertexArray()!;
    const buf = g.createBuffer()!;
    g.bindVertexArray(vao);
    g.bindBuffer(g.ARRAY_BUFFER, buf);
    g.bufferData(g.ARRAY_BUFFER, data, g.STATIC_DRAW);
    const loc = g.getAttribLocation(program, 'a_seed');
    g.enableVertexAttribArray(loc);
    g.vertexAttribPointer(loc, 4, g.FLOAT, false, 0, 0);
    g.bindVertexArray(null);
    stats.bufferBytes += data.byteLength;
    return { vao, buf };
  }

  /** (Re)allocate particle buffers only when the quality tier's maxima change. */
  function ensureParticles(g: WebGL2RenderingContext, maxRain: number, maxPoints: number) {
    if (rain && rain.count === maxRain && points && points.count === maxPoints) return;
    disposeParticles(g);
    const rp = compileProgram(g, RAIN_VS, RAIN_FS, 'rain');
    const s = seeds(maxRain * 3, 0xa11ce);
    const rainData = new Float32Array(maxRain * 8);
    for (let i = 0; i < maxRain; i++)
      for (let e = 0; e < 2; e++) rainData.set([s[i * 3], s[i * 3 + 1], s[i * 3 + 2], e], i * 8 + e * 4);
    rain = { program: rp, u: uniforms(g, rp), ...seedBuffer(g, rp, rainData), count: maxRain };
    const pp = compileProgram(g, POINT_VS, POINT_FS, 'points');
    const ps = seeds(maxPoints * 4, 0xb0b);
    points = { program: pp, u: uniforms(g, pp), ...seedBuffer(g, pp, ps), count: maxPoints };
    stats.allocations++;
  }

  function disposeParticles(g: WebGL2RenderingContext) {
    for (const r of [rain, points]) {
      if (!r) continue;
      g.deleteBuffer(r.buf);
      g.deleteVertexArray(r.vao);
      g.deleteProgram(r.program);
      stats.bufferBytes -= r.count * (r === rain ? 32 : 16);
    }
    rain = points = null;
  }

  return {
    id: WORLD_LAYER_ID,
    type: 'custom',
    renderingMode: '3d',
    onAdd(m, g) {
      map = m;
      gl = g;
      const program = compileProgram(g, FOG_VS, FOG_FS, 'fog');
      const vao = g.createVertexArray()!;
      const buf = g.createBuffer()!;
      g.bindVertexArray(vao);
      g.bindBuffer(g.ARRAY_BUFFER, buf);
      g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW);
      const loc = g.getAttribLocation(program, 'a_pos');
      g.enableVertexAttribArray(loc);
      g.vertexAttribPointer(loc, 2, g.FLOAT, false, 0, 0);
      g.bindVertexArray(null);
      fog = { program, u: uniforms(g, program), vao, buf };
      stats.bufferBytes += 32;
      stats.allocations++;
    },
    onRemove(_m, g) {
      if (fog) {
        g.deleteBuffer(fog.buf);
        g.deleteVertexArray(fog.vao);
        g.deleteProgram(fog.program);
        stats.bufferBytes -= 32;
      }
      disposeParticles(g);
      fog = null;
      map = null;
      gl = null;
    },
    render(g, args: CustomRenderMethodInput) {
      const f = getFrame();
      if (!f || !map || !gl || !fog || !f.plan.world.active) return;
      const t0 = performance.now();
      const P = f.plan.params;

      // Camera-relative frame: local meters, x east, y north, z up.
      const c = map.getCenter();
      const mc = MercatorCoordinate.fromLngLat(c, 0);
      const m = mc.meterInMercatorCoordinateUnits();
      const L = mul(args.defaultProjectionData.mainMatrix as unknown as ArrayLike<number>, translateScale([mc.x, mc.y, 0], [m, -m, m]));
      const L32 = new Float32Array(L);
      const cam = cameraPosition(L);
      if (!cam) return;
      const camDist = Math.hypot(cam[0], cam[1], cam[2]);
      const camAlt = Math.max(cam[2], 1);
      const centerW = transform(L, 0, 0, 0)[3];
      const centerMeters = [mc.x / m, -mc.y / m];
      const az = ((f.lightAzimuth + map.getBearing()) * Math.PI) / 180;
      const lightDir = [Math.sin(az), Math.cos(az)];
      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

      g.disable(g.CULL_FACE);
      g.disable(g.STENCIL_TEST);
      g.enable(g.DEPTH_TEST);
      g.depthFunc(g.LEQUAL);
      g.depthMask(false);
      g.enable(g.BLEND);
      g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA);

      // --- Height fog ---
      if (P.fogDensity > 0.004) {
        const H = 12 + 108 * P.fogHeight;
        const N = f.plan.world.fogSlices;
        const top = 3 * H;
        const dh = top / N;
        const z0 = 0.37;
        // Legibility cap: optical depth along the ray through the screen centre stays ≤ −ln(1 − centerFogMax).
        const cosC = Math.max(camAlt / camDist, 0.05);
        let S = 0;
        for (let i = 0; i < N; i++) {
          const z = z0 + i * dh;
          if (z < camAlt) S += (Math.exp(-z / H) * dh) / cosC;
        }
        const bankMax = 1 + 0.55 * P.fogDrift;
        const tauMax = f.plan.centerFogMax > 0 ? -Math.log(1 - f.plan.centerFogMax) : 0;
        const sigma = Math.min(P.fogDensity * SIGMA_MAX, S > 0 ? tauMax / (S * bankMax) : 0);
        stats.fogSigma = sigma;
        if (sigma > 0) {
          const u = fog.u;
          g.useProgram(fog.program);
          g.uniformMatrix4fv(u('u_matrix'), false, L32);
          g.uniform1f(u('u_radius'), Math.max(8000, camDist * 30));
          g.uniform1f(u('u_dh'), dh);
          g.uniform1f(u('u_z0'), z0);
          g.uniform3f(u('u_cam'), cam[0], cam[1], cam[2]);
          g.uniform1f(u('u_sigma'), sigma);
          g.uniform1f(u('u_H'), H);
          const period = FOG_NOISE_CELL * FOG_NOISE_PERIOD;
          g.uniform2f(u('u_anchor'), ((centerMeters[0] % period) + period) % period, ((centerMeters[1] % period) + period) % period);
          g.uniform1f(u('u_time'), f.time);
          g.uniform1f(u('u_drift'), P.fogDrift);
          g.uniform1f(u('u_wind'), P.wind);
          g.uniform3f(u('u_fogColor'), P.fogColor[0], P.fogColor[1], P.fogColor[2]);
          g.uniform3f(u('u_lightColor'), f.lightColor[0], f.lightColor[1], f.lightColor[2]);
          g.uniform2f(u('u_lightDir'), lightDir[0], lightDir[1]);
          g.uniform1f(u('u_scatter'), 0.18 + 0.5 * f.lightIntensity * (1 - f.darkness * 0.5));
          g.uniform1f(u('u_centerW'), centerW);
          g.uniform1f(u('u_farGain'), 1 + 5 * P.fogDensity);
          g.bindVertexArray(fog.vao);
          g.drawArraysInstanced(g.TRIANGLE_STRIP, 0, 4, N);
          stats.drawCalls++;
        }
      }

      // --- Precipitation and particles ---
      const anyParticles = P.rain > 0.004 || P.snow > 0.004 || P.dust > 0.004 || P.fireflies > 0.004 || P.sparkle > 0.004 || P.petals > 0.004;
      if (anyParticles) {
        ensureParticles(g, f.plan.world.maxRain, f.plan.world.maxPoints);
        const R = Math.max(400, camDist * 1.25);
        const top = Math.max(60, Math.min(camAlt * 0.85, camDist * 0.6));
        const anchor = [((centerMeters[0] % (2 * R)) + 2 * R) % (2 * R), ((centerMeters[1] % (2 * R)) + 2 * R) % (2 * R)];
        const dark = f.darkness;

        if (P.rain > 0.004 && rain) {
          const u = rain.u;
          g.useProgram(rain.program);
          g.uniformMatrix4fv(u('u_matrix'), false, L32);
          g.uniform2f(u('u_anchor'), anchor[0], anchor[1]);
          g.uniform1f(u('u_R'), R);
          g.uniform1f(u('u_top'), top);
          g.uniform1f(u('u_time'), f.time);
          g.uniform1f(u('u_speed'), camDist * 0.09);
          g.uniform1f(u('u_len'), camDist * 0.016);
          g.uniform1f(u('u_wind'), P.wind);
          g.uniform1f(u('u_centerW'), centerW);
          // Dark slate streaks read on a light map; pale streaks on a dark one.
          g.uniform3fv(u('u_color'), mix3([0.3, 0.37, 0.46], [0.78, 0.87, 0.96], dark));
          g.uniform1f(u('u_amount'), 0.55 + 0.45 * P.rain);
          g.bindVertexArray(rain.vao);
          g.drawArrays(g.LINES, 0, Math.round(rain.count * P.rain) * 2);
          stats.drawCalls++;
        }

        if (points) {
          const u = points.u;
          g.useProgram(points.program);
          g.uniformMatrix4fv(u('u_matrix'), false, L32);
          g.uniform2f(u('u_anchor'), anchor[0], anchor[1]);
          g.uniform1f(u('u_R'), R);
          g.uniform1f(u('u_top'), top);
          g.uniform1f(u('u_time'), f.time);
          g.uniform1f(u('u_wind'), P.wind);
          g.uniform1f(u('u_centerW'), centerW);
          g.uniform1f(u('u_dpr'), dpr);
          g.uniform1f(u('u_sizeScale'), 1);
          g.bindVertexArray(points.vao);
          const COLORS: Record<Kind['key'], [number[], number[]]> = {
            snow: [[1, 1, 1], mix3([0.55, 0.6, 0.68], [0.75, 0.82, 0.92], dark)],
            // Lit specks: warm-white glints at night, sunlit golden motes against a light daytime ground.
            dust: [mix3([0.72, 0.53, 0.22], mix3(f.lightColor, [1, 0.95, 0.85], 0.4), dark), [0, 0, 0]],
            fireflies: [[0.86, 1, 0.48], [0, 0, 0]],
            sparkle: [[...P.sparkleColor], [0, 0, 0]],
            petals: [[0.98, 0.76, 0.84], [0.85, 0.5, 0.62]],
          };
          for (const k of KINDS) {
            const amount = P[k.key];
            // Each kind reads its own stretch of the shared seed buffer so kinds never move in lockstep.
            const first = Math.floor(points.count * k.seedOffset);
            const n = Math.min(Math.round(points.count * k.share * amount), points.count - first);
            if (n > 0) {
              g.uniform1i(u('u_kind'), k.id);
              g.uniform3fv(u('u_color'), COLORS[k.key][0]);
              g.uniform3fv(u('u_rim'), COLORS[k.key][1]);
              g.uniform1f(u('u_amount'), Math.min(1, 0.6 + 0.6 * amount));
              g.uniform1f(u('u_occlusion'), k.key === 'dust' ? 0.35 + 0.55 * (1 - dark) : k.occlusion);
              g.drawArrays(g.POINTS, first, n);
              stats.drawCalls++;
            }
          }
        }
      }
      g.bindVertexArray(null);
      g.depthMask(true);
      stats.worldFrames++;
      stats.worldCpuMs += performance.now() - t0;
    },
  };
}
