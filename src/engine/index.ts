/**
 * Deterministic simulation layer (FFTA-shaped mechanics).
 *
 * Rules: no DOM, no `Math.random`, no imports from render/ui/app/persist.
 * Populated from Phase 1 (T011+): rng, ids, grid, turns, battle, rules.
 *
 * T128 adds the resolution-accounting surface (peer lesson L9): the pure
 * `accountResolution` diff helper and its result types, re-exported here so the
 * AI and battle-report layers can import them from the engine root.
 */
export * from "./accounting";
