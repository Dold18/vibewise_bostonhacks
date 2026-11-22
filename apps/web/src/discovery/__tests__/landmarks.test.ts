import { describe, expect, it } from 'vitest';
import { bostonCommon } from '../landmarks';

describe('Boston Common (Recenter fallback)', () => {
  it('comes from the bundled OpenStreetMap list', () => {
    const common = bostonCommon();
    expect(common?.label).toBe('Boston Common');
    // Inside the Common's real extent (Tremont / Beacon / Charles / Boylston streets).
    expect(common!.location.lat).toBeGreaterThan(42.3525);
    expect(common!.location.lat).toBeLessThan(42.3575);
    expect(common!.location.lng).toBeGreaterThan(-71.0705);
    expect(common!.location.lng).toBeLessThan(-71.0615);
  });
});
