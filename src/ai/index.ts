/**
 * Enemy and ally decision making (Phase 9). AI submits the same Commands as the
 * player; it never mutates engine state directly.
 *
 * `utility.ts` (T095) holds the utility-based scorer and turn planner and
 * remains the production default; `naive.ts` (T132) is the small, deterministic
 * fallback for fixtures and ally auto-battle; `heuristics.ts` (T097) the
 * support/consumable/Élan value functions the utility AI reads, and
 * `difficulty.ts` (T099) the seeded aggression/mistake tiers and decision
 * budget. `gauntlet.ts` (T130) plays a complete headless AI-vs-AI battle with
 * two side policies for balance testing.
 */
export * from "./naive";
export * from "./utility";
export * from "./heuristics";
export * from "./difficulty";
export * from "./gauntlet";
