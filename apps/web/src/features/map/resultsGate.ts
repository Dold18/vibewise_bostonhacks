/**
 * Decides who owns the map pins while the quiz's final search results are showing.
 *
 * While the gate is active, pin-drawing functions wrapped with `guard` do nothing, and a map-move category
 * reload (`enterReload(true)`) is skipped. A user-driven reload (`enterReload(false)`) releases the gate so
 * the activity layers take the pins back. Kept free of map and DOM code so it can be unit-tested; main.ts
 * cannot be imported in tests.
 */
export function createResultsGate() {
  let active = false;
  return {
    get active(): boolean { return active; },
    set(value: boolean): void { active = value; },
    /** `draw`, but a no-op while final results own the pins. Calls `draw` exactly once per call otherwise. */
    guard<A extends unknown[]>(draw: (...args: A) => void): (...args: A) => void {
      return (...args) => { if (!active) draw(...args); };
    },
    /** Entry check for a category reload: false means skip it (a map move while results are showing). */
    enterReload(refresh: boolean): boolean {
      if (!active) return true;
      if (refresh) return false;
      active = false;
      return true;
    },
  };
}
