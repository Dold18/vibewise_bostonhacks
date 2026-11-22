/**
 * MapLibre custom 3D layer that re-extrudes the real OpenMapTiles building
 * footprints and shades them with the composable appearance configuration.
 *
 * Why a custom layer instead of `fill-extrusion-pattern`: the native pattern
 * is one image per layer for both walls and roofs, scaled in screen/tile
 * pixels, with no notion of storeys, bays, wall edges, trim, glow or roughness.
 * Here every vertex carries surface metres, so patterns are attached to the
 * building geometry and architecture follows each wall's real length/height.
 */
import { MercatorCoordinate, type CustomLayerInterface, type CustomRenderMethodInput, type Map as MapLibreMap } from 'maplibre-gl';
import type { BuildingAppearance } from './contract';
import { ATTR, MeshBuffer, STRIDE, appendBuilding, centroid, cleanRing, footprintArea, type Ring } from './geometry';
import { assignBuilding } from './rules';
import { FRAGMENT_SHADER, VERTEX_SHADER } from './shaders';
import { sunDirection, uniformValues, type LayerTable, type UniformValue } from './uniforms';

/** Equatorial circumference MapLibre uses for mercator metres. */
const EARTH_CIRCUMFERENCE = 2 * Math.PI * 6371008.8;
/** OpenMapTiles' building layer is cut at z14; walls on its seams are clip artefacts. */
const SOURCE_MAX_ZOOM = 14;

export interface RendererOptions {
  id: string;
  sourceId: string;
  sourceLayer: string;
  /** Max buildings in the mesh (nearest to the build centre win). */
  maxBuildings: number;
  /** The mesh covers the visible bounds padded by this fraction on each side; leaving it triggers a rebuild. */
  boundsPadding: number;
  /** Read each frame: the native layers' current opacity / their nominal opacity (pitch fade parity). */
  opacity: () => number;
  /** Neutral building colour for `strength` blending. */
  neutralColor: () => [number, number, number];
  onStats?: (s: RendererStats) => void;
}

export interface RendererStats {
  buildings: number;
  vertices: number;
  triangles: number;
  features: number;
  harvestMs: number;
  buildMs: number;
  uploads: number;
  /** Appearance changes applied without a mesh rebuild (structure unchanged). */
  uniformUpdates: number;
  lastRenderCpuMs: number;
  skippedSeamEdges: number;
  /** Mean GPU time of the building draw over recent frames (ms); null when timer queries are unavailable. */
  gpuDrawMs?: number | null;
  /** Dev diagnostics: where the look is on the shared scene clock. */
  transition?: { pending: boolean; meshStaged: boolean; fade: number; interpolating: boolean; releasing: boolean };
}

interface CachedBuilding {
  key: string;
  /** Rings in mercator units. */
  rings: Float64Array[];
  height: number;
  minHeight: number;
  area: number;
  gx: number;
  gy: number;
  mx: number;
  my: number;
  /** Per ring, per edge: lies on a z14 tile clip seam. */
  seams: Uint8Array[];
}

function lngLatToMerc(lng: number, lat: number): [number, number] {
  const x = (180 + lng) / 360;
  const y = (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360;
  return [x, y];
}

function isSeam(ax: number, ay: number, bx: number, by: number): boolean {
  const s = 1 << SOURCE_MAX_ZOOM;
  const near = (v: number) => Math.abs(v - Math.round(v)) < 0.03;
  const tax = ax * s, tbx = bx * s, tay = ay * s, tby = by * s;
  if (Math.abs(tax - tbx) < 1e-7 && near(tax) && near(tbx)) return true;
  if (Math.abs(tay - tby) < 1e-7 && near(tay) && near(tby)) return true;
  return false;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(`building shader compile failed: ${log}`);
  }
  return s;
}

/** Column-major 4×4 multiply (Float64). */
function mul(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r]! * b[c * 4 + k]!;
      o[c * 4 + r] = s;
    }
  return o;
}

/** General 4×4 inverse (column-major); null when singular. */
export function invert(m: ArrayLike<number>): Float64Array | null {
  const a = Array.from(m);
  const inv = new Float64Array(16);
  inv[0] = a[5]*a[10]*a[15] - a[5]*a[11]*a[14] - a[9]*a[6]*a[15] + a[9]*a[7]*a[14] + a[13]*a[6]*a[11] - a[13]*a[7]*a[10];
  inv[4] = -a[4]*a[10]*a[15] + a[4]*a[11]*a[14] + a[8]*a[6]*a[15] - a[8]*a[7]*a[14] - a[12]*a[6]*a[11] + a[12]*a[7]*a[10];
  inv[8] = a[4]*a[9]*a[15] - a[4]*a[11]*a[13] - a[8]*a[5]*a[15] + a[8]*a[7]*a[13] + a[12]*a[5]*a[11] - a[12]*a[7]*a[9];
  inv[12] = -a[4]*a[9]*a[14] + a[4]*a[10]*a[13] + a[8]*a[5]*a[14] - a[8]*a[6]*a[13] - a[12]*a[5]*a[10] + a[12]*a[6]*a[9];
  inv[1] = -a[1]*a[10]*a[15] + a[1]*a[11]*a[14] + a[9]*a[2]*a[15] - a[9]*a[3]*a[14] - a[13]*a[2]*a[11] + a[13]*a[3]*a[10];
  inv[5] = a[0]*a[10]*a[15] - a[0]*a[11]*a[14] - a[8]*a[2]*a[15] + a[8]*a[3]*a[14] + a[12]*a[2]*a[11] - a[12]*a[3]*a[10];
  inv[9] = -a[0]*a[9]*a[15] + a[0]*a[11]*a[13] + a[8]*a[1]*a[15] - a[8]*a[3]*a[13] - a[12]*a[1]*a[11] + a[12]*a[3]*a[9];
  inv[13] = a[0]*a[9]*a[14] - a[0]*a[10]*a[13] - a[8]*a[1]*a[14] + a[8]*a[2]*a[13] + a[12]*a[1]*a[10] - a[12]*a[2]*a[9];
  inv[2] = a[1]*a[6]*a[15] - a[1]*a[7]*a[14] - a[5]*a[2]*a[15] + a[5]*a[3]*a[14] + a[13]*a[2]*a[7] - a[13]*a[3]*a[6];
  inv[6] = -a[0]*a[6]*a[15] + a[0]*a[7]*a[14] + a[4]*a[2]*a[15] - a[4]*a[3]*a[14] - a[12]*a[2]*a[7] + a[12]*a[3]*a[6];
  inv[10] = a[0]*a[5]*a[15] - a[0]*a[7]*a[13] - a[4]*a[1]*a[15] + a[4]*a[3]*a[13] + a[12]*a[1]*a[7] - a[12]*a[3]*a[5];
  inv[14] = -a[0]*a[5]*a[14] + a[0]*a[6]*a[13] + a[4]*a[1]*a[14] - a[4]*a[2]*a[13] - a[12]*a[1]*a[6] + a[12]*a[2]*a[5];
  inv[3] = -a[1]*a[6]*a[11] + a[1]*a[7]*a[10] + a[5]*a[2]*a[11] - a[5]*a[3]*a[10] - a[9]*a[2]*a[7] + a[9]*a[3]*a[6];
  inv[7] = a[0]*a[6]*a[11] - a[0]*a[7]*a[10] - a[4]*a[2]*a[11] + a[4]*a[3]*a[10] + a[8]*a[2]*a[7] - a[8]*a[3]*a[6];
  inv[11] = -a[0]*a[5]*a[11] + a[0]*a[7]*a[9] + a[4]*a[1]*a[11] - a[4]*a[3]*a[9] - a[8]*a[1]*a[7] + a[8]*a[3]*a[5];
  inv[15] = a[0]*a[5]*a[10] - a[0]*a[6]*a[9] - a[4]*a[1]*a[10] + a[4]*a[2]*a[9] + a[8]*a[1]*a[6] - a[8]*a[2]*a[5];
  const det = a[0]*inv[0] + a[1]*inv[4] + a[2]*inv[8] + a[3]*inv[12];
  if (!det) return null;
  for (let i = 0; i < 16; i++) inv[i]! /= det;
  return inv;
}

/**
 * Eye position in the frame of a perspective view-projection matrix: the
 * point that projects to clip (0, 0, k, 0), i.e. inv(M)·(0,0,1,0) dehomogenised.
 */
export function eyePosition(m: ArrayLike<number>): [number, number, number] | null {
  const inv = invert(m);
  if (!inv) return null;
  const x = inv[8]!, y = inv[9]!, z = inv[10]!, w = inv[11]!;
  if (Math.abs(w) < 1e-12) return null;
  return [x / w, y / w, z / w];
}

export class BuildingAppearanceLayer implements CustomLayerInterface {
  readonly id: string;
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;

  private map: MapLibreMap | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private vbo: WebGLBuffer | null = null;
  private ibo: WebGLBuffer | null = null;
  private texture: WebGLTexture | null = null;
  private uniforms = new Map<string, WebGLUniformLocation | null>();
  private indexCount = 0;
  private origin: [number, number] = [0, 0];
  private mpu = 1;
  /** Mercator [minX, minY, maxX, maxY] the current mesh covers, and the zoom it was built at. */
  private built: { box: [number, number, number, number]; zoom: number } | null = null;
  private appearance: BuildingAppearance | null = null;
  /** Staged appearance (and atlas) waiting for its mesh: committed atomically, never half-applied. */
  private next: { a: BuildingAppearance; layers: StagedLayers | null } | null = null;
  /** The rebuilt mesh for `next`, uploaded at commit time. */
  private staged: (() => void) | null = null;
  /** Strength multiplier on the shared scene clock: dips toward the neutral base around a swap. */
  private fade = { from: 1, to: 1, start: 0, dur: 0 };
  private fadeInMs = 0;
  /** Uniform-only changes interpolate from the values on screen to the new ones. */
  private lerp: { from: Record<string, UniformValue>; start: number; dur: number } | null = null;
  /** Called once the first mesh is on the GPU (the host hides native extrusions only then). */
  private firstUpload: (() => void) | null = null;
  private releasing: { resolve: () => void } | null = null;
  private layers: LayerTable = new Map();
  private packed: Record<string, UniformValue> | null = null;
  private pendingLayers: Uint8ClampedArray[] | null = null;
  private layerSize = 512;
  private cache = new Map<string, CachedBuilding>();
  private dirty = true;
  private structure = '';
  private rebuildTimer: number | null = null;
  private stats: RendererStats = { buildings: 0, vertices: 0, triangles: 0, features: 0, harvestMs: 0, buildMs: 0, uploads: 0, lastRenderCpuMs: 0, skippedSeamEdges: 0, uniformUpdates: 0 };
  private readonly opts: RendererOptions;
  private timerExt: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null = null;
  private queries: WebGLQuery[] = [];
  private gpuSamples: number[] = [];

  constructor(opts: RendererOptions) {
    this.opts = opts;
    this.id = opts.id;
  }

  // ---------- public ----------
  setAppearance(a: BuildingAppearance) {
    this.stage(a, null, 0);
  }

  /**
   * Show `a` on the shared scene clock (`durationMs`, 0 = at once).
   * - Same structure and atlas (colours, windows, glow, lighting, navigation calm): the uniforms
   *   interpolate from what is on screen; enum-coded values switch at the midpoint.
   * - New structure or atlas: the old look dips toward the neutral base while the new mesh is
   *   built; mesh, atlas and uniforms then swap in one frame and the new look rises. Nothing is
   *   ever drawn half-applied (new uniforms on the old mesh, or a new atlas under old facades).
   * A newer call replaces a staged one: the latest scene wins.
   */
  stage(a: BuildingAppearance, layers: StagedLayers | null, durationMs: number) {
    const now = performance.now();
    // A new look during a release cancels it: the restyle rises again instead of vanishing.
    if (this.releasing) {
      const pending = this.releasing;
      this.releasing = null;
      pending.resolve();
      this.fade = { from: this.fadeK(now), to: 1, start: now, dur: Math.max(1, durationMs) };
    }
    const instant = durationMs <= 0 || !this.appearance || this.indexCount === 0;
    if (!layers && !this.next && structuralKey(a) === this.structure && this.appearance) {
      const from = this.currentUniforms(now);
      this.appearance = a;
      this.packed = null;
      this.lerp = instant ? null : { from, start: now, dur: durationMs };
      this.stats.uniformUpdates++;
      this.map?.triggerRepaint();
      return;
    }
    // Keep an atlas that is still staged when a newer appearance replaces it without one.
    this.next = { a, layers: layers ?? this.next?.layers ?? null };
    this.staged = null;
    if (instant) {
      // First look: rises from the neutral base once its mesh exists. Otherwise hold what is on screen until the swap.
      const first = !this.appearance;
      const k = first ? 0 : this.fadeK(now);
      this.fade = { from: k, to: k, start: now, dur: 0 };
      this.fadeInMs = first ? Math.max(0, durationMs) : 0;
    } else {
      this.fade = { from: this.fadeK(now), to: FADE_FLOOR, start: now, dur: Math.min(320, durationMs * 0.4) };
      this.fadeInMs = Math.min(520, durationMs * 0.6);
    }
    this.dirty = true;
    this.scheduleRebuild(0);
    this.map?.triggerRepaint();
  }

  /** Fade the restyle out to the neutral base (resolves when invisible, or at once if nothing is shown). */
  release(durationMs: number): Promise<void> {
    if (!this.appearance || this.indexCount === 0 || durationMs <= 0) return Promise.resolve();
    const now = performance.now();
    this.next = null;
    this.staged = null;
    this.fade = { from: this.fadeK(now), to: 0, start: now, dur: durationMs };
    this.map?.triggerRepaint();
    return new Promise((resolve) => { this.releasing = { resolve }; });
  }

  onFirstUpload(fn: () => void) {
    if (this.indexCount > 0) fn();
    else this.firstUpload = fn;
  }

  /** Texture layers (index 0 is plain white) and the ref→layer table. */
  setTextureLayers(pixels: Uint8ClampedArray[], table: LayerTable, size: number) {
    this.pendingLayers = pixels;
    this.layers = table;
    this.packed = null;
    this.layerSize = size;
    this.map?.triggerRepaint();
  }

  /** The fade multiplier at `now` (smoothstep on the shared clock). */
  private fadeK(now: number): number {
    const f = this.fade;
    if (f.dur <= 0) return f.to;
    const t = Math.min(1, Math.max(0, (now - f.start) / f.dur));
    return f.from + (f.to - f.from) * t * t * (3 - 2 * t);
  }

  /** The uniform values on screen right now (mid-interpolation included). */
  private currentUniforms(now: number): Record<string, UniformValue> {
    const target = (this.packed ??= uniformValues(this.appearance!, this.layers));
    const l = this.lerp;
    if (!l) return target;
    const t = Math.min(1, Math.max(0, (now - l.start) / l.dur));
    return blendUniforms(l.from, target, t * t * (3 - 2 * t));
  }

  getStats(): RendererStats {
    const g = this.gpuSamples;
    const now = performance.now();
    const transition = { pending: !!this.next, meshStaged: !!this.staged, fade: Math.round(this.fadeK(now) * 100) / 100, interpolating: !!this.lerp && now < this.lerp.start + this.lerp.dur, releasing: !!this.releasing };
    return { ...this.stats, gpuDrawMs: g.length ? g.reduce((a, b) => a + b, 0) / g.length : null, transition };
  }

  /** Resolve finished GPU timer queries (EXT_disjoint_timer_query_webgl2, when the browser exposes it). */
  private collectGpuTimes(gl: WebGL2RenderingContext) {
    const ext = this.timerExt;
    if (!ext) return;
    while (this.queries.length && gl.getQueryParameter(this.queries[0]!, gl.QUERY_RESULT_AVAILABLE)) {
      const q = this.queries.shift()!;
      if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) {
        this.gpuSamples.push((gl.getQueryParameter(q, gl.QUERY_RESULT) as number) / 1e6);
        if (this.gpuSamples.length > 60) this.gpuSamples.shift();
      }
      gl.deleteQuery(q);
    }
  }

  // ---------- CustomLayerInterface ----------
  onAdd(map: MapLibreMap, gl: WebGL2RenderingContext) {
    this.map = map;
    this.gl = gl;
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`building program link failed: ${gl.getProgramInfoLog(program)}`);
    this.program = program;
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(program, i)!;
      const name = info.name.replace(/\[0\]$/, '');
      this.uniforms.set(name, gl.getUniformLocation(program, name));
    }
    this.vbo = gl.createBuffer();
    this.ibo = gl.createBuffer();
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    const attrib = (name: string, size: number, offset: number) => {
      const loc = gl.getAttribLocation(program, name);
      if (loc < 0) return;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE * 4, offset * 4);
    };
    attrib('a_pos', 3, ATTR.pos);
    attrib('a_normal', 2, ATTR.normal);
    attrib('a_kind', 1, ATTR.kind);
    attrib('a_uv', 2, ATTR.uv);
    attrib('a_edge', 2, ATTR.edge);
    attrib('a_slots', 1, ATTR.slots);
    attrib('a_seed', 1, ATTR.seed);
    attrib('a_jitter', 1, ATTR.jitter);
    attrib('a_top', 1, ATTR.top);
    attrib('a_base', 1, ATTR.base);
    attrib('a_floorOffset', 1, ATTR.floorOffset);
    gl.bindVertexArray(null);
    this.timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.texture = gl.createTexture();
    // 1×1 white placeholder so the sampler is always complete.
    this.uploadLayers([new Uint8ClampedArray([255, 255, 255, 255])], 1);
    map.on('sourcedata', this.onSourceData);
    map.on('moveend', this.onMoveEnd);
    this.scheduleRebuild(0);
  }

  onRemove(map: MapLibreMap, gl: WebGL2RenderingContext) {
    map.off('sourcedata', this.onSourceData);
    map.off('moveend', this.onMoveEnd);
    if (this.rebuildTimer !== null) window.clearTimeout(this.rebuildTimer);
    gl.deleteBuffer(this.vbo);
    gl.deleteBuffer(this.ibo);
    gl.deleteVertexArray(this.vao);
    gl.deleteTexture(this.texture);
    gl.deleteProgram(this.program);
    this.map = null;
    this.gl = null;
  }

  render(gl: WebGL2RenderingContext, input: CustomRenderMethodInput) {
    const map = this.map;
    if (!map || !this.program) return;
    const t0 = performance.now();
    // Commit a staged look once its mesh is built and the old look has dipped: one frame, all parts.
    if (this.next && this.staged && t0 >= this.fade.start + this.fade.dur) {
      const { a: na, layers } = this.next;
      this.staged();
      if (layers) { this.pendingLayers = layers.pixels; this.layers = layers.table; this.layerSize = layers.size; }
      this.appearance = na;
      this.structure = structuralKey(na);
      this.packed = null;
      this.lerp = null;
      this.next = null;
      this.staged = null;
      this.fade = { from: this.fadeK(t0), to: 1, start: t0, dur: this.fadeInMs };
    }
    const a = this.appearance;
    if (!a) return;
    if (this.pendingLayers) {
      this.uploadLayers(this.pendingLayers, this.layerSize);
      this.pendingLayers = null;
    }
    const zoom = map.getZoom();
    const opacity = this.opts.opacity();
    if (zoom < SOURCE_MAX_ZOOM || this.indexCount === 0 || opacity <= 0.001) return;

    const main = input.defaultProjectionData.mainMatrix;
    const s = this.mpu;
    const model = new Float64Array([s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, this.origin[0], this.origin[1], 0, 1]);
    const local = mul(main, model);
    const matrix = new Float32Array(local);

    const camera = eyePosition(local) ?? [0, 0, 1000];

    gl.useProgram(this.program);
    const u = this.uniforms;
    gl.uniformMatrix4fv(u.get('u_matrix')!, false, matrix);
    gl.uniform1f(u.get('u_heightScale')!, Math.min(1, Math.max(0, zoom - SOURCE_MAX_ZOOM)));
    gl.uniform3fv(u.get('u_camera')!, camera);
    gl.uniform1f(u.get('u_opacity')!, Math.min(1, opacity));
    gl.uniform3fv(u.get('u_neutral')!, this.opts.neutralColor());
    const k = this.fadeK(t0);
    const values = this.currentUniforms(t0);
    for (const [name, uv0] of Object.entries(values)) {
      const uv = name === 'u_strength' && uv0.type === '1f' ? { type: '1f' as const, value: uv0.value * k } : uv0;
      const loc = u.get(name);
      if (!loc) continue;
      if (uv.type === '1f') gl.uniform1f(loc, uv.value);
      else if (uv.type === '3fv') gl.uniform3fv(loc, uv.value);
      else gl.uniform4fv(loc, uv.value);
    }
    // A viewport-anchored sun turns with the camera, as MapLibre's own extrusion light does.
    if (a.lighting.sunAnchor === 'viewport') {
      gl.uniform3fv(u.get('u_sunDir')!, sunDirection(a.lighting.sunAzimuth + map.getBearing(), a.lighting.sunAltitude));
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
    gl.uniform1i(u.get('u_tex')!, 0);

    gl.bindVertexArray(this.vao);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.STENCIL_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (opacity < 0.999) {
      // Depth pre-pass so a translucent fade shows only the nearest surface (as fill-extrusion does).
      gl.colorMask(false, false, false, false);
      gl.depthMask(true);
      gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);
      gl.colorMask(true, true, true, true);
    }
    gl.depthMask(true);
    const ext = this.timerExt;
    const q = ext && this.queries.length < 4 ? gl.createQuery() : null;
    if (q && ext) gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);
    if (q && ext) { gl.endQuery(ext.TIME_ELAPSED_EXT); this.queries.push(q); }
    gl.bindVertexArray(null);
    this.collectGpuTimes(gl);
    this.stats.lastRenderCpuMs = performance.now() - t0;
    // Keep frames coming while the shared clock is running; settle a finished release.
    const animating = (this.fade.dur > 0 && t0 < this.fade.start + this.fade.dur) || (this.lerp && t0 < this.lerp.start + this.lerp.dur) || (this.next && !this.staged);
    if (animating || (this.next && this.staged)) map.triggerRepaint();
    else if (this.lerp) this.lerp = null;
    if (this.releasing && this.fade.to === 0 && t0 >= this.fade.start + this.fade.dur) {
      const done = this.releasing;
      this.releasing = null;
      done.resolve();
    }
  }

  // ---------- internals ----------
  private onSourceData = (e: { sourceId?: string; isSourceLoaded?: boolean; tile?: unknown }) => {
    if (e.sourceId !== this.opts.sourceId || !e.tile) return;
    this.dirty = true;
    this.scheduleRebuild(250);
  };

  private onMoveEnd = () => {
    const map = this.map;
    if (!map) return;
    if (map.getZoom() < SOURCE_MAX_ZOOM) return;
    const view = this.viewBox(0);
    const b = this.built;
    const inside = b && view[0] >= b.box[0] && view[1] >= b.box[1] && view[2] <= b.box[2] && view[3] <= b.box[3];
    if (!inside || Math.abs(map.getZoom() - b.zoom) > 1.5) {
      this.dirty = true;
      this.scheduleRebuild(50);
    }
  };

  /** Visible mercator bounds, padded by `pad` × their size on each side. */
  private viewBox(pad: number): [number, number, number, number] {
    const bounds = this.map!.getBounds();
    const [x0, y1] = lngLatToMerc(bounds.getWest(), bounds.getSouth());
    const [x1, y0] = lngLatToMerc(bounds.getEast(), bounds.getNorth());
    const w = x1 - x0, h = y1 - y0;
    return [x0 - w * pad, y0 - h * pad, x1 + w * pad, y1 + h * pad];
  }

  private scheduleRebuild(delay: number) {
    if (this.rebuildTimer !== null) window.clearTimeout(this.rebuildTimer);
    this.rebuildTimer = window.setTimeout(() => {
      this.rebuildTimer = null;
      if (!this.dirty) return;
      // Mesh rebuilds run on the main thread; never hitch an active gesture/animation.
      // Already-built buildings stay visible meanwhile; new tiles join when the camera rests.
      if (this.map?.isMoving() && this.indexCount > 0) return this.scheduleRebuild(200);
      this.rebuild();
    }, delay);
  }

  private harvest(): number {
    const map = this.map!;
    const t0 = performance.now();
    const features = map.querySourceFeatures(this.opts.sourceId, {
      sourceLayer: this.opts.sourceLayer,
      filter: ['!', ['has', 'hide_3d']],
    });
    for (const f of features) {
      const g = f.geometry;
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
      const props = f.properties ?? {};
      const height = Number(props.render_height ?? 0);
      const minHeight = Number(props.render_min_height ?? 0);
      if (!(height > 0)) continue;
      polys.forEach((poly: number[][][], pi: number) => {
        const outer = poly[0];
        if (!outer || outer.length < 4) return;
        const first = outer[0]!;
        // OpenMapTiles packs whole blocks (e.g. rowhouses) into one MultiPolygon
        // with a single id, so identity = feature id + the part's centroid on a
        // ~2 m grid. Stable across reloads and tile order; independent per house.
        let sx = 0, sy = 0;
        for (const p of outer) { sx += p[0]!; sy += p[1]!; }
        const partLng = sx / outer.length, partLat = sy / outer.length;
        const grid = `${Math.round(partLng * 50000)},${Math.round(partLat * 50000)}`;
        const idKey = `${f.id ?? 'x'}:${grid}`;
        const cacheKey = `${idKey}|${pi}|${first[0]!.toFixed(7)},${first[1]!.toFixed(7)}|${outer.length}|${height}`;
        if (this.cache.has(cacheKey)) return;
        const rings: Float64Array[] = [];
        const seams: Uint8Array[] = [];
        for (const ring of poly) {
          const cleaned = cleanRing(ring as unknown as Ring);
          if (cleaned.length < 3) continue;
          const arr = new Float64Array(cleaned.length * 2);
          cleaned.forEach((p, i) => {
            const [x, y] = lngLatToMerc(p[0], p[1]);
            arr[i * 2] = x;
            arr[i * 2 + 1] = y;
          });
          const sm = new Uint8Array(cleaned.length);
          for (let i = 0; i < cleaned.length; i++) {
            const j = (i + 1) % cleaned.length;
            sm[i] = isSeam(arr[i * 2]!, arr[i * 2 + 1]!, arr[j * 2]!, arr[j * 2 + 1]!) ? 1 : 0;
          }
          rings.push(arr);
          seams.push(sm);
        }
        if (!rings.length) return;
        // Metric footprint facts (local equirectangular at the building).
        const lat = first[1]!;
        const scale = EARTH_CIRCUMFERENCE * Math.cos((lat * Math.PI) / 180);
        const metric: Ring[] = rings.map((r) => {
          const out: [number, number][] = [];
          for (let i = 0; i < r.length; i += 2) out.push([(r[i]! - r[0]!) * scale, (r[i + 1]! - r[1]!) * scale]);
          return out;
        });
        const [cx, cy] = centroid(metric[0]!);
        this.cache.set(cacheKey, {
          key: idKey,
          rings,
          seams,
          height,
          minHeight,
          area: footprintArea(metric),
          mx: rings[0]![0]!,
          my: rings[0]![1]!,
          gx: rings[0]![0]! * scale + cx,
          gy: rings[0]![1]! * scale + cy,
        });
      });
    }
    // Bound memory: keep the cache near the view (≈1.5× the mesh budget).
    if (this.cache.size > this.opts.maxBuildings * 1.5) {
      const c = map.getCenter();
      const [cx, cy] = lngLatToMerc(c.lng, c.lat);
      const sorted = [...this.cache.entries()].sort((p, q) => Math.hypot(p[1].mx - cx, p[1].my - cy) - Math.hypot(q[1].mx - cx, q[1].my - cy));
      for (const [k] of sorted.slice(this.opts.maxBuildings)) this.cache.delete(k);
    }
    this.stats.features = features.length;
    this.stats.harvestMs = performance.now() - t0;
    return features.length;
  }

  private rebuild() {
    const map = this.map;
    const gl = this.gl;
    const a = this.next?.a ?? this.appearance;
    if (!map || !gl || !a) return;
    this.dirty = false;
    // Native building-3d layers have minzoom 14; below it there is nothing to draw
    // and lower-zoom tiles carry different (generalised) geometry.
    if (map.getZoom() < SOURCE_MAX_ZOOM) {
      if (this.next) { this.staged = () => {}; map.triggerRepaint(); }
      return;
    }
    this.harvest();
    const t0 = performance.now();
    const c = map.getCenter();
    const center = lngLatToMerc(c.lng, c.lat);
    const origin = MercatorCoordinate.fromLngLat(c);
    const org: [number, number] = [origin.x, origin.y];
    const mpu = origin.meterInMercatorCoordinateUnits();
    const box = this.viewBox(this.opts.boundsPadding);
    const built = { box, zoom: map.getZoom() };

    let chosen = [...this.cache.values()].filter((b) => b.mx >= box[0] && b.mx <= box[2] && b.my >= box[1] && b.my <= box[3]);
    if (chosen.length > this.opts.maxBuildings) {
      chosen = chosen
        .map((b) => ({ b, d: Math.hypot(b.mx - center[0], b.my - center[1]) }))
        .sort((p, q) => p.d - q.d)
        .slice(0, this.opts.maxBuildings)
        .map((p) => p.b);
    }
    const mesh = new MeshBuffer(chosen.length * 30, chosen.length * 54);
    let buildings = 0;
    let seamEdges = 0;
    const inv = 1 / mpu;
    for (const b of chosen) {
      const as = assignBuilding(a, { key: b.key, height: b.height, area: b.area, cx: b.gx, cy: b.gy });
      const facade = a.facades[as.facade];
      const roof = a.roofs[as.roof];
      const rings: Ring[] = b.rings.map((r) => {
        const out: [number, number][] = [];
        for (let i = 0; i < r.length; i += 2) out.push([(r[i]! - org[0]) * inv, (r[i + 1]! - org[1]) * inv]);
        return out;
      });
      const ok = appendBuilding(mesh, {
        rings,
        height: b.height,
        minHeight: b.minHeight,
        parapet: facade?.trim.parapetHeight ?? 0,
        facade: as.facade,
        roof: as.roof,
        seed: as.seed,
        jitter: as.jitter,
        floorOffset: as.floorOffset,
        alignRoof: roof?.alignToFootprint ?? true,
        skipEdge: (ri, i) => {
          const skip = b.seams[ri]?.[i] === 1;
          if (skip) seamEdges++;
          return skip;
        },
      });
      if (ok) buildings++;
    }
    const buildMs = performance.now() - t0;
    const upload = () => {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices.subarray(0, mesh.vertexCount * STRIDE), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices.subarray(0, mesh.indexCount), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      const first = this.indexCount === 0 && mesh.indexCount > 0;
      this.indexCount = mesh.indexCount;
      this.origin = org;
      this.mpu = mpu;
      this.built = built;
      Object.assign(this.stats, { buildings, vertices: mesh.vertexCount, triangles: mesh.indexCount / 3, buildMs, uploads: this.stats.uploads + 1, skippedSeamEdges: seamEdges });
      this.opts.onStats?.(this.getStats());
      if (first && this.firstUpload) { const fn = this.firstUpload; this.firstUpload = null; fn(); }
    };
    // A staged look uploads at commit time (render), together with its uniforms and atlas.
    if (this.next) this.staged = upload;
    else upload();
    map.triggerRepaint();
  }

  private uploadLayers(pixels: Uint8ClampedArray[], size: number) {
    const gl = this.gl;
    if (!gl) return;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, size, size, pixels.length, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    pixels.forEach((p, i) => gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, size, size, 1, gl.RGBA, gl.UNSIGNED_BYTE, p));
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    if (aniso) gl.texParameterf(gl.TEXTURE_2D_ARRAY, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number));
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
  }
}

/** Everything the mesh build reads from an appearance (see rebuild()): assignment inputs, parapets, roof alignment, variation. */
export function structuralKey(a: BuildingAppearance): string {
  return JSON.stringify([
    a.facades.map((f) => [f.weight, f.heightRange ?? null, f.footprintRange ?? null, f.roof ?? null, f.trim.parapetHeight]),
    a.roofs.map((r) => [r.weight, r.alignToFootprint]),
    a.variation,
  ]);
}

/** Below this the old look has dipped far enough toward the neutral base to swap without a visible pop. */
const FADE_FLOOR = 0.25;

export interface StagedLayers { readonly pixels: Uint8ClampedArray[]; readonly table: LayerTable; readonly size: number }

/** Float uniforms that may interpolate; every other uniform holds enum codes (shape, kind, layer) and switches at t = 0.5. */
const LERPABLE = new Set(['u_fWallA', 'u_fWallC', 'u_fGlass', 'u_fFrame', 'u_fGlowC', 'u_rA', 'u_rC', 'u_sunDir', 'u_sunColor', 'u_ambient', 'u_night', 'u_glow', 'u_sky', 'u_horizon', 'u_strength']);

export function blendUniforms(from: Record<string, UniformValue>, to: Record<string, UniformValue>, t: number): Record<string, UniformValue> {
  if (t >= 1) return to;
  const out: Record<string, UniformValue> = {};
  for (const [name, b] of Object.entries(to)) {
    const a = from[name];
    if (!a || a.type !== b.type || !LERPABLE.has(name)) { out[name] = t < 0.5 && a ? a : b; continue; }
    if (a.type === '1f' && b.type === '1f') out[name] = { type: '1f', value: a.value + (b.value - a.value) * t };
    else if (a.type !== '1f' && b.type !== '1f' && a.value.length === b.value.length) {
      const v = new Float32Array(b.value.length);
      for (let i = 0; i < v.length; i++) v[i] = a.value[i]! + (b.value[i]! - a.value[i]!) * t;
      out[name] = { type: b.type, value: v } as UniformValue;
    } else out[name] = t < 0.5 ? a : b;
  }
  return out;
}
