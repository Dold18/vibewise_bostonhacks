/**
 * Dev-only Visual Foundation experiments.
 *
 * A preview is opt-in through ?visual=carbon|oxide|ultramarine. Production and
 * ordinary local runs keep the existing UI and map exactly as they were.
 *
 * These palettes are only starting directions for critique, not approved
 * product themes or Scene Composer presets. The scene compiler inherits the
 * selected neutral basemap through mapStyle.basePalette.
 */
export type VisualPreview = 'carbon' | 'oxide' | 'ultramarine';
export const VISUAL_PREVIEWS: readonly VisualPreview[] = ['carbon', 'oxide', 'ultramarine'];

export function parseVisualPreview(raw: string | null): VisualPreview | null {
  return raw === 'carbon' || raw === 'oxide' || raw === 'ultramarine' ? raw : null;
}

export const activeVisualPreview: VisualPreview | null =
  import.meta.env.DEV && typeof window !== 'undefined'
    ? parseVisualPreview(new URLSearchParams(window.location.search).get('visual'))
    : null;

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

/** Preserve the exact original object when no preview is selected. */
export function mapPaletteForPreview<T extends Record<string, string>>(
  base: T,
  preview: VisualPreview | null = activeVisualPreview,
): T {
  return preview ? { ...base, ...PREVIEW_MAP_COLORS[preview] } : base;
}

/** Add styling to the document; no extra controls or DOM layout changes. */
export function activateVisualPreview(): void {
  if (!activeVisualPreview || typeof document === 'undefined') return;
  document.documentElement.dataset.visualPreview = activeVisualPreview;
  // Opt-in CSS-only Carbon UI study. Keep ?visual=carbon as the control.
  if (activeVisualPreview === 'carbon' && new URLSearchParams(window.location.search).get('studio') === '1') {
    document.documentElement.dataset.carbonStudio = '1';
  }

  // Load display type only for opt-in previews. The default product still uses
  // its original fonts; these are display and readable UI faces, not icon fonts.
  const fonts = document.createElement('link');
  fonts.rel = 'stylesheet';
  fonts.href =
    'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800;900&family=Space+Grotesk:wght@400;500;600;700&display=swap';
  document.head.append(fonts);
}
