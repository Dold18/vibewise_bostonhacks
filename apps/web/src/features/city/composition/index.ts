/**
 * Workstream: PROCEDURAL COMPOSITION AND VARIATION (Chat 6). Owns `features/city/composition/**`.
 *
 * Produces the CityPlan from SceneState: which treatments, how strong, at what
 * scale and tint, with which manifest assets, how they vary across the city,
 * and how the shared budget is split. Placeholder: the baseline planner.
 * Whatever this returns still passes through the engine's `enforcePolicy`.
 */
import type { CityPlanner } from '../contracts';
import { baselinePlanner } from '../plan';

export function createCityPlanner(): CityPlanner {
  return baselinePlanner;
}
