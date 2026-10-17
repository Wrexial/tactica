/**
 * Enemy and ally decision making (Phase 9). AI submits the same Commands as the
 * player; it never mutates engine state directly.
 *
 * `utility.ts` (T095) holds the utility-based scorer and turn planner,
 * `heuristics.ts` (T097) the support/consumable/Élan value functions it reads,
 * later Phase 9 tasks add auto-battle wiring (T098), and `difficulty.ts` (T099)
 * the seeded aggression/mistake tiers and decision budget.
 */
export * from "./utility";
export * from "./heuristics";
export * from "./difficulty";
