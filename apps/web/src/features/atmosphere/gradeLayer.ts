/**
 * Screen-space atmosphere and cinematic treatment: a MapLibre custom layer in
 * `2d` mode inserted after the 3D buildings and before routes, the focus mask
 * and every symbol layer. It therefore grades the city itself while route
 * lines, labels and (DOM) pins draw on top untouched.
 *
 * Three full-screen passes with real blend equations:
 *   over      haze (horizon band placed from pitch + FOV, edge, ground) and color wash
 *   multiply  paper fibre + mottling, watercolor, halftone, scanlines, blueprint grid,
 *             grain shadows, colored vignette (with a centre-clear zone and a floor)
 *   screen    bloom, light shafts, light leaks, scratches, grain highlights
 *
 * Bloom is real image processing on the rendered city: the frame so far is
 * blitted to a 1/4-resolution target, bright and saturated pixels are kept,
 * blurred separably, then screened back. Labels are not yet drawn, so they
 * never smear. Shafts and leaks are screen-space approximations.
 */
import type { CustomLayerInterface, CustomRenderMethodInput, Map as MapLibreMap } from 'maplibre-gl';
import { TEXTURE_ASSETS, type TextureSlot } from './assets';
import { EPSILON } from './params';
import { compileProgram, uniforms } from './gl';
import type { FrameState, LayerStats } from './frame';
import type { TextureStore } from './textures';

export const GRADE_LAYER_ID = 'vb-atmosphere-grade';

const FULLSCREEN_VS = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() { v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const GRADE_FS = `#version 300 es
precision highp float;
precision highp int;
in vec2 v_uv;
uniform int u_pass;
uniform vec2 u_res;
uniform float u_dpr, u_time, u_motion, u_horizonY;
uniform vec2 u_lightScreen;
uniform float u_hazeH, u_hazeE, u_hazeG, u_wash;
uniform vec3 u_hazeColor, u_washTop, u_washBottom;
uniform float u_grain, u_grainSize, u_paper, u_watercolor, u_halftone, u_scanlines, u_grid, u_scratches, u_vignette;
uniform vec3 u_vignetteColor, u_paperColor, u_gridColor;
uniform float u_glow, u_shafts, u_leak, u_bloomOn;
uniform vec3 u_glowColor, u_shaftColor, u_leakColor;
uniform sampler2D t_grain, t_paper, t_mottle, t_watercolor, t_halftone, t_scanlines, t_grid, t_scratches, t_bloom;
uniform vec4 u_meanA; // grain, paper, mottle, watercolor
out vec4 fragColor;

float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float shaftBeams(vec2 c, float aspect) {
  vec2 src = (u_lightScreen * vec2(1.05, 1.1)) * vec2(aspect, 1.0);
  vec2 d = c - src;
  float r = length(d);
  float ang = atan(d.y, d.x);
  float beams = vnoise(vec2(ang * 11.0, u_time * 0.04)) * 0.6 + vnoise(vec2(ang * 27.0 + 4.0, u_time * 0.07)) * 0.4;
  beams = pow(smoothstep(0.35, 0.95, beams), 1.6);
  return beams * exp(-r * 1.05) * smoothstep(0.05, 0.45, r);
}

void main() {
  float aspect = u_res.x / u_res.y;
  vec2 css = gl_FragCoord.xy / u_dpr;           // CSS pixels: textures keep their designed scale on any DPR
  vec2 c = (v_uv - 0.5) * vec2(aspect, 1.0);
  float centre = 1.0 - smoothstep(0.08, 0.42, length(c));   // 1 in the focus area
  // Film-like jitter of grain/scratches: steps ~12×/s, frozen when motion is 0.
  float step12 = floor(u_time * 12.0);
  vec2 jitter = u_motion > 0.0 ? vec2(hash(vec2(step12, 1.7)), hash(vec2(3.1, step12))) * 256.0 : vec2(0.0);

  if (u_pass == 0) {
    // ---- over: haze and wash ----
    float hz = u_hazeH * exp(-max(u_horizonY - v_uv.y, 0.0) * 2.6);
    float edge = u_hazeE * smoothstep(0.32, 0.95, length(c * vec2(0.9, 1.1)));
    float ground = u_hazeG * smoothstep(0.5, 0.0, v_uv.y);
    float n = vnoise(c * 3.0 + vec2(u_time * 0.025, u_time * 0.01)) * 0.6 + vnoise(c * 7.0 - u_time * 0.02) * 0.4;
    float a = clamp((hz + edge + ground) * (0.7 + 0.6 * n), 0.0, 0.85) * (1.0 - 0.35 * centre);
    vec4 haze = vec4(u_hazeColor * a, a);
    float wa = u_wash * 0.42;
    vec3 wc = mix(u_washBottom, u_washTop, smoothstep(0.0, 1.0, v_uv.y));
    vec4 wash = vec4(wc * wa, wa);
    // Shafts as lit haze: a tinted veil, so beams read on a light daytime ground too.
    float sa = u_shafts > 0.0 ? shaftBeams(c, aspect) * u_shafts * 0.42 : 0.0;
    vec4 beam = vec4(u_shaftColor * sa, sa);
    vec4 hw = haze + wash * (1.0 - haze.a);
    fragColor = beam + hw * (1.0 - beam.a);
    return;
  }

  // Shared texture reads.
  float gscale = mix(0.75, 2.2, u_grainSize);
  float g = (lum(texture(t_grain, (css + jitter) / (256.0 * gscale)).rgb) - u_meanA.x) * 6.0;

  if (u_pass == 1) {
    // ---- multiply: print, grain shadows, vignette ----
    vec3 m = vec3(1.0);
    float printK = 1.0 - 0.3 * centre;
    if (u_paper > 0.0) {
      float fibre = (lum(texture(t_paper, css / 256.0).rgb) - u_meanA.y) * 3.0;
      float mottle = (lum(texture(t_mottle, css / 720.0).rgb) - u_meanA.z) * 2.5;
      vec3 paper = u_paperColor * (1.0 + 0.55 * (fibre + mottle));
      m *= mix(vec3(1.0), paper, u_paper * printK);
    }
    if (u_watercolor > 0.0) {
      vec2 wuv = css / 900.0 + vec2(vnoise(css / 300.0), vnoise(css / 300.0 + 7.0)) * 0.05;
      float w = (lum(texture(t_watercolor, wuv).rgb) - u_meanA.w) * 3.0;
      float granulate = vnoise(css / 3.0) - 0.5;
      vec3 pigment = mix(vec3(1.0), u_paperColor, 0.5) * (1.0 + 0.7 * w + 0.12 * granulate);
      m *= mix(vec3(1.0), pigment, u_watercolor * printK);
    }
    if (u_halftone > 0.0) {
      float dots = texture(t_halftone, css / 128.0).r;
      m *= 1.0 - dots * 0.55 * u_halftone * printK;
    }
    if (u_scanlines > 0.0) {
      float lines = texture(t_scanlines, css / 128.0).r;
      m *= 1.0 - lines * 0.45 * u_scanlines;
    }
    if (u_grid > 0.0) {
      float grid = texture(t_grid, css / 256.0).r;
      m *= mix(vec3(1.0), u_gridColor, grid * u_grid * 0.85);
    }
    if (u_grain > 0.0) m *= 1.0 + min(g, 0.0) * 0.55 * u_grain;
    if (u_vignette > 0.0) {
      float v = smoothstep(0.36, 1.0, length(c * vec2(0.82, 1.0)) * 1.18);
      m *= mix(vec3(1.0), u_vignetteColor, v * u_vignette * 0.9);
    }
    fragColor = vec4(max(m, vec3(0.42)), 1.0);
    return;
  }

  // ---- screen: bloom, shafts, leaks, scratches, grain highlights ----
  vec3 s = vec3(0.0);
  if (u_grain > 0.0) s += vec3(max(g, 0.0) * 0.28 * u_grain);
  if (u_glow > 0.0) {
    if (u_bloomOn > 0.5) {
      vec3 b = texture(t_bloom, v_uv).rgb;
      s += b * u_glow * 1.8 * mix(vec3(1.0), u_glowColor, 0.45);
    } else {
      vec2 lp = vec2(0.5) + u_lightScreen * 0.75;
      s += u_glowColor * u_glow * 0.2 * exp(-length((v_uv - lp) * vec2(aspect, 1.0)) * 2.4);
    }
  }
  if (u_shafts > 0.0) s += u_shaftColor * shaftBeams(c, aspect) * u_shafts * 0.85;
  if (u_leak > 0.0) {
    vec2 lp = vec2(-0.08, 0.78 + 0.08 * sin(u_time * 0.12)) * vec2(aspect, 1.0) - vec2(aspect * 0.5, 0.5);
    float l = exp(-length(c - lp) * 1.9);
    s += u_leakColor * l * u_leak * 0.9;
  }
  if (u_scratches > 0.0) {
    float sc = texture(t_scratches, (css + jitter * vec2(1.0, 0.0)) / vec2(256.0, 512.0)).r;
    s += vec3(sc * u_scratches * 0.55);
  }
  fragColor = vec4(clamp(s, 0.0, 1.0), 0.0);
}`;

const BLUR_FS = `#version 300 es
precision highp float;
precision highp int;
in vec2 v_uv;
uniform sampler2D u_src;
uniform vec2 u_step;
uniform float u_threshold;
uniform int u_extract;
out vec4 fragColor;
vec3 pick(vec2 uv) {
  vec3 c = texture(u_src, uv).rgb;
  if (u_extract == 1) {
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float hi = max(c.r, max(c.g, c.b));
    float sat = hi - min(c.r, min(c.g, c.b));
    float k = max(smoothstep(u_threshold, u_threshold + 0.18, l), smoothstep(0.3, 0.75, sat) * smoothstep(u_threshold - 0.2, u_threshold + 0.05, hi));
    c *= k;
  }
  return c;
}
void main() {
  vec3 acc = pick(v_uv) * 0.2270;
  acc += (pick(v_uv + u_step * 1.3846) + pick(v_uv - u_step * 1.3846)) * 0.3162;
  acc += (pick(v_uv + u_step * 3.2308) + pick(v_uv - u_step * 3.2308)) * 0.0703;
  fragColor = vec4(acc, 1.0);
}`;

const GRADE_TEXTURES: readonly TextureSlot[] = ['grain', 'paper', 'mottle', 'watercolor', 'halftone', 'scanlines', 'grid', 'scratches'];

interface Target {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
}

export function createGradeLayer(getFrame: () => FrameState | null, stats: LayerStats, textures: TextureStore): CustomLayerInterface {
  let map: MapLibreMap | null = null;
  let grade: { program: WebGLProgram; u: ReturnType<typeof uniforms> } | null = null;
  let blur: { program: WebGLProgram; u: ReturnType<typeof uniforms> } | null = null;
  let quad: { vao: WebGLVertexArrayObject; buf: WebGLBuffer } | null = null;
  let bloom: { w: number; h: number; a: Target; b: Target } | null = null;

  const makeTarget = (gl: WebGL2RenderingContext, w: number, h: number): Target => {
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { fbo, tex };
  };

  const disposeBloom = (gl: WebGL2RenderingContext) => {
    if (!bloom) return;
    for (const t of [bloom.a, bloom.b]) {
      gl.deleteFramebuffer(t.fbo);
      gl.deleteTexture(t.tex);
    }
    stats.framebufferBytes -= bloom.w * bloom.h * 8;
    bloom = null;
  };

  /** Threshold + separable blur of the city rendered so far, at 1/4 resolution. Returns the result texture. */
  function runBloom(gl: WebGL2RenderingContext, threshold: number): WebGLTexture | null {
    if (!blur || !quad) return null;
    const W = gl.drawingBufferWidth;
    const H = gl.drawingBufferHeight;
    if (gl.getContextAttributes()?.antialias) return null; // scaled blits from multisampled buffers are invalid
    const w = Math.max(1, Math.floor(W / 4));
    const h = Math.max(1, Math.floor(H / 4));
    if (!bloom || bloom.w !== w || bloom.h !== h) {
      disposeBloom(gl);
      bloom = { w, h, a: makeTarget(gl, w, h), b: makeTarget(gl, w, h) };
      stats.framebufferBytes += w * h * 8;
      stats.allocations++;
    }
    const prev = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const prevViewport = gl.getParameter(gl.VIEWPORT) as Int32Array;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, prev);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, bloom.a.fbo);
    gl.blitFramebuffer(0, 0, W, H, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.LINEAR);

    gl.disable(gl.BLEND);
    gl.viewport(0, 0, w, h);
    gl.useProgram(blur.program);
    gl.bindVertexArray(quad.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(blur.u('u_src'), 0);
    gl.uniform1f(blur.u('u_threshold'), threshold);
    // a → b (extract + horizontal), b → a (vertical)
    gl.bindFramebuffer(gl.FRAMEBUFFER, bloom.b.fbo);
    gl.bindTexture(gl.TEXTURE_2D, bloom.a.tex);
    gl.uniform1i(blur.u('u_extract'), 1);
    gl.uniform2f(blur.u('u_step'), 1 / w, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, bloom.a.fbo);
    gl.bindTexture(gl.TEXTURE_2D, bloom.b.tex);
    gl.uniform1i(blur.u('u_extract'), 0);
    gl.uniform2f(blur.u('u_step'), 0, 1 / h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, prev);
    gl.viewport(prevViewport[0], prevViewport[1], prevViewport[2], prevViewport[3]);
    stats.bloomPasses++;
    stats.drawCalls += 2;
    return bloom.a.tex;
  }

  return {
    id: GRADE_LAYER_ID,
    type: 'custom',
    renderingMode: '2d',
    onAdd(m, gl) {
      map = m;
      // Both programs bind a_pos to location 0 so they share one VAO.
      const gp = compileProgram(gl, FULLSCREEN_VS, GRADE_FS, 'grade', { a_pos: 0 });
      const bp = compileProgram(gl, FULLSCREEN_VS, BLUR_FS, 'bloom', { a_pos: 0 });
      grade = { program: gp, u: uniforms(gl, gp) };
      blur = { program: bp, u: uniforms(gl, bp) };
      const vao = gl.createVertexArray()!;
      const buf = gl.createBuffer()!;
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      quad = { vao, buf };
      stats.bufferBytes += 24;
      stats.allocations++;
    },
    onRemove(_m, gl) {
      if (grade) gl.deleteProgram(grade.program);
      if (blur) gl.deleteProgram(blur.program);
      if (quad) {
        gl.deleteBuffer(quad.buf);
        gl.deleteVertexArray(quad.vao);
        stats.bufferBytes -= 24;
      }
      disposeBloom(gl);
      textures.dispose(gl);
      grade = blur = quad = null;
      map = null;
    },
    render(gl, args: CustomRenderMethodInput) {
      const f = getFrame();
      if (!f || !map || !grade || !quad || !f.plan.grade.active) return;
      const t0 = performance.now();
      const P = f.plan.params;

      // Lazy assets: request what is on, upload what arrived.
      for (const a of TEXTURE_ASSETS) if (a.usedBy.some((k) => P[k] >= EPSILON)) textures.request(a.slot);
      textures.flushUploads(gl);

      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.STENCIL_TEST);
      gl.disable(gl.CULL_FACE);
      gl.depthMask(false);

      const bloomTex = f.plan.grade.bloom && P.glow >= EPSILON ? runBloom(gl, P.glowThreshold) : null;

      const u = grade.u;
      gl.useProgram(grade.program);
      gl.bindVertexArray(quad.vao);
      const W = gl.drawingBufferWidth;
      const H = gl.drawingBufferHeight;
      const dpr = W / Math.max(1, map.getCanvas().clientWidth || W);
      const pitch = (map.getPitch() * Math.PI) / 180;
      const offset = Math.tan(Math.PI / 2 - pitch) / Math.tan(args.fov / 2);
      const az = (f.lightAzimuth * Math.PI) / 180;
      gl.uniform2f(u('u_res'), W, H);
      gl.uniform1f(u('u_dpr'), dpr);
      gl.uniform1f(u('u_time'), f.time);
      gl.uniform1f(u('u_motion'), P.motion);
      gl.uniform1f(u('u_horizonY'), Math.min(0.5 + 0.5 * offset, 50));
      gl.uniform2f(u('u_lightScreen'), Math.sin(az), Math.cos(az));
      const scalars: Array<[string, number]> = [
        ['u_hazeH', P.hazeHorizon], ['u_hazeE', P.hazeEdge], ['u_hazeG', P.hazeGround], ['u_wash', P.wash],
        ['u_grain', P.grain], ['u_grainSize', P.grainSize], ['u_paper', P.paper], ['u_watercolor', P.watercolor],
        ['u_halftone', P.halftone], ['u_scanlines', P.scanlines], ['u_grid', P.grid], ['u_scratches', P.scratches],
        ['u_vignette', P.vignette], ['u_glow', P.glow], ['u_shafts', P.shafts], ['u_leak', P.leak], ['u_bloomOn', bloomTex ? 1 : 0],
      ];
      for (const [name, v] of scalars) gl.uniform1f(u(name), v >= EPSILON ? v : 0);
      const colors: Array<[string, readonly number[]]> = [
        ['u_hazeColor', P.hazeColor], ['u_washTop', P.washTop], ['u_washBottom', P.washBottom], ['u_vignetteColor', P.vignetteColor],
        ['u_paperColor', P.paperColor], ['u_gridColor', P.gridColor], ['u_glowColor', P.glowColor], ['u_shaftColor', P.shaftColor], ['u_leakColor', P.leakColor],
      ];
      for (const [name, v] of colors) gl.uniform3f(u(name), v[0], v[1], v[2]);

      const means: number[] = [];
      GRADE_TEXTURES.forEach((slot, i) => {
        const t = textures.get(gl, slot);
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, t.tex);
        gl.uniform1i(u(`t_${slot}`), i);
        means.push(t.mean);
      });
      gl.uniform4f(u('u_meanA'), means[0], means[1], means[2], means[3]);
      gl.activeTexture(gl.TEXTURE0 + GRADE_TEXTURES.length);
      gl.bindTexture(gl.TEXTURE_2D, bloomTex ?? textures.get(gl, 'grain').tex);
      gl.uniform1i(u('t_bloom'), GRADE_TEXTURES.length);

      gl.enable(gl.BLEND);
      const over = P.hazeHorizon + P.hazeEdge + P.hazeGround + P.wash + P.shafts >= EPSILON;
      const multiply = P.paper + P.watercolor + P.halftone + P.scanlines + P.grid + P.grain + P.vignette >= EPSILON;
      const screen = P.grain + P.glow + P.shafts + P.leak + P.scratches >= EPSILON;
      if (over) {
        gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
        gl.uniform1i(u('u_pass'), 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        stats.drawCalls++;
      }
      if (multiply) {
        gl.blendFuncSeparate(gl.DST_COLOR, gl.ZERO, gl.ZERO, gl.ONE);
        gl.uniform1i(u('u_pass'), 1);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        stats.drawCalls++;
      }
      if (screen) {
        gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_COLOR, gl.ZERO, gl.ONE);
        gl.uniform1i(u('u_pass'), 2);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        stats.drawCalls++;
      }
      gl.bindVertexArray(null);
      gl.activeTexture(gl.TEXTURE0);
      stats.gradeFrames++;
      stats.gradeCpuMs += performance.now() - t0;
    },
  };
}
