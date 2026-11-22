import type { LayoutRecord } from './assets';

export const INSTALLATION_UNIT_METERS = 7;
/** Deliberately virtual staging area in Boston Common, unrelated to any recommended venue. */
export const STAGING_CANDIDATES = [
  [-71.0669, 42.3542], [-71.0671, 42.3542], [-71.0673, 42.3542], [-71.0667, 42.3540], [-71.0671, 42.3540],
] as const;
export function activationAllowed(layout: LayoutRecord, explicit: boolean, observance: boolean) {
  if (layout.activation === 'vibe_selected') return true;
  if (layout.activation === 'explicit_holiday_request_only') return explicit && observance;
  return explicit && ['explicit_or_verified_context', 'explicit_or_verified_seasonal_context'].includes(layout.activation);
}
