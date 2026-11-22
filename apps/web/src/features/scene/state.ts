/**
 * SceneState: the complete, deterministic output of compileScene, plus
 * hashing and diffing so renderers can skip no-op updates.
 */
import type { Palette, PaletteKey } from '../../mapStyle';
import type { SceneKey } from './catalog';
import type { Diagnostic, WeightedPreset } from './intent';

export type Provenance = 'default' | 'preset' | 'override' | 'locked' | 'constraint' | 'capability';

/** A weighted candidate value for one setting; weights for a setting sum to ≤ 1. */
export interface Choice {
  readonly value: string;
  readonly weight: number;
}

export interface SceneContext {
  /** `route`/`focus`: a route or focused destination is on screen; legibility wins. */
  readonly navigation: 'browse' | 'route' | 'focus';
  readonly reducedMotion: boolean;
  readonly performance: 'low' | 'medium' | 'high';
}

export const DEFAULT_CONTEXT: SceneContext = Object.freeze({ navigation: 'browse', reducedMotion: false, performance: 'medium' });

export interface DisabledRequest {
  readonly key: SceneKey;
  readonly value: string;
  readonly reason: string;
}

export interface SceneOverlay {
  readonly key: SceneKey;
  readonly value: string;
  /** 0..1 */
  readonly opacity: number;
  /** Verified SVG asset IDs a renderer may use for this overlay. */
  readonly textureIds: readonly string[];
}

export interface SetPiece {
  readonly layoutId: string;
  readonly heroAssetIds: readonly string[];
  readonly accentAssetIds: readonly string[];
}

export interface SceneState {
  readonly schemaVersion: '1.0.0';
  readonly catalogVersion: string;
  readonly compilerVersion: string;
  readonly capabilityProfile: string;
  readonly sessionVersion: number;
  /** Which input produced the scene (precedence: outing > account > neutral). */
  readonly source: 'outing' | 'account' | 'neutral';
  readonly presets: readonly WeightedPreset[];
  /** Exactly one value per catalog key: the dominant choice after all rules. */
  readonly resolved: Readonly<Record<SceneKey, string>>;
  /** Effective strength (0..1) of every non-default resolved value. */
  readonly strengths: Readonly<Record<SceneKey, number>>;
  readonly provenance: Readonly<Record<SceneKey, Provenance>>;
  /** Requested but not rendered: unsupported by this renderer, never reported active. */
  readonly disabled: readonly DisabledRequest[];
  /** The continuous realization of all weighted choices; contrast-guarded. */
  readonly palette: Palette;
  /** White-edged pins (vibeTheme `vibe-dark`; that class changes nothing else). */
  readonly darkMode: boolean;
  /**
   * Pin treatment the guard relied on: none, white edge (`darkMode`), or the
   * proposed two-tone contrast ring (only on renderers that declare it).
   */
  readonly pinEdge: 'none' | 'white' | 'two_tone';
  readonly lighting: { readonly color: string; readonly intensity: number; readonly position: readonly [number, number, number] };
  readonly sky: {
    readonly skyColor: string;
    readonly horizonColor: string;
    readonly fogColor: string;
    readonly skyHorizonBlend: number;
    readonly horizonFogBlend: number;
    readonly fogGroundBlend: number;
  };
  readonly overlays: readonly SceneOverlay[];
  readonly markers: Readonly<Record<string, string>>;
  readonly ui: { readonly accent: string | null; readonly tokens: Readonly<Record<string, string>> };
  readonly motion: { readonly transitionMs: number; readonly ambient: boolean };
  readonly setPiece: SetPiece | null;
  readonly diagnostics: readonly Diagnostic[];
  /**
   * Render hash: everything above except `sessionVersion` and `diagnostics`.
   * Equal hash ⇒ identical look ⇒ nothing to re-render, even across versions.
   */
  readonly hash: string;
}

/** JSON with sorted object keys: identical values always serialize identically. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/** Two independent 32-bit FNV-1a passes → 16 hex chars. Not cryptographic; for caching and diffing. */
export function hashString(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x01000193) ^ (b >>> 13);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

/** Hash of what a renderer reads; excludes `sessionVersion` and `diagnostics`. */
export function renderHash(state: Omit<SceneState, 'hash'>): string {
  const { sessionVersion: _v, diagnostics: _d, ...look } = state;
  return hashString(stableStringify(look));
}

export interface SceneDiff {
  readonly same: boolean;
  readonly resolved: readonly SceneKey[];
  readonly palette: readonly PaletteKey[];
  readonly lighting: boolean;
  readonly sky: boolean;
  readonly overlays: boolean;
  readonly markers: boolean;
  readonly ui: boolean;
  readonly motion: boolean;
  readonly setPiece: boolean;
  readonly pins: boolean;
}

/** What changed between two states (a null `from` means everything did). */
export function diffScene(from: SceneState | null, to: SceneState): SceneDiff {
  const eq = (a: unknown, b: unknown) => stableStringify(a) === stableStringify(b);
  if (from && from.hash === to.hash) {
    return { same: true, resolved: [], palette: [], lighting: false, sky: false, overlays: false, markers: false, ui: false, motion: false, setPiece: false, pins: false };
  }
  return {
    same: false,
    resolved: Object.keys(to.resolved).filter((k) => from?.resolved[k] !== to.resolved[k]),
    palette: (Object.keys(to.palette) as PaletteKey[]).filter((k) => from?.palette[k] !== to.palette[k]),
    lighting: !from || !eq(from.lighting, to.lighting),
    sky: !from || !eq(from.sky, to.sky),
    overlays: !from || !eq(from.overlays, to.overlays),
    markers: !from || !eq(from.markers, to.markers),
    ui: !from || !eq(from.ui, to.ui),
    motion: !from || !eq(from.motion, to.motion),
    setPiece: !from || !eq(from.setPiece, to.setPiece),
    pins: !from || from.darkMode !== to.darkMode || from.pinEdge !== to.pinEdge,
  };
}
