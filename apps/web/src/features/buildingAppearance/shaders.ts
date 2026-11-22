/**
 * GLSL for the geometry-bound building renderer (WebGL2 / GLSL ES 3.00).
 *
 * Every pattern is evaluated in surface metres carried by the mesh, so it is
 * attached to the building when the camera pans, rotates or pitches. Shading
 * is stylised (Lambert + Blinn-Phong + analytic sky reflection); it does not
 * claim physically based rendering or real environment reflections.
 */
import { MAX_FACADES, MAX_ROOFS } from './contract';

export const VERTEX_SHADER = `#version 300 es
precision highp float;
uniform mat4 u_matrix;
uniform float u_heightScale;
in vec3 a_pos;
in vec2 a_normal;
in float a_kind;
in vec2 a_uv;
in vec2 a_edge;
in float a_slots;
in float a_seed;
in float a_jitter;
in float a_top;
in float a_base;
in float a_floorOffset;
out vec3 v_pos;
out vec2 v_uv;
flat out vec2 v_normal;
flat out float v_kind;
flat out vec2 v_edge;
flat out int v_facade;
flat out int v_roof;
flat out float v_seed;
flat out float v_jitter;
flat out float v_top;
flat out float v_base;
flat out float v_floorOffset;
void main() {
  // Overlapping OSM building parts often share a roof height; a deterministic
  // sub-decimetre lift per building picks a stable winner instead of z-fighting.
  float lift = a_kind > 0.5 ? a_seed * 0.12 : 0.0;
  vec3 p = vec3(a_pos.xy, (a_pos.z + lift) * u_heightScale);
  v_pos = vec3(a_pos.xy, a_pos.z);
  v_uv = a_uv;
  v_normal = a_normal;
  v_kind = a_kind;
  v_edge = a_edge;
  int s = int(a_slots + 0.5);
  v_facade = s - (s / 16) * 16;
  v_roof = s / 16;
  v_seed = a_seed;
  v_jitter = a_jitter;
  v_top = a_top;
  v_base = a_base;
  v_floorOffset = a_floorOffset;
  gl_Position = u_matrix * vec4(p, 1.0);
}
`;

export const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp sampler2DArray;
#define NF ${MAX_FACADES}
#define NR ${MAX_ROOFS}
uniform sampler2DArray u_tex;
uniform vec3 u_camera;
uniform vec3 u_sunDir;
uniform vec3 u_sunColor;
uniform float u_ambient;
uniform float u_night;
uniform float u_glow;
uniform float u_opacity;
uniform float u_strength;
uniform vec3 u_sky;
uniform vec3 u_horizon;
uniform vec3 u_neutral;

uniform vec4 u_fWallA[NF];  // rgb, tint
uniform vec4 u_fWallB[NF];  // layer, scale, rotation(rad), surface kind
uniform vec4 u_fWallC[NF];  // roughness, reflectivity, weathering, -
uniform vec4 u_fWinA[NF];   // shape, floorHeight, bayWidth, litFraction
uniform vec4 u_fWinB[NF];   // widthRatio, heightRatio, storefront, -
uniform vec3 u_fGlass[NF];
uniform vec3 u_fFrame[NF];
uniform vec3 u_fGlowC[NF];
uniform vec4 u_fTrimA[NF];  // rgb, corner style
uniform vec4 u_fTrimB[NF];  // cornice, base, stringCourses, cornerWidth
uniform vec4 u_fTrimC[NF];  // parapet, -, -, -

uniform vec4 u_rA[NR];      // rgb, tint
uniform vec4 u_rB[NR];      // layer, scale, rotation(rad), roof kind
uniform vec4 u_rC[NR];      // roughness, reflectivity, weathering, -

in vec3 v_pos;
in vec2 v_uv;
flat in vec2 v_normal;
flat in float v_kind;
flat in vec2 v_edge;
flat in int v_facade;
flat in int v_roof;
flat in float v_seed;
flat in float v_jitter;
flat in float v_top;
flat in float v_base;
flat in float v_floorOffset;
out vec4 fragColor;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return s;
}
mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

// Asset texture in surface metres, tinted toward 'color' with its luminance kept.
vec3 material(float layer, vec2 uvMetres, float scale, float rotation, vec3 color, float tint, float detail) {
  if (layer < 0.5) return color;
  vec2 q = rot2(rotation) * uvMetres / scale;
  q.y = -q.y;
  vec3 t = texture(u_tex, vec3(q, layer)).rgb;
  vec3 avg = textureLod(u_tex, vec3(0.5, 0.5, layer), 16.0).rgb;
  float rel = luma(t) / max(luma(avg), 0.03);
  rel = mix(1.0, rel, detail);
  t = mix(avg, t, detail);
  return mix(t, color * rel, tint);
}

// Thin line mask with screen-space antialiasing; d = distance to the line in metres.
float line(float d, float w, float aa) { return 1.0 - smoothstep(w - aa, w + aa, abs(d)); }

vec3 skyReflection(vec3 n, vec3 viewDir) {
  vec3 r = reflect(-viewDir, n);
  return mix(u_horizon, u_sky, clamp(r.z * 1.8 + 0.15, 0.0, 1.0));
}

vec3 light(vec3 n, vec3 viewDir, vec3 albedo, float roughness, float ao) {
  float ndl = max(dot(n, u_sunDir), 0.0);
  float sky = 0.5 + 0.5 * n.z;
  vec3 dayLight = albedo * (u_ambient * (0.75 + 0.25 * sky) + (1.0 - u_ambient) * ndl * u_sunColor);
  vec3 h = normalize(u_sunDir + viewDir);
  float shin = mix(140.0, 6.0, roughness);
  vec3 spec = u_sunColor * pow(max(dot(n, h), 0.0), shin) * (1.0 - roughness) * 0.45 * step(0.0, ndl);
  vec3 nightLight = albedo * vec3(0.32, 0.36, 0.52) * (0.35 + 0.25 * sky);
  return mix(dayLight * ao + spec, nightLight * ao, u_night);
}

void main() {
  vec3 toCam = u_camera - v_pos;
  float camDist = length(toCam);
  vec3 viewDir = toCam / max(camDist, 1e-3);
  vec3 color;

  if (v_kind < 0.5) {
    // ---------------- Walls ----------------
    int f = v_facade;
    vec3 n = vec3(v_normal, 0.0);
    float hAbove = v_uv.y - v_base;
    float wallH = v_top - v_base;
    float len = v_edge.x;
    float u = v_uv.x;
    // pixel footprint in metres, for antialiasing and level of detail
    float px = max(fwidth(v_uv.y), fwidth(u));
    float aa = px * 0.75;

    bool inner = dot(n, toCam) < 0.0;
    vec4 trimA = u_fTrimA[f];
    vec4 trimB = u_fTrimB[f];
    float parapet = u_fTrimC[f].x;
    vec3 trimColor = trimA.rgb * (1.0 + v_jitter * 0.25);

    if (inner) {
      // Inside face of the parapet, seen over the roof edge.
      color = light(-n, viewDir, trimColor * 0.72, 0.9, 0.85);
    } else {
      vec4 wa = u_fWallA[f];
      vec4 wb = u_fWallB[f];
      vec4 wc = u_fWallC[f];
      float kind = wb.w;
      // continuous along the ring so texture courses wrap round corners
      vec2 wuv = vec2(u + v_edge.y, v_uv.y);
      float detail = 1.0 - smoothstep(wb.y * 0.04, wb.y * 0.2, px);
      vec3 base = wa.rgb * (1.0 + v_jitter * 0.35);
      vec3 albedo = material(wb.x, wuv, wb.y, wb.z, base, wa.a, 1.0); // mipmaps antialias the asset
      float roughness = wc.x;
      float reflectivity = wc.y;
      float weathering = wc.z;

      // Procedural surface structure per kind (independent of colour).
      if (kind < 0.5) {            // brick: soot banding
        albedo *= 0.94 + 0.12 * vnoise(wuv * vec2(0.15, 0.6));
      } else if (kind < 1.5) {     // stone: ashlar coursing
        float c = line(fract(hAbove / 0.75) - 0.5, 0.47, aa / 0.75);
        float j = line(fract(wuv.x / 1.4 + 0.5 * mod(floor(hAbove / 0.75), 2.0)) - 0.5, 0.48, aa / 1.4);
        albedo *= 1.0 - 0.18 * max(1.0 - c, 1.0 - j) * detail;
        albedo *= 0.92 + 0.16 * fbm(wuv * 0.8);
      } else if (kind < 2.5) {     // stucco: trowel mottling
        albedo *= 0.9 + 0.2 * fbm(wuv * vec2(1.6, 2.2));
      } else if (kind < 3.5) {     // plaster: broad patches
        albedo *= 0.88 + 0.24 * fbm(wuv * 0.3);
      } else if (kind < 4.5) {     // concrete: formwork panels and tie holes
        vec2 cell = wuv / vec2(2.4, 1.2);
        vec2 g = fract(cell) - 0.5;
        float joint = max(line(g.x, 0.485, aa / 2.4), line(g.y, 0.47, aa / 1.2));
        albedo *= 1.0 - 0.16 * (1.0 - joint) * detail;
        vec2 tie = fract(cell * 2.0) - 0.5;
        albedo *= 1.0 - 0.25 * (1.0 - smoothstep(0.03, 0.06 + aa, length(tie * vec2(2.4, 1.2)))) * detail;
      } else if (kind < 5.5) {     // glass: handled by curtain glazing
      } else if (kind < 6.5) {     // metal: standing panels
        float seam = line(fract(wuv.x / 0.9) - 0.5, 0.47, aa / 0.9);
        albedo *= 1.0 - 0.2 * (1.0 - seam) * detail;
      } else {                     // timber: horizontal boards
        float board = line(fract(hAbove / 0.22) - 0.5, 0.45, aa / 0.22);
        albedo *= (1.0 - 0.22 * (1.0 - board) * detail) * (0.9 + 0.2 * vnoise(vec2(wuv.x * 0.2, floor(hAbove / 0.22))));
      }

      // Weathering: ground grime, rain streaks, staining; plaster spalls to substrate.
      if (weathering > 0.0) {
        float grime = (1.0 - smoothstep(0.0, 5.0, hAbove)) * 0.35;
        float streak = smoothstep(0.55, 0.95, vnoise(vec2(wuv.x * 1.7, hAbove * 0.05))) * (0.3 + 0.7 * (1.0 - smoothstep(0.0, max(wallH, 1.0), hAbove * 0.6)));
        float stain = fbm(wuv * 0.22 + v_seed * 13.0) - 0.5;
        albedo *= 1.0 - weathering * (grime + 0.3 * streak) + weathering * 0.35 * stain;
        if (kind > 1.5 && kind < 3.5) {
          float spall = smoothstep(1.0 - 0.32 * weathering, 1.03 - 0.32 * weathering, fbm(wuv * 0.35 + 7.0));
          albedo = mix(albedo, vec3(0.55, 0.38, 0.30) * (0.8 + 0.3 * vnoise(wuv * 4.0)), spall * 0.85);
        }
      }

      // ---- Storeys and bays (geometry-bound) ----
      vec4 wn = u_fWinA[f];
      vec4 wn2 = u_fWinB[f];
      float shape = wn.x;
      float fh = max(2.4, wn.y + v_floorOffset);
      float floorIdx = floor(hAbove / fh);
      float fv = fract(hAbove / fh);
      float bays = max(1.0, floor(len / wn.z + 0.5));
      float bayW = len / bays;
      float bu = u / bayW;
      float bi = floor(bu);
      float fu = fract(bu);
      float cornice = trimB.x;
      float topClear = max(cornice, parapet) + 0.35;
      bool fullFloor = (floorIdx + 1.0) * fh <= wallH - topClear + 0.01;
      bool hasWindows = shape > 0.5 && len > 2.2 && fullFloor;
      float windowDetail = 1.0 - smoothstep(fh * 0.12, fh * 0.45, px);

      float glassMask = 0.0;
      float frameMask = 0.0;
      bool storefront = wn2.z > 0.5 && v_base < 0.5 && floorIdx < 0.5 && len > 3.0;
      float wwidth = wn2.x * bayW;
      float wheight = wn2.y * fh;
      float sill = (fh - wheight) * 0.42;
      vec2 local = vec2((fu - 0.5) * bayW, fv * fh - sill); // metres in the window frame
      float frameW = 0.12;
      if (storefront) {
        vec2 sl = vec2((fu - 0.5) * bayW, fv * fh - 0.35);
        float sw = 0.86 * bayW * 0.5, sh = fh * 0.82 - 0.35;
        float inside = step(abs(sl.x), sw) * step(0.0, sl.y) * step(sl.y, sh);
        float inGlass = step(abs(sl.x), sw - frameW) * step(frameW, sl.y) * step(sl.y, sh - frameW);
        glassMask = inGlass;
        frameMask = inside - inGlass;
      } else if (hasWindows) {
        if (shape < 2.5) {
          // punched (1) or arched (2)
          float hw = wwidth * 0.5;
          float r = hw;
          float body = wheight - (shape > 1.5 ? r : 0.0);
          float dRect = max(abs(local.x) - hw, max(-local.y, local.y - body));
          float dArch = shape > 1.5 ? max(length(local - vec2(0.0, body)) - r, -(local.y - body)) : 1e3;
          float d = min(dRect, dArch);
          glassMask = 1.0 - smoothstep(-frameW - aa, -frameW + aa, d);
          frameMask = (1.0 - smoothstep(-aa, aa, d)) - glassMask;
          // sill shadow
          albedo *= 1.0 - 0.25 * step(abs(local.x), hw) * step(-0.25, local.y) * step(local.y, 0.0) * windowDetail;
        } else if (shape < 3.5) {
          // ribbon: continuous band per storey, mullion at each bay line
          float inBand = step(0.0, local.y) * step(local.y, wheight);
          float edgeClear = step(0.6, u) * step(u, len - 0.6);
          float mullion = line(fu - 0.5, 0.5 - 0.06 / bayW, aa / bayW);
          glassMask = inBand * edgeClear * mullion;
          frameMask = inBand * edgeClear * (1.0 - mullion);
        } else {
          // curtain wall: glass everywhere but spandrels and mullions
          float spandrel = 1.0 - step(0.16, fv) * step(fv, 0.97);
          float mullion = 1.0 - line(fu - 0.5, 0.5 - 0.05 / bayW, aa / bayW);
          frameMask = max(spandrel, mullion);
          glassMask = 1.0 - frameMask;
        }
      }

      // Glass: sky reflection + fresnel; deterministic lit windows.
      vec3 glassBase = u_fGlass[f];
      float cosT = max(dot(n, viewDir), 0.0);
      float fres = 0.04 + 0.96 * pow(1.0 - cosT, 5.0);
      float refl = clamp((shape > 3.5 || kind > 4.5 && kind < 5.5 ? 0.55 : 0.3) + reflectivity * 0.45, 0.0, 1.0);
      vec3 glass = mix(glassBase, skyReflection(n, viewDir), refl * (0.3 + 0.7 * fres)) * (1.0 - 0.55 * u_night);
      // Occupancy is spatially coherent: a cluster of bays on a group of floors
      // is "in use", then individual windows are thinned — never per-pixel noise.
      float occupied = step(hash13(vec3(v_seed * 917.0 + v_edge.y * 0.37, floor(bi / 3.0), floor(floorIdx / 2.0))), wn.w * 1.25 + (storefront ? 0.4 : 0.0));
      float lit = occupied * step(hash13(vec3(v_seed * 131.0 + v_edge.y, bi, floorIdx)), 0.8);
      float flicker = 0.75 + 0.5 * hash13(vec3(bi, floorIdx, v_seed * 31.0));
      vec3 emission = u_fGlowC[f] * lit * flicker * u_glow * (0.25 + 0.75 * u_night);

      // At distance the window grid resolves to its average tone instead of aliasing.
      float coverage = storefront ? 0.6 : shape > 3.5 ? 0.82 : shape > 2.5 ? wn2.y : wn2.x * wn2.y;
      if (!(hasWindows || storefront)) coverage = 0.0;
      float avgLit = wn.w;
      glassMask = mix(coverage * 0.85, glassMask, windowDetail);
      frameMask = mix(coverage * 0.15, frameMask, windowDetail);
      emission = mix(u_fGlowC[f] * avgLit * u_glow * (0.25 + 0.75 * u_night), emission, windowDetail);

      // ---- Trim ----
      float trim = 0.0;
      float shadow = 0.0;
      float topBand = v_top - v_uv.y;
      if (cornice > 0.0) {
        trim = max(trim, 1.0 - smoothstep(cornice - aa, cornice + aa, topBand));
        shadow = max(shadow, step(cornice, topBand) * (1.0 - smoothstep(cornice + 0.25 - aa, cornice + 0.25 + aa, topBand)));
      }
      if (parapet > 0.0) {
        float coping = 1.0 - smoothstep(0.18 - aa, 0.18 + aa, topBand);
        trim = max(trim, coping);
      }
      if (trimB.y > 0.0 && v_base < 0.5) {
        trim = max(trim, 1.0 - smoothstep(trimB.y - aa, trimB.y + aa, hAbove));
      }
      if (trimB.z > 0.5 && floorIdx > 0.5) {
        trim = max(trim, line(fv * fh, 0.11, aa) * windowDetail);
      }
      float cornerStyle = trimA.a;
      float cw = trimB.w;
      if (cornerStyle > 0.5 && cw > 0.0 && len > cw * 3.0) {
        float d = min(u, len - u);
        float w = cw;
        if (cornerStyle > 1.5) w = mod(floor(hAbove / 0.6), 2.0) < 0.5 ? cw : cw * 0.6; // quoins
        float c = 1.0 - smoothstep(w - aa, w + aa, d);
        trim = max(trim, c);
        if (cornerStyle > 1.5) shadow = max(shadow, c * (1.0 - line(fract(hAbove / 0.6) - 0.5, 0.46, aa / 0.6)) * 0.6 * windowDetail);
      }
      glassMask *= 1.0 - trim;
      frameMask *= 1.0 - trim;

      float ao = mix(0.72, 1.0, smoothstep(0.0, 9.0, hAbove));
      vec3 wallLit = light(n, viewDir, albedo, roughness, ao);
      vec3 trimLit = light(n, viewDir, trimColor, 0.8, ao);
      vec3 frameLit = light(n, viewDir, u_fFrame[f], 0.5, ao);
      vec3 glassLit = glass * (u_ambient + (1.0 - u_ambient) * 0.6) * ao + emission;
      color = wallLit;
      color = mix(color, trimLit, trim);
      color *= 1.0 - 0.35 * shadow;
      color = mix(color, frameLit, clamp(frameMask, 0.0, 1.0));
      color = mix(color, glassLit, clamp(glassMask, 0.0, 1.0));
    }
    // neutral blend
    float ndl = max(dot(n, u_sunDir), 0.0);
    vec3 neutral = u_neutral * (0.62 + 0.38 * ndl);
    color = mix(neutral, color, u_strength);
  } else {
    // ---------------- Roofs ----------------
    int r = v_roof;
    vec4 ra = u_rA[r];
    vec4 rb = u_rB[r];
    vec4 rc = u_rC[r];
    vec2 ruv = v_uv;
    float px = max(fwidth(ruv.x), fwidth(ruv.y));
    float aa = px * 0.75;
    float detail = 1.0 - smoothstep(rb.y * 0.04, rb.y * 0.2, px);
    vec3 base = ra.rgb * (1.0 + v_jitter * 0.3);
    vec3 albedo = material(rb.x, ruv, rb.y, rb.z, base, ra.a, 1.0);
    float kind = rb.w;
    float roughness = rc.x;
    vec3 n = vec3(0.0, 0.0, 1.0);
    if (kind < 0.5) {            // membrane: welded seams
      vec2 g = fract(ruv / vec2(3.0, 1.5)) - 0.5;
      albedo *= 1.0 - 0.1 * (1.0 - line(g.y, 0.47, aa / 1.5)) * detail;
      albedo *= 0.93 + 0.14 * fbm(ruv * 0.15 + v_seed * 9.0);
    } else if (kind < 1.5) {     // gravel ballast
      albedo *= 0.8 + 0.4 * mix(0.5, hash12(floor(ruv * 6.0)), detail);
    } else if (kind < 2.5) {     // tile / slate courses, spaced with the texture so they read at city scale
      float spacing = max(0.4, rb.y * 0.22);
      float course = fract(ruv.y / spacing);
      float courseDetail = 1.0 - smoothstep(spacing * 0.25, spacing * 0.7, px);
      albedo *= 0.8 + 0.3 * mix(0.55, smoothstep(0.0, 0.85, course), courseDetail);
    } else if (kind < 3.5) {     // standing seam metal
      float seam = line(fract(ruv.x / 0.55) - 0.5, 0.46, aa / 0.55);
      albedo *= 1.0 + 0.22 * (1.0 - seam) * detail;
    } else if (kind < 4.5) {     // green roof
      float patchy = fbm(ruv * 0.25 + v_seed * 5.0);
      albedo = mix(albedo * 0.75, albedo * vec3(0.95, 1.12, 0.8), smoothstep(0.4, 0.6, patchy));
      albedo *= 0.85 + 0.3 * mix(0.5, vnoise(ruv * 3.0), detail);
    } else {                     // solar arrays on a membrane roof
      vec2 cell = ruv / vec2(1.1, 2.1);
      vec2 g = fract(cell) - 0.5;
      float panel = step(abs(g.x), 0.46) * step(abs(g.y), 0.36);
      float block = step(0.45, vnoise(floor(cell / vec2(5.0, 3.0)) * 0.7 + v_seed * 3.0));
      vec3 pv = vec3(0.10, 0.16, 0.30) + 0.06 * line(fract(cell.x * 3.0) - 0.5, 0.45, aa);
      albedo = mix(albedo, mix(albedo * 0.7, pv, panel), block * mix(0.75, 1.0, detail));
      roughness = mix(roughness, 0.25, block * panel);
    }
    if (rc.z > 0.0) albedo *= 1.0 - rc.z * 0.35 * (fbm(ruv * 0.12 + 3.0) - 0.3);
    color = light(n, viewDir, albedo, roughness, 1.0);
    float cosT = max(dot(n, viewDir), 0.0);
    float fres = 0.04 + 0.96 * pow(1.0 - cosT, 5.0);
    color = mix(color, skyReflection(n, viewDir) * (1.0 - 0.6 * u_night), rc.y * fres * 0.6);
    float ndl = max(u_sunDir.z, 0.0);
    vec3 neutral = u_neutral * (0.7 + 0.3 * ndl);
    color = mix(neutral, color, u_strength);
  }
  fragColor = vec4(color * u_opacity, u_opacity);
}
`;
