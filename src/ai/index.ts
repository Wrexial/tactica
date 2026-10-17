/**
 * Enemy and ally decision making (Phase 9). AI submits the same Commands as the
 * player; it never mutates engine state directly.
 *
 * `utility.ts` (T095) holds the utility-based scorer and turn planner,
 * `heuristics.ts` (T097) the support/consumable/Élan value functions it reads,
 * and later Phase 9 tasks add auto-battle wiring (T098) and difficulty tiers
 * (T099).
 */
export * from "./utility";
export * from "./heuristics";
