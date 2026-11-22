/**
 * Campaign action baseline (T165) — play **every** combat contract headlessly.
 *
 * T164 proved each contract resolves a board and a garrison; this spec plays
 * them. For every combat contract it builds the battle through the real
 * deployment path (`buildBattleFromContract`) with a company at the map's
 * `recommendedLevel`, then runs the headless gauntlet with the shipped field AI
 * on both sides.
 *
 * The assertions are deliberately structural — every run must reach a terminal
 * state, under the turn cap — because the point is to catch a **stall** or a
 * broken pairing, not to pin win rates. The measured table is printed and
 * recorded in `docs/BALANCE.md`; a later tuning pass compares against it.
 *
 * Reproduce with:
 *
 * ```bash
 * npm run test -- --run tests/unit/campaignBaseline.test.ts
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
import { battleMapFor, buildBattleFromContract, isCombatContract } from "../../src/app/battleSetup";
import { CONTRACT_LIST } from "../../src/data/contracts";
import type { BattleMapDef } from "../../src/data/maps";
import type { BattleSetup } from "../../src/engine/battle";
import { createCompany, type Company } from "../../src/engine/company";
import { coord } from "../../src/engine/grid";
import { asCompanyId, asPostId, asUnitId } from "../../src/engine/ids";
import { createPostAssignment } from "../../src/engine/progression/posts";
import { createUnit } from "../../src/engine/unit";

/* --------------------------------------------------------------------------
 * Fixtures
 * ------------------------------------------------------------------------ */

/** The clipboard company: one of each battlefield role the posts cover. */
const COMPANY_POSTS = [
  "fusilier",
  "grenadier",
  "marksman",
  "surgeon",
  "colour-guard",
  "intelligence-officer",
] as const;

/** A deterministic company at `level`, with `size` soldiers in role order. */
function companyAt(level: number, size = COMPANY_POSTS.length): Company {
  const roster = COMPANY_POSTS.slice(0, size).map((post, index) => {
    const assignment = createPostAssignment({ primaryPostId: asPostId(post), power: "france" });
    const unit = createUnit({
      id: asUnitId(`baseline-${index}`),
      name: `Baseline ${index}`,
      power: "france",
      postId: asPostId(post),
      level,
      at: coord(0, 0),
      stats: { hp: 1, mp: 0, atk: 1, def: 1, mag: 1, res: 1, spd: 1, move: 3, jump: 2 },
    });
    return { unit, assignment };
  });
  return createCompany({ id: asCompanyId("baseline-company"), name: "The Baseline", roster });
}

/** The field AI on both sides: what the Resolve control actually runs. */
const FIELD: GauntletPolicy = { id: "field-ai", ai: AGGRESSIVE_FIELD_AI };

/** One row of the measured table. */
interface ActionRow {
  readonly contract: string;
  readonly map: string;
  readonly level: number;
  readonly objective: string;
  readonly winner: string;
  readonly turns: number;
  readonly companyLost: number;
  readonly enemyLost: number;
}

/** Convert a deployed battle into the gauntlet's setup shape. */
function setupOf(battle: ReturnType<typeof buildBattleFromContract>): BattleSetup {
  return {
    map: battle.map,
    units: battle.units,
    abilities: Object.values(battle.abilities),
    ...(battle.objective === null ? {} : { objective: battle.objective.objective }),
  };
}

/** Play one contract once and flatten the summary into a table row. */
function play(
  contractId: string,
  map: BattleMapDef,
  seed: string,
): { row: ActionRow; summary: GauntletSummary } {
  const battle = buildBattleFromContract(
    seed,
    companyAt(map.recommendedLevel),
    CONTRACT_LIST.find((entry) => entry.id === contractId)!,
    map,
  );
  const summary = runGauntlet(setupOf(battle), seed, FIELD, FIELD);
  return {
    summary,
    row: {
      contract: contractId,
      map: map.id,
      level: map.recommendedLevel,
      objective: map.objective.kind,
      winner: summary.winner ?? "—",
      turns: summary.turns,
      companyLost: summary.unitsLost.company,
      enemyLost: summary.unitsLost.enemy,
    },
  };
}

/** A compact fixed-width table for the test log / docs. */
function table(rows: readonly ActionRow[]): string {
  const header = "contract                    map                   lvl  obj          win  turns  lost(A/B)";
  const lines = rows.map(
    (row) =>
      `${row.contract.padEnd(28)}${row.map.padEnd(22)}${String(row.level).padEnd(5)}` +
      `${row.objective.padEnd(13)}${row.winner.padEnd(5)}${String(row.turns).padStart(5)}  ` +
      `${row.companyLost}/${row.enemyLost}`,
  );
  return [header, "-".repeat(header.length), ...lines].join("\n");
}

/* --------------------------------------------------------------------------
 * The sweep
 * ------------------------------------------------------------------------ */

describe("campaign actions resolve (T165)", () => {
  it("plays every combat contract to a result", () => {
    const contracts = CONTRACT_LIST.filter(isCombatContract);
    expect(contracts.length).toBeGreaterThanOrEqual(20);

    const rows: ActionRow[] = [];
    for (const contract of contracts) {
      const map = battleMapFor(contract);
      expect(map, `${contract.id} must resolve a board`).not.toBeNull();
      const { row, summary } = play(contract.id, map as BattleMapDef, `baseline-${contract.id}`);

      expect(summary.stop, `${contract.id} must finish, not ${summary.stop}`).toBe("finished");
      expect(summary.finished, contract.id).toBe(true);
      expect(summary.outcome, contract.id).not.toBeNull();
      expect(summary.turns, contract.id).toBeGreaterThan(0);
      expect(summary.turns, contract.id).toBeLessThanOrEqual(DEFAULT_MAX_GAUNTLET_TURNS);
      // Casualties are *recorded*, not required: a `defend`/`survive` clock can
      // run out with nobody down, and that is a result, not a failure.

      rows.push(row);
    }

    // Printed for the record and for copying into docs/BALANCE.md.
    console.log(`\nCampaign actions (${rows.length} contracts):\n${table(rows)}\n`);
  }, 600_000);
});
