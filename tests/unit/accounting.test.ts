import { describe, expect, it } from "vitest";

import type { StatBlock } from "../../src/data/schema";
import * as engine from "../../src/engine";
import { FriendlyFireError, accountResolution } from "../../src/engine/accounting";
import { createBattle, type BattleState } from "../../src/engine/battle";
import { coord } from "../../src/engine/grid";
import { asConditionId, asPostId, asUnitId, type UnitId } from "../../src/engine/ids";
import { createTerrainMap } from "../../src/engine/terrain";
import {
  addCondition,
  createUnit,
  withHp,
  type ActiveCondition,
  type Unit,
} from "../../src/engine/unit";

/* --------------------------------------------------------------------------
 * T128 — Resolution accounting + friendly-fire tripwire
 *
 * Peer lesson L9: credit a resolution by diffing the before/after battle
 * states, give a reaction its own credited window, and fail loudly when a
 * window credited to one side lowers that side's HP. These tests pin the four
 * things the helper reports (damage, healing, KOs, newly applied conditions),
 * the reaction credit, the tripwire and determinism/purity.
 * ------------------------------------------------------------------------ */

const COMPANY_ID = asUnitId("unit-company");
const ALLY_ID = asUnitId("unit-ally");
const FOE_ID = asUnitId("unit-foe");
const FOE2_ID = asUnitId("unit-foe-2");
const BLEEDING = asConditionId("bleeding");
const FORMED = asConditionId("formed");

const STATS: StatBlock = {
  hp: 60,
  mp: 20,
  atk: 20,
  def: 8,
  mag: 20,
  res: 10,
  spd: 10,
  move: 4,
  jump: 2,
};

const MAP = createTerrainMap(8, 6, "field");

function soldier(id: UnitId, side: "company" | "enemy", at: ReturnType<typeof coord>): Unit {
  return createUnit({
    id,
    name: `Soldier ${id}`,
    power: "france",
    postId: asPostId("fusilier"),
    side,
    level: 1,
    at,
    stats: { ...STATS },
  });
}

/** A company fireteam and two hostiles, all at full strength. */
function battle(): BattleState {
  return createBattle("t128", {
    map: MAP,
    units: [
      soldier(COMPANY_ID, "company", coord(1, 1)),
      soldier(ALLY_ID, "company", coord(1, 2)),
      soldier(FOE_ID, "enemy", coord(4, 1)),
      soldier(FOE2_ID, "enemy", coord(4, 2)),
    ],
  });
}

/** Force a soldier's HP (clamped by `withHp`), used to build an after-state. */
function setHp(state: BattleState, unitId: UnitId, hp: number): BattleState {
  return {
    ...state,
    units: state.units.map((unit) => (unit.id === unitId ? withHp(unit, hp) : unit)),
  };
}

/** Apply a condition to one soldier, used to build an after-state. */
function withCondition(
  state: BattleState,
  unitId: UnitId,
  condition: ActiveCondition,
): BattleState {
  return {
    ...state,
    units: state.units.map((unit) => (unit.id === unitId ? addCondition(unit, condition) : unit)),
  };
}

describe("accountResolution (T128)", () => {
  it("is re-exported from the engine barrel", () => {
    expect(engine.accountResolution).toBe(accountResolution);
    expect(engine.FriendlyFireError).toBe(FriendlyFireError);
  });

  it("reports damage dealt by diffing two states", () => {
    const before = battle();
    const after = setHp(before, FOE_ID, 45);

    const account = accountResolution(before, after, COMPANY_ID);

    expect(account.sourceId).toBe(COMPANY_ID);
    expect(account.damage).toEqual([
      { unitId: FOE_ID, sourceId: COMPANY_ID, amount: 15, fatal: false },
    ]);
    expect(account.damageDealt).toBe(15);
    expect(account.healing).toEqual([]);
    expect(account.kos).toEqual([]);
    expect(account.conditions).toEqual([]);
    expect(account.healingDone).toBe(0);
  });

  it("reports healing, including a same-side recovery", () => {
    const before = setHp(battle(), ALLY_ID, 30);
    const after = setHp(before, ALLY_ID, 42);

    const account = accountResolution(before, after, COMPANY_ID);

    expect(account.healing).toEqual([{ unitId: ALLY_ID, sourceId: COMPANY_ID, amount: 12 }]);
    expect(account.healingDone).toBe(12);
    expect(account.damage).toEqual([]);
  });

  it("reports a KO with fatal damage", () => {
    const before = setHp(battle(), FOE_ID, 15);
    const after = setHp(before, FOE_ID, 0);

    const account = accountResolution(before, after, COMPANY_ID);

    expect(account.kos).toEqual([FOE_ID]);
    expect(account.damage).toEqual([
      { unitId: FOE_ID, sourceId: COMPANY_ID, amount: 15, fatal: true },
    ]);
  });

  it("does not re-report a soldier who was already out of action", () => {
    const before = setHp(battle(), FOE_ID, 0);
    const after = setHp(before, FOE_ID, 0);

    const account = accountResolution(before, after, COMPANY_ID);

    expect(account.kos).toEqual([]);
    expect(account.damage).toEqual([]);
  });

  it("reports newly applied conditions once", () => {
    const before = battle();
    const after = withCondition(before, ALLY_ID, {
      conditionId: BLEEDING,
      duration: 3,
      sourceId: COMPANY_ID,
    });

    const account = accountResolution(before, after, COMPANY_ID);

    expect(account.conditions).toEqual([
      { unitId: ALLY_ID, conditionId: BLEEDING, duration: 3, sourceId: COMPANY_ID },
    ]);
  });

  it("does not report a condition refresh as newly applied", () => {
    const before = withCondition(battle(), ALLY_ID, { conditionId: BLEEDING, duration: 1 });
    const after = withCondition(before, ALLY_ID, { conditionId: BLEEDING, duration: 3 });

    const account = accountResolution(before, after, COMPANY_ID);

    expect(account.conditions).toEqual([]);
  });

  it("keeps a condition's own recorded source when the engine set one", () => {
    const before = battle();
    const after = withCondition(before, ALLY_ID, {
      conditionId: FORMED,
      duration: 2,
      sourceId: FOE_ID,
    });

    const account = accountResolution(before, after, COMPANY_ID);

    expect(account.conditions).toEqual([
      { unitId: ALLY_ID, conditionId: FORMED, duration: 2, sourceId: FOE_ID },
    ]);
  });

  it("credits a reaction to its reactor, not the attacker", () => {
    const before = battle();
    // The window is the reaction only: the company attacker took a riposte.
    const after = setHp(before, COMPANY_ID, 48);

    const reaction = accountResolution(before, after, FOE_ID);

    expect(reaction.damage).toEqual([
      { unitId: COMPANY_ID, sourceId: FOE_ID, amount: 12, fatal: false },
    ]);
    expect(reaction.damageDealt).toBe(12);

    // Crediting the same window to the attacker is incoherent — it would show
    // the company damaging its own side — so the tripwire refuses it.
    expect(() => accountResolution(before, after, COMPANY_ID)).toThrow(FriendlyFireError);
  });

  it("throws a FriendlyFireError on same-team HP loss", () => {
    const before = battle();
    const after = setHp(before, ALLY_ID, 50);

    let caught: unknown;
    try {
      accountResolution(before, after, COMPANY_ID);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(FriendlyFireError);
    const friendly = caught as FriendlyFireError;
    expect(friendly.sourceId).toBe(COMPANY_ID);
    expect(friendly.victimId).toBe(ALLY_ID);
    expect(friendly.amount).toBe(10);
  });

  it("throws when the credited source damages itself", () => {
    const before = battle();
    const after = setHp(before, COMPANY_ID, 55);

    expect(() => accountResolution(before, after, COMPANY_ID)).toThrow(FriendlyFireError);
  });

  it("returns an empty account when nothing changed", () => {
    const account = accountResolution(battle(), battle(), COMPANY_ID);

    expect(account).toEqual({
      sourceId: COMPANY_ID,
      damage: [],
      healing: [],
      kos: [],
      conditions: [],
      damageDealt: 0,
      healingDone: 0,
    });
  });

  it("reports changes in stable before-state unit order", () => {
    const before = battle();
    const after = setHp(setHp(before, FOE2_ID, 30), FOE_ID, 50);

    const account = accountResolution(before, after, COMPANY_ID);

    expect(account.damage.map((entry) => entry.unitId)).toEqual([FOE_ID, FOE2_ID]);
    expect(account.damageDealt).toBe(40);
  });

  it("skips a soldier who left the field rather than inventing HP loss", () => {
    const before = battle();
    const after: BattleState = {
      ...before,
      units: before.units.filter((unit) => unit.id !== FOE_ID),
    };

    const account = accountResolution(before, after, COMPANY_ID);

    expect(account.damage).toEqual([]);
    expect(account.kos).toEqual([]);
  });

  it("is deterministic and does not mutate its inputs", () => {
    const before = battle();
    const after = setHp(before, FOE_ID, 45);
    const beforeJson = JSON.stringify(before);
    const afterJson = JSON.stringify(after);

    const first = accountResolution(before, after, COMPANY_ID);
    const second = accountResolution(before, after, COMPANY_ID);

    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(JSON.stringify(before)).toBe(beforeJson);
    expect(JSON.stringify(after)).toBe(afterJson);
  });

  it("throws a RangeError when the credited source is not deployed", () => {
    const before = battle();
    const after = setHp(before, FOE_ID, 45);

    expect(() => accountResolution(before, after, asUnitId("unit-missing"))).toThrow(RangeError);
  });
});
