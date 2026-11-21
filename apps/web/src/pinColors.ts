/**
 * Pin colors per map category. Shared by the map (main.ts) and the vibe
 * theme's contrast guard, which keeps pins readable on a themed map.
 */
export const PIN_COLORS: Record<string, string> = {
  search: '#ea4335',
  restaurants: '#f2711c',
  coffee: '#a5673f',
  bars: '#c2185b',
  parks: '#1e8e3e',
  museums: '#1a73e8',
};
