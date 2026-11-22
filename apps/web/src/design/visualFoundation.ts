/**
 * Neutral map looks.
 *
 * Carbon (PR #43's mineral palette) is the approved neutral city for the
 * Vibewise V3 identity and is the production default. The other looks stay
 * available for side-by-side critique in local development only, through
 * ?visual=oxide|ultramarine, or ?visual=light for the original light map.
 *
 * Whatever look is active becomes mapStyle.basePalette before the map is
 * created, so Scene Composer and the vibe themes compile their neutral and
 * themed scenes from it and transition with setScene/setPaintProperty; there
 * is never a map.setStyle() reload.
 *
 * The dark developer UI skin that used to accompany these previews was
 * superseded by the V3 identity (src/design/vibewise) and removed: the
 * interface no longer changes with the map look.
 */
export type VisualPreview = 'carbon' | 'oxide' | 'ultramarine';
export const VISUAL_PREVIEWS: readonly VisualPreview[] = ['carbon', 'oxide', 'ultramarine'];

export function parseVisualPreview(raw: string | null): VisualPreview | null {
  return raw === 'carbon' || raw === 'oxide' || raw === 'ultramarine' ? raw : null;
}

/** The approved production neutral look. */
export const DEFAULT_NEUTRAL: VisualPreview = 'carbon';

const devParam =
  import.meta.env.DEV && typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('visual') : null;

/** A development-only override of the neutral look (never honored in production builds). */
export const activeVisualPreview: VisualPreview | null = parseVisualPreview(devParam);

/**
 * The neutral look in effect: Carbon unless a development override chose
 * another. `null` means the original light palette (dev ?visual=light).
 */
export const activeNeutral: VisualPreview | null = devParam === 'light' ? null : (activeVisualPreview ?? DEFAULT_NEUTRAL);

/**
 * Full basemap color replacements. No changes to data sources, geometries,
 * layer ordering, road widths, labels, 3D extrusion or map camera settings.
 * Explicitly covering every palette key avoids default-Google-style colors
 * leaking into the experiments.
 */
export const PREVIEW_MAP_COLORS = {
  carbon: {
    land: '#202426',
    urban: '#2C3234',
    water: '#235268',
    waterLabel: '#DAF1F4',
    park: '#3F5848',
    wood: '#30493E',
    hospital: '#343537',
    school: '#303B3E',
    sand: '#77705A',
    building: '#4D5557',
    buildingOutline: '#697375',
    building3d: '#4B545A',
    building3dMid: '#798487',
    building3dHigh: '#A2A9AA',
    roadMinor: '#7D8584',
    roadCasing: '#363F41',
    roadMajor: '#CFCEBE',
    roadMajorCasing: '#565E5F',
    highway: '#C5B79A',
    highwayCasing: '#6B6253',
    path: '#82948A',
    rail: '#A1AAAC',
    textPrimary: '#F8F6ED',
    textSecondary: '#D3DCD9',
    halo: '#171B1D',
    aeroway: '#49565B',
    runway: '#86969B',
    neighbourhoodLabel: '#E0E1D9',
    sky: '#283C4B',
    horizon: '#5C727C',
    light: '#CDDFDC',
  },
  oxide: {
    land: '#29282B',
    urban: '#343034',
    water: '#345568',
    waterLabel: '#DBE9ED',
    park: '#555846',
    wood: '#444C3F',
    hospital: '#43353B',
    school: '#413B3A',
    sand: '#81715F',
    building: '#665954',
    buildingOutline: '#87766E',
    building3d: '#5D5552',
    building3dMid: '#938076',
    building3dHigh: '#B7A297',
    roadMinor: '#90807A',
    roadCasing: '#4A3F40',
    roadMajor: '#E0C9B8',
    roadMajorCasing: '#725F59',
    highway: '#D9B18A',
    highwayCasing: '#866455',
    path: '#A09482',
    rail: '#9C9191',
    textPrimary: '#F7EDE6',
    textSecondary: '#DECFC7',
    halo: '#201E21',
    aeroway: '#5D5356',
    runway: '#9D8A85',
    neighbourhoodLabel: '#EFE0D6',
    sky: '#55414B',
    horizon: '#93747A',
    light: '#F5CBB8',
  },
  ultramarine: {
    land: '#252C43',
    urban: '#323B55',
    water: '#234C6C',
    waterLabel: '#CDEEF2',
    park: '#354C4E',
    wood: '#2F454B',
    hospital: '#42435A',
    school: '#3B465E',
    sand: '#666678',
    building: '#515E79',
    buildingOutline: '#76819A',
    building3d: '#53617D',
    building3dMid: '#8190AE',
    building3dHigh: '#B2BBD1',
    roadMinor: '#7988A4',
    roadCasing: '#3D4963',
    roadMajor: '#D4D9E2',
    roadMajorCasing: '#61708D',
    highway: '#B8ACC4',
    highwayCasing: '#69647D',
    path: '#869DB3',
    rail: '#A1ACC7',
    textPrimary: '#FCFAF8',
    textSecondary: '#DAE3F2',
    halo: '#1A2239',
    aeroway: '#4B5C70',
    runway: '#8B9DB1',
    neighbourhoodLabel: '#E5E9F8',
    sky: '#343C6F',
    horizon: '#7683B3',
    light: '#B9CFFF',
  },
} as const;

/** Apply a neutral look to the original light palette; `null` returns it unchanged. */
export function mapPaletteForPreview<T extends Record<string, string>>(
  base: T,
  preview: VisualPreview | null = activeNeutral,
): T {
  return preview ? { ...base, ...PREVIEW_MAP_COLORS[preview] } : base;
}

/** Record the active neutral look on <html> (data-neutral-map) for diagnostics and QA. */
export function activateVisualPreview(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.neutralMap = activeNeutral ?? 'light';
}
