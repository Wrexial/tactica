/**
 * Enemy and ally decision making (Phase 9). AI submits the same Commands as the
 * player; it never mutates engine state directly.
 *
 * `utility.ts` (T095) holds the utility-based scorer and turn planner; later
 * Phase 9 tasks add Article awareness (T096), action heuristics (T097),
 * auto-battle wiring (T098) and difficulty tiers (T099).
 */
export * from "./utility";
