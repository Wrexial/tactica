/**
 * Tests for the headless AI-vs-AI gauntlet (T130, peer lesson L11).
 *
 * Pins the contracts a balance harness depends on: `runGauntlet(setup, seed,
 * policyA, policyB)` plays a full battle with **both** sides AI-driven, never
 * touches the renderer or the UI, is deterministic for a fixed seed and
 * policies, is loop-guarded, and reports an outcome / turn count / casualty
 * summary that tests can assert.
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAX_GAUNTLET_TURNS,
  GAUNTLET_CONTROL,
  GauntletError,
  countCasualties,
  policyForSide,
  runGauntlet,
  type GauntletPolicy,
} from "../../src/ai/gauntlet";
import { DEFAULT_UTILITY_WEIGHTS } from "../../src/ai/utility";
import { DEFAULT_CONTROL_POLICY, isAiControlled } from "../../src/app/autoBattle";
import type { StatBlock } from "../../src/data/schema";
import type { ActionSpec } from "../../src/engine/actions/resolve";
import type { BattleSetup } from "../../src/engine/battle";
import { coord } from "../../src/engine/grid";
import { asAbilityId, asPostId, asUnitId, type UnitId } from "../../src/engine/ids";
import { createTerrainMap } from "../../src/engine/terrain";
import { createUnit, type Unit, type UnitInit } from "../../src/engine/unit";

/* --------------------------------------------------------------------------
 * Fixtures
 * ------------------------------------------------------------------------ */

const COMPANY_ID = asUnitId("company-1");
const ENEMY_ID = asUnitId("enemy-1");
const NEUTRAL_ID = asUnitId("neutral-1");

const SOLDIER_STATS: StatBlock = {
  hp: 40,
  mp: 20,
  atk: 30,
  def: 0,
  mag: 5,
  res: 8,
  spd: 10,
  move: 3,
  jump: 2,
};

const MAP = createTerrainMap(5, 3, "field");

const MUSKET: ActionSpec = {
  id: asAbilityId("musket-fire"),
  mpCost: 0,
  chargeTime: 0,
  range: 6,
  power: 100,
};

function makeUnit(
  id: UnitId,
  at: ReturnType<typeof coord>,
  side: "company" | "enemy" | "neutral",
  overrides: Partial<UnitInit> = {},
): Unit {
  return createUnit({
    id,
    name: `Soldier ${id}`,
    power: "france",
    postId: asPostId("fusilier"),
    side,
    level: 1,
    at,
    stats: { ...SOLDIER_STATS },
    ...overrides,
  });
}

/** A one-v-one annihilation board; the company to the west, the enemy to the east. */
function duelSetup(
  companyOverrides: Partial<UnitInit> = {},
  enemyOverrides: Partial<UnitInit> = {},
): BattleSetup {
  return {
    map: MAP,
    units: [
      makeUnit(COMPANY_ID, coord(0, 1), "company", companyOverrides),
      makeUnit(ENEMY_ID, coord(4, 1), "enemy", enemyOverrides),
    ],
    abilities: [MUSKET],
    objective: { kind: "annihilation" },
  };
}

/**
 * A passive policy that would rather hold than fight: every offensive weight is
 * zeroed and the brace bonus is huge, so its soldiers never land a blow. Used to
 * prove each policy is wired to its own side.
 */
const PASSIVE: GauntletPolicy = {
  id: "passive",
  ai: {
    weights: {
      ...DEFAULT_UTILITY_WEIGHTS,
      damage: 0,
      kill: 0,
      threat: 0,
      advance: 0,
      exposure: 0,
      brace: 1000,
    },
  },
};

/** The stock, aggressive utility policy: the default AI. */
const AGGRESSIVE: GauntletPolicy = { id: "aggressive" };

/* --------------------------------------------------------------------------
 * The run
 * ------------------------------------------------------------------------ */

describe("runGauntlet (T130)", () => {
  it("plays a full battle to a terminal state and reports a summary", () => {
    const summary = runGauntlet(duelSetup(), 1815, AGGRESSIVE, AGGRESSIVE);

    expect(summary.stop).toBe("finished");
    expect(summary.finished).toBe(true);
    expect(summary.outcome === "companyVictory" || summary.outcome === "companyDefeat").toBe(true);
    expect(summary.winner === "A" || summary.winner === "B").toBe(true);
    expect(summary.turns).toBeGreaterThan(0);
    expect(summary.unitsLost.total).toBeGreaterThanOrEqual(1);
    // The whole battle is here: deployment opens and the conclusion closes it.
    expect(summary.events.some((event) => event.kind === "battleStarted")).toBe(true);
    expect(summary.events.some((event) => event.kind === "battleEnded")).toBe(true);
  });

  it("settles an overwhelming advantage for the side that earns it", () => {
    const summary = runGauntlet(
      duelSetup(
        { stats: { ...SOLDIER_STATS, hp: 200, atk: 100, spd: 30 } },
        { stats: { ...SOLDIER_STATS, hp: 20, atk: 1, spd: 5 } },
      ),
      1815,
      AGGRESSIVE,
      AGGRESSIVE,
    );

    expect(summary.outcome).toBe("companyVictory");
    expect(summary.winner).toBe("A");
    expect(summary.unitsLost.enemy).toBe(1);
    expect(summary.unitsLost.company).toBe(0);
    expect(summary.unitsLost.total).toBe(1);
  });

  it("wires policy A to the company and policy B to the enemy", () => {
    const companyWins = runGauntlet(duelSetup(), 1815, AGGRESSIVE, PASSIVE);
    const enemyWins = runGauntlet(duelSetup(), 1815, PASSIVE, AGGRESSIVE);

    // Swapping the policies swaps the winner, proving neither is ignored.
    expect(companyWins.outcome).toBe("companyVictory");
    expect(companyWins.winner).toBe("A");
    expect(companyWins.policyA).toBe("aggressive");
    expect(companyWins.policyB).toBe("passive");

    expect(enemyWins.outcome).toBe("companyDefeat");
    expect(enemyWins.winner).toBe("B");
    expect(enemyWins.policyA).toBe("passive");
    expect(enemyWins.policyB).toBe("aggressive");
  });

  it("is deterministic for a fixed setup, seed and pair of policies", () => {
    const first = runGauntlet(duelSetup(), 1815, AGGRESSIVE, AGGRESSIVE);
    const second = runGauntlet(duelSetup(), 1815, AGGRESSIVE, AGGRESSIVE);

    expect(JSON.stringify(second.state)).toBe(JSON.stringify(first.state));
    expect(JSON.stringify(second.events)).toBe(JSON.stringify(first.events));
    expect(second.outcome).toBe(first.outcome);
    expect(second.stop).toBe(first.stop);
    expect(second.turns).toBe(first.turns);
    expect(second.unitsLost).toEqual(first.unitsLost);
  });

  it("never mutates the authored setup", () => {
    const setup = duelSetup();
    const before = JSON.stringify(setup);
    runGauntlet(setup, 1815, AGGRESSIVE, AGGRESSIVE);
    expect(JSON.stringify(setup)).toBe(before);
  });

  it("runs the difficulty tier path when a policy names one", () => {
    const veteran: GauntletPolicy = { id: "veteran-line", difficulty: "veteran" };
    const recruit: GauntletPolicy = { id: "recruit-line", difficulty: "recruit" };

    const summary = runGauntlet(duelSetup(), 42, veteran, recruit);
    expect(summary.finished).toBe(true);
    expect(summary.turns).toBeGreaterThan(0);
  });

  it("caps a sandbox battle at maxTurns instead of spinning", () => {
    const sandbox: BattleSetup = {
      map: MAP,
      units: [
        makeUnit(COMPANY_ID, coord(0, 1), "company", { stats: { ...SOLDIER_STATS, move: 1 } }),
        makeUnit(ENEMY_ID, coord(4, 1), "enemy", { stats: { ...SOLDIER_STATS, move: 1 } }),
      ],
      // No objective: the battle only ends on annihilation, which a 1-turn cap
      // can never reach.
      abilities: [MUSKET],
    };

    const summary = runGauntlet(sandbox, 1815, AGGRESSIVE, AGGRESSIVE, { maxTurns: 1 });
    expect(summary.stop).toBe("limit");
    expect(summary.finished).toBe(false);
    expect(summary.outcome).toBeNull();
    expect(summary.winner).toBeNull();
    expect(summary.turns).toBe(1);
    expect(summary.unitsLost.total).toBe(0);
  });

  it("returns an empty turn count for a zero-turn cap", () => {
    const summary = runGauntlet(duelSetup(), 1815, AGGRESSIVE, AGGRESSIVE, { maxTurns: 0 });
    expect(summary.stop).toBe("limit");
    expect(summary.turns).toBe(0);
    expect(summary.finished).toBe(false);
  });

  it("rejects a malformed turn cap", () => {
    expect(() => runGauntlet(duelSetup(), 1815, AGGRESSIVE, AGGRESSIVE, { maxTurns: -1 })).toThrow(
      GauntletError,
    );
    expect(() => runGauntlet(duelSetup(), 1815, AGGRESSIVE, AGGRESSIVE, { maxTurns: 1.5 })).toThrow(
      GauntletError,
    );
  });

  it("rejects a policy with no id", () => {
    expect(() => runGauntlet(duelSetup(), 1815, { id: "" }, AGGRESSIVE)).toThrow(GauntletError);
  });

  it("routes a neutral arbiter through the neutral policy", () => {
    expect(policyForSide("company", AGGRESSIVE, PASSIVE)).toBe(AGGRESSIVE);
    expect(policyForSide("enemy", AGGRESSIVE, PASSIVE)).toBe(PASSIVE);
    expect(policyForSide("neutral", AGGRESSIVE, PASSIVE)).toBe(PASSIVE);

    const neutral: GauntletPolicy = { id: "arbiter" };
    expect(policyForSide("neutral", AGGRESSIVE, PASSIVE, neutral)).toBe(neutral);

    // A neutral soldier on the field is commanded by the neutral policy and
    // never blocks the run.
    const withArbiter: BattleSetup = {
      map: MAP,
      units: [
        makeUnit(COMPANY_ID, coord(0, 1), "company", {
          stats: { ...SOLDIER_STATS, hp: 200, atk: 100 },
        }),
        makeUnit(ENEMY_ID, coord(4, 1), "enemy", { stats: { ...SOLDIER_STATS, hp: 20, atk: 1 } }),
        makeUnit(NEUTRAL_ID, coord(2, 2), "neutral"),
      ],
      abilities: [MUSKET],
      objective: { kind: "annihilation" },
    };
    const summary = runGauntlet(withArbiter, 1815, AGGRESSIVE, AGGRESSIVE, { neutral });
    expect(summary.finished).toBe(true);
    expect(summary.outcome).toBe("companyVictory");
  });
});

/* --------------------------------------------------------------------------
 * The fixed ownership contract
 * ------------------------------------------------------------------------ */

describe("GAUNTLET_CONTROL (T130)", () => {
  it("hands every side to the AI, unlike the default single-player split", () => {
    for (const side of ["company", "enemy", "neutral"] as const) {
      const soldier = makeUnit(asUnitId(`${side}-x`), coord(0, 0), side);
      expect(isAiControlled(soldier, GAUNTLET_CONTROL)).toBe(true);
    }
    // The ordinary split still leaves the company to the player.
    const company = makeUnit(COMPANY_ID, coord(0, 0), "company");
    expect(isAiControlled(company, DEFAULT_CONTROL_POLICY)).toBe(false);
    expect(DEFAULT_MAX_GAUNTLET_TURNS).toBeGreaterThan(0);
  });
});

/* --------------------------------------------------------------------------
 * Casualty accounting
 * ------------------------------------------------------------------------ */

describe("countCasualties (T130)", () => {
  it("counts net losses by side and ignores the already-down", () => {
    const initial = [
      makeUnit(COMPANY_ID, coord(0, 0), "company"),
      makeUnit(ENEMY_ID, coord(1, 0), "enemy"),
      makeUnit(asUnitId("enemy-2"), coord(2, 0), "enemy"),
      makeUnit(NEUTRAL_ID, coord(3, 0), "neutral"),
      makeUnit(asUnitId("company-dead"), coord(4, 0), "company", { hp: 0 }),
    ];
    const final = [
      { ...initial[0]!, hp: 10 },
      { ...initial[1]!, hp: 0 },
      // enemy-2 removed from the field entirely.
      { ...initial[3]!, hp: 5 },
      { ...initial[4]!, hp: 0 },
    ];

    const losses = countCasualties(initial, final);
    expect(losses.enemy).toBe(2); // one KO, one removed
    expect(losses.company).toBe(0); // the pre-battle casualty is not a loss
    expect(losses.neutral).toBe(0);
    expect(losses.total).toBe(2);
  });
});
