import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createResultsGate } from './resultsGate';

describe('createResultsGate', () => {
  it('starts inactive: a guarded draw runs exactly once, with its arguments (the infinite-recursion regression)', () => {
    const gate = createResultsGate();
    const draw = vi.fn((_places: string[], _look: number) => {});
    const guarded = gate.guard(draw);
    expect(() => guarded(['a', 'b'], 7)).not.toThrow();
    expect(draw).toHaveBeenCalledTimes(1);
    expect(draw).toHaveBeenCalledWith(['a', 'b'], 7);
  });
  it('does nothing while active, and resumes when released', () => {
    const gate = createResultsGate();
    const draw = vi.fn();
    const guarded = gate.guard(draw);
    gate.set(true);
    guarded('late response');
    expect(draw).not.toHaveBeenCalled();
    gate.set(false);
    guarded('fresh');
    expect(draw).toHaveBeenCalledTimes(1);
  });
  it('a guard created while inactive still honours later activation (late responses are blocked)', () => {
    const gate = createResultsGate();
    const draw = vi.fn();
    const guarded = gate.guard(draw); // made at the start of a category load
    gate.set(true);                    // final results arrive mid-flight
    guarded();
    expect(draw).not.toHaveBeenCalled();
  });
  it('skips a map-move reload while active but lets a user-driven reload take the pins back', () => {
    const gate = createResultsGate();
    expect(gate.enterReload(true)).toBe(true);   // inactive: everything proceeds
    expect(gate.enterReload(false)).toBe(true);
    gate.set(true);
    expect(gate.enterReload(true)).toBe(false);  // map moved: leave final results alone
    expect(gate.active).toBe(true);
    expect(gate.enterReload(false)).toBe(true);  // user changed the layers: release
    expect(gate.active).toBe(false);
  });
});

/** main.ts can't be imported (it needs WebGL), so pin its wiring at the source level. */
describe('main.ts wiring', () => {
  const src = readFileSync(new URL('../../main.ts', import.meta.url), 'utf8');
  it('wraps the real showPlaces with the gate, and never defines a pin wrapper that calls itself', () => {
    expect(src).toContain('const show = resultsGate.guard(showPlaces);');
    for (const m of src.matchAll(/const\s+(\w+)\s*(?::[^=]+)?=\s*\([^)]*\)\s*=>\s*\{([^}]*)\}/g)) {
      const [, name, body] = m;
      expect(body, `${name} must not call itself`).not.toMatch(new RegExp(`(?<![\\w.])${name}\\s*\\(`));
    }
  });
  it('gates category reloads and the live ranking on the same gate', () => {
    expect(src).toContain('resultsGate.enterReload(refresh)');
    expect(src).toContain('resultsGate.active ? null : ranking');
  });
});
