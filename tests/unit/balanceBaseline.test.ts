/**
 * Balance baseline (T152) — play the **authored** Quick Battle headlessly at the
 * Phase 18 numbers and record what happens.
 *
 * `runGauntlet` (T130) can play any `BattleSetup` with both sides AI-held; this
 * spec points it at the real Quick Battle roster (`skirmishSetup`) instead of a
 * synthetic duel, over a fixed seed set, in two configurations:
 *
 * - both sides on the shipped field AI (`AGGRESSIVE_FIELD_AI`, the policy the
 *   game's Resolve control uses) — an **asymmetric** action: the company
 *   assaults the farmhouse, the enemy holds it;
 * - a **recruit vs elite** match — the difficulty tiers (T099) at their
 *   extremes, on top of the same field AI.
 *
 * The assertions are structural: every run must reach a terminal state, stay
 * under the turn cap and replay byte-identically. **Win rates are not
 * asserted** — they are printed as a table and recorded in `docs/BALANCE.md`
 * (baseline section), so a later tuning pass compares against a "before"
 * without making this test fail for doing its job.
 *
 * Reproduce the tables with:
 *
 * ```bash
 * npm run test -- --run tests/unit/balanceBaseline.test.ts
 * ```
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAX_GAUNTLET_TURNS,
  runGauntlet,
  type GauntletPolicy,
  type GauntletSummary,
} from "../../src/ai/gauntlet";
import { AGGRESSIVE_FIELD_AI } from "../../src/app/battleRunner";
import { skirmishSetup } from "../../src/app/skirmishScenario";
import { hashBattleState } from "../../src/engine/serialize";

/* --------------------------------------------------------------------------
 * Fixtures
 * ------------------------------------------------------------------------ */

/** Fixed seeds: a stable "before" picture, not a random sample. */
const SEEDS = [
  "baseline-1",
  "baseline-2",
  "baseline-3",
  "baseline-4",
  "baseline-5",
  "baseline-6",
  "baseline-7",
  "baseline-8",
] as const;

/**
 * The shipped field AI on both sides. The bare utility defaults hold position
 * instead of closing to contact, so a baseline must use the policy the game
 * actually resolves battles with.
 */
const FIELD: GauntletPolicy = { id: "field-ai", ai: AGGRESSIVE_FIELD_AI };

/** The authored difficulty extremes (T099), on top of the field AI. */
const RECRUIT: GauntletPolicy = {
  id: "company-recruit",
  ai: AGGRESSIVE_FIELD_AI,
  difficulty: "recruit",
};
const ELITE: GauntletPolicy = { id: "enemy-elite", ai: AGGRESSIVE_FIELD_AI, difficulty: "elite" };

/** One reproducible row of a baseline table. */
interface BaselineRow {
  readonly seed: string;
  readonly winner: string;
  readonly outcome: string;
  readonly turns: number;
  readonly companyLost: number;
  readonly enemyLost: number;
}

/** Play one seed and flatten the summary into a printable row. */
function measure(
  seed: string,
  policyA: GauntletPolicy,
  policyB: GauntletPolicy,
): { row: BaselineRow; summary: GauntletSummary } {
  const summary = runGauntlet(skirmishSetup(), seed, policyA, policyB);
  return {
    summary,
    row: {
      seed,
      winner: summary.winner ?? "—",
      outcome: summary.outcome ?? "—",
      turns: summary.turns,
      companyLost: summary.unitsLost.company,
      enemyLost: summary.unitsLost.enemy,
    },
  };
}

/** A compact fixed-width table for the test log / docs. */
function table(rows: readonly BaselineRow[]): string {
  const header = "seed        winner  outcome          turns  lost(A/B)";
  const lines = rows.map(
    (row) =>
      `${row.seed.padEnd(11)} ${row.winner.padEnd(7)} ${row.outcome.padEnd(16)} ` +
      `${String(row.turns).padStart(5)}  ${row.companyLost}/${row.enemyLost}`,
  );
  return [header, "-".repeat(header.length), ...lines].join("\n");
}

/** Assertions every baseline run must satisfy, whatever the winner. */
function expectCleanRun(summary: GauntletSummary): void {
  expect(summary.stop).toBe("finished");
  expect(summary.finished).toBe(true);
  expect(summary.outcome).not.toBeNull();
  expect(summary.turns).toBeGreaterThan(0);
  expect(summary.turns).toBeLessThanOrEqual(DEFAULT_MAX_GAUNTLET_TURNS);
  expect(summary.unitsLost.total).toBeGreaterThan(0);
}

/* --------------------------------------------------------------------------
 * The baseline
 * ------------------------------------------------------------------------ */

describe("balance baseline — authored Quick Battle (T152)", () => {
  it("finishes every field-AI seed and prints the baseline table", () => {
    const rows: BaselineRow[] = [];
    for (const seed of SEEDS) {
      const { row, summary } = measure(seed, FIELD, FIELD);
      expectCleanRun(summary);
      rows.push(row);
    }

    // Printed for the record and for copying into docs/BALANCE.md. The exact
    // split is not asserted; the tripwire only fails if the authored Quick
    // Battle becomes a walkover for either side (T153).
    console.log(`\nCompany vs enemy, same field AI (${SEEDS.length} seeds):\n${table(rows)}\n`);

    const companyWins = rows.filter((row) => row.winner === "A").length;
    const enemyWins = rows.filter((row) => row.winner === "B").length;
    expect(companyWins).toBeGreaterThanOrEqual(2);
    expect(enemyWins).toBeGreaterThanOrEqual(2);
  });

  it("finishes every recruit-vs-elite seed and prints the table", () => {
    const rows: BaselineRow[] = [];
    for (const seed of SEEDS) {
      const { row, summary } = measure(seed, RECRUIT, ELITE);
      expectCleanRun(summary);
      rows.push(row);
    }

    console.log(`\nRecruit company vs elite enemy (${SEEDS.length} seeds):\n${table(rows)}\n`);
    expect(rows.length).toBe(SEEDS.length);
  });

  it("replays a seed byte-identically", () => {
    const first = runGauntlet(skirmishSetup(), "baseline-repeat", FIELD, FIELD);
    const second = runGauntlet(skirmishSetup(), "baseline-repeat", FIELD, FIELD);

    expect(second.outcome).toBe(first.outcome);
    expect(second.turns).toBe(first.turns);
    expect(second.unitsLost).toEqual(first.unitsLost);
    expect(hashBattleState(second.state)).toBe(hashBattleState(first.state));
    expect(second.events).toEqual(first.events);
  });
});
