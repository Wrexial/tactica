import { describe, expect, it } from "vitest";

import {
  advanceObjective,
  createObjectiveTracker,
  evaluateObjective,
  isObjective,
  isObjectiveTracker,
  objectiveProgress,
  resolveObjectiveTurn,
  type Objective,
  type ObjectiveTracker,
} from "../../src/engine/objectives";
import { coord } from "../../src/engine/grid";
import { asPostId, asUnitId } from "../../src/engine/ids";
import { createUnit, withHp, type Unit, type UnitSide } from "../../src/engine/unit";
import type { StatBlock } from "../../src/data/schema";

/* --------------------------------------------------------------------------
 * T031 — objective scoring
 *
 * The battle integration lives in `battle.test.ts`; these tests pin the pure
 * scoring rules directly: progress advancement, each objective's win/lose
 * condition, uniform company-wipe defeat, draws and the JSON-safe validators.
 * ------------------------------------------------------------------------ */

const BASE_STATS: StatBlock = {
  hp: 60,
  mp: 20,
  atk: 12,
  def: 8,
  mag: 4,
  res: 6,
  spd: 10,
  move: 4,
  jump: 2,
};

function soldier(id: string, x: number, y: number, side: UnitSide = "company"): Unit {
  return createUnit({
    id: asUnitId(id),
    name: `Soldier ${id}`,
    power: "france",
    postId: asPostId("fusilier"),
    side,
    level: 1,
    at: coord(x, y),
    stats: { ...BASE_STATS },
  });
}

function ko(unit: Unit): Unit {
  return withHp(unit, 0);
}

describe("createObjectiveTracker", () => {
  it("starts every counter at zero and copies the objective", () => {
    const objective: Objective = { kind: "survive", turns: 3 };
    const tracker = createObjectiveTracker(objective);
    expect(tracker).toEqual({ objective, turnsElapsed: 0, heldTurns: 0 });
    expect(tracker.objective).not.toBe(objective);
  });

  it("rejects a malformed objective", () => {
    expect(() =>
      createObjectiveTracker({ kind: "rout", defeated: 0 } as unknown as Objective),
    ).toThrow(/objective/);
  });
});

describe("isObjective / isObjectiveTracker", () => {
  it("accepts every authored objective shape", () => {
    const objectives: Objective[] = [
      { kind: "annihilation" },
      { kind: "rout", defeated: 3 },
      { kind: "survive", turns: 5 },
      { kind: "capture", at: coord(2, 3) },
      { kind: "defend", at: coord(2, 3), turns: 4 },
    ];
    for (const objective of objectives) {
      expect(isObjective(objective)).toBe(true);
    }
  });

  it("rejects malformed objectives and trackers", () => {
    expect(isObjective(null)).toBe(false);
    expect(isObjective({ kind: "rout" })).toBe(false);
    expect(isObjective({ kind: "rout", defeated: 0 })).toBe(false);
    expect(isObjective({ kind: "survive", turns: -1 })).toBe(false);
    expect(isObjective({ kind: "capture", at: { x: 1.5, y: 0 } })).toBe(false);
    expect(isObjective({ kind: "defend", at: coord(0, 0) })).toBe(false);
    expect(isObjectiveTracker({ objective: { kind: "annihilation" } })).toBe(false);
    expect(
      isObjectiveTracker({
        objective: { kind: "annihilation" },
        turnsElapsed: 0,
        heldTurns: 0,
      }),
    ).toBe(true);
  });
});

describe("advanceObjective", () => {
  it("advances the mission clock without mutating the input", () => {
    const tracker = createObjectiveTracker({ kind: "survive", turns: 3 });
    const before = JSON.stringify(tracker);
    const next = advanceObjective(tracker, []);
    expect(next.turnsElapsed).toBe(1);
    expect(JSON.stringify(tracker)).toBe(before);
  });

  it("counts a held defend turn and resets when the enemy contests it", () => {
    const tracker = createObjectiveTracker({ kind: "defend", at: coord(2, 2), turns: 3 });

    const held = advanceObjective(tracker, [soldier("unit-a", 2, 2)]);
    expect(held.heldTurns).toBe(1);

    const lost = advanceObjective(held, [soldier("enemy-a", 2, 2, "enemy")]);
    expect(lost.heldTurns).toBe(0);
  });
});

describe("evaluateObjective", () => {
  it("annihilation: victory once no enemy is in action, defeat if the company is", () => {
    const tracker = createObjectiveTracker({ kind: "annihilation" });
    const company = soldier("unit-a", 0, 0);
    const enemy = soldier("enemy-a", 1, 0, "enemy");

    expect(evaluateObjective(tracker, [company, enemy])).toMatchObject({
      finished: false,
      outcome: null,
    });
    expect(evaluateObjective(tracker, [company, ko(enemy)])).toMatchObject({
      finished: true,
      outcome: "companyVictory",
    });
    expect(evaluateObjective(tracker, [ko(company), enemy])).toMatchObject({
      finished: true,
      outcome: "companyDefeat",
    });
    expect(evaluateObjective(tracker, [ko(company), ko(enemy)])).toMatchObject({
      finished: true,
      outcome: "draw",
    });
  });

  it("rout: victory at the defeat threshold", () => {
    const tracker = createObjectiveTracker({ kind: "rout", defeated: 2 });
    const company = soldier("unit-a", 0, 0);
    const one = [soldier("enemy-a", 1, 0, "enemy"), soldier("enemy-b", 2, 0, "enemy")];

    expect(evaluateObjective(tracker, [company, ...one]).finished).toBe(false);
    expect(evaluateObjective(tracker, [company, ko(one[0]), one[1]]).finished).toBe(false);
    expect(evaluateObjective(tracker, [company, ko(one[0]), ko(one[1])])).toMatchObject({
      finished: true,
      outcome: "companyVictory",
    });
  });

  it("survive: victory only once the clock is reached", () => {
    const tracker = createObjectiveTracker({ kind: "survive", turns: 2 });
    const oneTurn: ObjectiveTracker = { ...tracker, turnsElapsed: 1 };
    const twoTurns: ObjectiveTracker = { ...tracker, turnsElapsed: 2 };
    expect(evaluateObjective(oneTurn, []).finished).toBe(false);
    expect(evaluateObjective(twoTurns, [])).toMatchObject({
      finished: true,
      outcome: "companyVictory",
    });
  });

  it("capture: victory when a company soldier occupies the tile", () => {
    const tracker = createObjectiveTracker({ kind: "capture", at: coord(2, 2) });
    const enemyThere = soldier("enemy-a", 2, 2, "enemy");
    const companyThere = soldier("unit-a", 2, 2);

    expect(evaluateObjective(tracker, [enemyThere]).finished).toBe(false);
    expect(evaluateObjective(tracker, [companyThere])).toMatchObject({
      finished: true,
      outcome: "companyVictory",
    });
    // An out-of-action soldier cannot hold a point (the company still has a
    // living soldier elsewhere, so the action continues).
    expect(evaluateObjective(tracker, [ko(companyThere), soldier("unit-b", 5, 5)]).finished).toBe(
      false,
    );
  });

  it("defend: victory at the held-turn threshold, defeat if the point falls", () => {
    const tracker = createObjectiveTracker({ kind: "defend", at: coord(2, 2), turns: 2 });
    const halfHeld: ObjectiveTracker = { ...tracker, heldTurns: 1 };
    const held: ObjectiveTracker = { ...tracker, heldTurns: 2 };

    expect(evaluateObjective(halfHeld, []).finished).toBe(false);
    expect(evaluateObjective(held, [soldier("unit-a", 2, 2)])).toMatchObject({
      finished: true,
      outcome: "companyVictory",
    });
    expect(evaluateObjective(halfHeld, [soldier("enemy-a", 2, 2, "enemy")])).toMatchObject({
      finished: true,
      outcome: "companyDefeat",
    });
  });

  it("ignores neutral soldiers for both sides", () => {
    const tracker = createObjectiveTracker({ kind: "annihilation" });
    const neutral = soldier("provost", 3, 3, "neutral");
    expect(evaluateObjective(tracker, [soldier("unit-a", 0, 0), neutral])).toMatchObject({
      finished: true,
      outcome: "companyVictory",
    });
  });
});

describe("resolveObjectiveTurn", () => {
  it("advances the clock then scores, returning the tracker to store back", () => {
    const tracker = createObjectiveTracker({ kind: "survive", turns: 1 });
    const resolution = resolveObjectiveTurn(tracker, [soldier("unit-a", 0, 0)]);
    expect(resolution.tracker.turnsElapsed).toBe(1);
    expect(resolution).toMatchObject({ finished: true, outcome: "companyVictory" });
    expect(resolution.progress).toBe(1);
  });

  it("is pure and deterministic", () => {
    const tracker = createObjectiveTracker({ kind: "capture", at: coord(1, 1) });
    const units = [soldier("unit-a", 1, 1)];
    expect(resolveObjectiveTurn(tracker, units)).toEqual(resolveObjectiveTurn(tracker, units));
  });
});

describe("objectiveProgress", () => {
  it("reports a clamped fraction for each objective", () => {
    const company = soldier("unit-a", 0, 0);
    const enemies = [
      soldier("enemy-a", 1, 0, "enemy"),
      soldier("enemy-b", 2, 0, "enemy"),
      soldier("enemy-c", 3, 0, "enemy"),
    ];
    const annihilation = createObjectiveTracker({ kind: "annihilation" });
    expect(objectiveProgress(annihilation, [company, ...enemies])).toBe(0);
    expect(
      objectiveProgress(annihilation, [company, ko(enemies[0]), ...enemies.slice(1)]),
    ).toBeCloseTo(1 / 3);
    expect(objectiveProgress(annihilation, [company])).toBe(1);

    const rout = createObjectiveTracker({ kind: "rout", defeated: 2 });
    expect(objectiveProgress(rout, [company, ko(enemies[0]), ...enemies.slice(1)])).toBe(0.5);

    const survive = { ...createObjectiveTracker({ kind: "survive", turns: 4 }), turnsElapsed: 1 };
    expect(objectiveProgress(survive, [company])).toBe(0.25);

    const capture = createObjectiveTracker({ kind: "capture", at: coord(0, 0) });
    expect(objectiveProgress(capture, [company])).toBe(1);

    const defend = {
      ...createObjectiveTracker({ kind: "defend", at: coord(0, 0), turns: 3 }),
      heldTurns: 2,
    };
    expect(objectiveProgress(defend, [company])).toBeCloseTo(2 / 3);
  });
});
