/**
 * Tests for the Field AI turn runner (T119).
 *
 * Pins the contract the campaign loop depends on: `runAiTurn` plans and commits
 * one non-company soldier's turn through `step`, `runAiUntilPlayer` advances
 * past consecutive AI actors and hands control back at the first player-held
 * company soldier (or when the battle ends), and both stay pure,
 * deterministic and loop-guarded.
 */

import { describe, expect, it } from "vitest";

import { DEFAULT_CONTROL_POLICY, autoBattleAllies } from "../../src/app/autoBattle";
import { BattleRunnerError, runAiTurn, runAiUntilPlayer } from "../../src/app/battleRunner";
import type { StatBlock } from "../../src/data/schema";
import type { ActionSpec } from "../../src/engine/actions/resolve";
import { createBattle, step, type BattleState } from "../../src/engine/battle";
import { coord, type Coord } from "../../src/engine/grid";
import { asAbilityId, asPostId, asUnitId, type UnitId } from "../../src/engine/ids";
import { createTerrainMap } from "../../src/engine/terrain";
import { createUnit, type Unit, type UnitInit } from "../../src/engine/unit";

/* --------------------------------------------------------------------------
 * Fixtures
 * ------------------------------------------------------------------------ */

const ENEMY_ID = asUnitId("enemy-1");
const ENEMY_B_ID = asUnitId("enemy-2");
const COMPANY_ID = asUnitId("company-1");
const ALLY_ID = asUnitId("ally-1");
const PLAYER_ID = asUnitId("player-1");

const SOLDIER_STATS: StatBlock = {
  hp: 120,
  mp: 20,
  atk: 20,
  def: 8,
  mag: 5,
  res: 8,
  spd: 10,
  move: 3,
  jump: 2,
};

const MAP = createTerrainMap(8, 8, "field");

const MUSKET: ActionSpec = {
  id: asAbilityId("musket-fire"),
  mpCost: 0,
  chargeTime: 0,
  range: 5,
  power: 100,
};

function makeUnit(
  id: UnitId,
  at: Coord,
  side: "company" | "enemy",
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

/** A battle whose opening charge is pinned, so the turn order is exact. */
function tempoBattle(
  units: readonly Unit[],
  initialCharge: Readonly<Record<string, number>>,
): BattleState {
  return createBattle(1815, { map: MAP, units, abilities: [MUSKET], initialCharge });
}

/* --------------------------------------------------------------------------
 * runAiTurn
 * ------------------------------------------------------------------------ */

describe("runAiTurn (T119)", () => {
  it("plans and commits a non-company actor's turn through step", () => {
    const battle = tempoBattle(
      [
        makeUnit(ENEMY_ID, coord(0, 0), "enemy"),
        makeUnit(COMPANY_ID, coord(0, 3), "company"),
      ],
      { [ENEMY_ID]: 100 },
    );
    expect(battle.currentActorId).toBe(ENEMY_ID);

    const before = JSON.stringify(battle);
    const turn = runAiTurn(battle, ENEMY_ID);

    expect(turn.rejection).toBeNull();
    expect(turn.unitId).toBe(ENEMY_ID);
    expect(turn.commands.length).toBeGreaterThan(0);
    // It takes the hostile soldier as its mark, not a friendly one.
    expect(turn.plan.target).toEqual({ kind: "unit", unitId: COMPANY_ID });
    expect(
      turn.events.some((event) => event.kind === "abilityUsed" && event.targetId === COMPANY_ID),
    ).toBe(true);
    // The turn closed and advanced Orders Tempo.
    expect(
      turn.events.some((event) => event.kind === "turnEnded" && event.unitId === ENEMY_ID),
    ).toBe(true);
    expect(turn.state.currentActorId).not.toBe(ENEMY_ID);
    // Purity: the input battle is untouched.
    expect(JSON.stringify(battle)).toBe(before);
  });

  it("refuses an unknown, wrong, out-of-action or player-held actor", () => {
    const battle = tempoBattle(
      [
        makeUnit(ENEMY_ID, coord(0, 0), "enemy"),
        makeUnit(ENEMY_B_ID, coord(1, 0), "enemy"),
        makeUnit(COMPANY_ID, coord(4, 4), "company"),
      ],
      { [ENEMY_ID]: 100 },
    );

    expect(() => runAiTurn(battle, asUnitId("ghost"))).toThrow(BattleRunnerError);
    // ENEMY_B is deployed but does not hold the turn.
    expect(() => runAiTurn(battle, ENEMY_B_ID)).toThrow(BattleRunnerError);

    const downed = tempoBattle(
      [
        makeUnit(ENEMY_ID, coord(0, 0), "enemy", { hp: 0 }),
        makeUnit(COMPANY_ID, coord(4, 4), "company"),
      ],
      { [ENEMY_ID]: 100 },
    );
    expect(() => runAiTurn(downed, ENEMY_ID)).toThrow(BattleRunnerError);

    const playerTurn = tempoBattle(
      [
        makeUnit(COMPANY_ID, coord(0, 0), "company"),
        makeUnit(ENEMY_ID, coord(4, 4), "enemy"),
      ],
      { [COMPANY_ID]: 100 },
    );
    expect(() => runAiTurn(playerTurn, COMPANY_ID)).toThrow(BattleRunnerError);
  });

  it("refuses a turn once the battle has finished", () => {
    const battle = createBattle(1815, {
      map: MAP,
      units: [makeUnit(COMPANY_ID, coord(0, 0), "company")],
      abilities: [MUSKET],
      objective: { kind: "survive", turns: 1 },
    });
    const finished = step(battle, { kind: "wait", unitId: COMPANY_ID }).state;
    expect(finished.phase).toBe("finished");

    expect(() => runAiTurn(finished, COMPANY_ID)).toThrow(BattleRunnerError);
  });

  it("accepts a company ally delegated with autoBattleAllies (T098)", () => {
    const battle = tempoBattle(
      [
        makeUnit(ALLY_ID, coord(0, 0), "company"),
        makeUnit(ENEMY_ID, coord(0, 3), "enemy"),
      ],
      { [ALLY_ID]: 100 },
    );

    // By default the company is the player's, so the AI refuses the turn...
    expect(() => runAiTurn(battle, ALLY_ID)).toThrow(BattleRunnerError);

    // ...but delegating the ally hands it to the AI.
    const policy = autoBattleAllies(DEFAULT_CONTROL_POLICY, [ALLY_ID]);
    const turn = runAiTurn(battle, ALLY_ID, { policy });
    expect(turn.rejection).toBeNull();
    expect(turn.plan.target).toEqual({ kind: "unit", unitId: ENEMY_ID });
  });
});

/* --------------------------------------------------------------------------
 * runAiUntilPlayer
 * ------------------------------------------------------------------------ */

describe("runAiUntilPlayer (T119)", () => {
  it("runs consecutive AI turns, then stops at the company soldier", () => {
    const battle = tempoBattle(
      [
        makeUnit(ENEMY_ID, coord(0, 0), "enemy"),
        makeUnit(COMPANY_ID, coord(0, 3), "company"),
      ],
      { [ENEMY_ID]: 100, [COMPANY_ID]: 99 },
    );
    expect(battle.currentActorId).toBe(ENEMY_ID);

    const before = JSON.stringify(battle);
    const run = runAiUntilPlayer(battle);

    expect(run.stop).toBe("player-turn");
    expect(run.nextActorId).toBe(COMPANY_ID);
    expect(run.turns).toHaveLength(1);
    expect(run.turns[0]?.unitId).toBe(ENEMY_ID);
    // Opening events are included even when the player acts next.
    expect(run.events.some((event) => event.kind === "battleStarted")).toBe(true);
    // Purity: the input battle is untouched.
    expect(JSON.stringify(battle)).toBe(before);
  });

  it("returns control immediately when the player acts first", () => {
    const battle = tempoBattle(
      [
        makeUnit(COMPANY_ID, coord(0, 0), "company"),
        makeUnit(ENEMY_ID, coord(4, 4), "enemy"),
      ],
      { [COMPANY_ID]: 100 },
    );

    const run = runAiUntilPlayer(battle);

    expect(run.stop).toBe("player-turn");
    expect(run.turns).toHaveLength(0);
    expect(run.nextActorId).toBe(COMPANY_ID);
    expect(run.state.currentActorId).toBe(COMPANY_ID);
  });

  it("stops when the battle reaches its objective", () => {
    const battle = createBattle(1815, {
      map: MAP,
      units: [
        makeUnit(ENEMY_ID, coord(0, 0), "enemy"),
        makeUnit(COMPANY_ID, coord(0, 3), "company"),
      ],
      abilities: [MUSKET],
      objective: { kind: "survive", turns: 1 },
      initialCharge: { [ENEMY_ID]: 100 },
    });
    expect(battle.currentActorId).toBe(ENEMY_ID);

    const run = runAiUntilPlayer(battle);

    expect(run.stop).toBe("finished");
    expect(run.state.phase).toBe("finished");
    expect(run.state.outcome).toBe("companyVictory");
  });

  it("auto-battles a delegated ally, then stops at the player", () => {
    const battle = tempoBattle(
      [
        makeUnit(ALLY_ID, coord(0, 0), "company"),
        makeUnit(PLAYER_ID, coord(4, 4), "company"),
      ],
      { [ALLY_ID]: 100, [PLAYER_ID]: 99 },
    );

    const policy = autoBattleAllies(DEFAULT_CONTROL_POLICY, [ALLY_ID]);
    const run = runAiUntilPlayer(battle, { policy });

    expect(run.stop).toBe("player-turn");
    expect(run.nextActorId).toBe(PLAYER_ID);
    expect(run.turns.map((turn) => turn.unitId)).toEqual([ALLY_ID]);
  });

  it("is deterministic across identical battles", () => {
    const build = (): BattleState =>
      tempoBattle(
        [
          makeUnit(ENEMY_ID, coord(0, 0), "enemy"),
          makeUnit(ENEMY_B_ID, coord(2, 0), "enemy"),
          makeUnit(COMPANY_ID, coord(2, 2), "company"),
        ],
        { [ENEMY_ID]: 100, [ENEMY_B_ID]: 80, [COMPANY_ID]: 90 },
      );

    const first = runAiUntilPlayer(build(), { maxTurns: 20 });
    const second = runAiUntilPlayer(build(), { maxTurns: 20 });

    expect(JSON.stringify(second.state)).toBe(JSON.stringify(first.state));
    expect(JSON.stringify(second.events)).toBe(JSON.stringify(first.events));
    expect(second.stop).toBe(first.stop);
    expect(second.turns.length).toBe(first.turns.length);
  });

  it("caps an all-AI run at maxTurns", () => {
    const battle = tempoBattle(
      [
        makeUnit(ENEMY_ID, coord(0, 0), "enemy"),
        makeUnit(ENEMY_B_ID, coord(2, 0), "enemy"),
      ],
      { [ENEMY_ID]: 100 },
    );

    const run = runAiUntilPlayer(battle, { maxTurns: 3 });

    expect(run.stop).toBe("limit");
    expect(run.turns).toHaveLength(3);
  });

  it("rejects a malformed turn cap", () => {
    const battle = tempoBattle([makeUnit(COMPANY_ID, coord(0, 0), "company")], {
      [COMPANY_ID]: 100,
    });
    expect(() => runAiUntilPlayer(battle, { maxTurns: -1 })).toThrow(BattleRunnerError);
  });
});
