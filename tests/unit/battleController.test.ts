import { describe, expect, it } from "vitest";

import {
  act,
  cancel,
  chooseAction,
  chooseTarget,
  commitMarch,
  confirmOrder,
  createBattleController,
  faceOrder,
  holdOrder,
  moveRangeFor,
  pathFor,
  planMove,
  selectUnit,
  setCursor,
  waitOrder,
  type BattleController,
} from "../../src/app/battleController";
import { createBattle, findUnit, step, type BattleState } from "../../src/engine/battle";
import type { ActionSpec } from "../../src/engine/actions/resolve";
import { coord, type Coord } from "../../src/engine/grid";
import { asAbilityId, asPostId, asUnitId, type UnitId } from "../../src/engine/ids";
import { createTerrainMap, withTile, type TerrainMap } from "../../src/engine/terrain";
import { createUnit, type Unit, type UnitInit } from "../../src/engine/unit";
import type { StatBlock } from "../../src/data/schema";

/* --------------------------------------------------------------------------
 * T027 — Battle UI state machine
 *
 * These tests pin the task's "done when": **select unit → show move range →
 * move → choose action → target → confirm**, with the UI state exposed for the
 * renderer/overlay. They also pin the guarantees the rest of the app leans on —
 * purity, deterministic replay of an intent sequence, and rejections without
 * mutation — because the controller drives the immutable engine (`agents.md`
 * §2, §7).
 * ------------------------------------------------------------------------ */

const ACTOR = asUnitId("unit-actor");
const FOE = asUnitId("unit-foe");
const FOE_AT: Coord = coord(4, 0);

const BASE_STATS: StatBlock = {
  hp: 60,
  mp: 20,
  atk: 12,
  def: 8,
  mag: 4,
  res: 6,
  spd: 30,
  move: 4,
  jump: 2,
};

const RIFLE: ActionSpec = {
  id: asAbilityId("rifle-volley"),
  mpCost: 5,
  chargeTime: 0,
  range: 5,
  power: 100,
};
const ADVANCE: ActionSpec = {
  id: asAbilityId("bayonet-charge"),
  mpCost: 0,
  chargeTime: 0,
  range: 1,
  power: 90,
};
const EXPENSIVE: ActionSpec = {
  id: asAbilityId("grand-barrage"),
  mpCost: 999,
  chargeTime: 0,
  range: 8,
  power: 120,
};

const MAP = createTerrainMap(6, 4, "field");

function makeUnit(id: UnitId, at: Coord, overrides: Partial<UnitInit> = {}): Unit {
  return createUnit({
    id,
    name: `Soldier ${id}`,
    power: "france",
    postId: asPostId("fusilier"),
    level: 1,
    at,
    stats: { ...BASE_STATS },
    ...overrides,
  });
}

function makeBattle(
  abilities: readonly ActionSpec[] = [RIFLE, ADVANCE],
  map: TerrainMap = MAP,
): BattleState {
  return createBattle(1815, {
    map,
    units: [
      makeUnit(ACTOR, coord(0, 0)),
      makeUnit(FOE, FOE_AT, { side: "enemy", stats: { ...BASE_STATS, spd: 0 } }),
    ],
    abilities,
  });
}

/** A controller with the acting soldier already selected. */
function selected(
  abilities: readonly ActionSpec[] = [RIFLE, ADVANCE],
  map: TerrainMap = MAP,
): BattleController {
  return selectUnit(createBattleController(makeBattle(abilities, map)), ACTOR);
}

/* --------------------------------------------------------------------------
 * Creation
 * ------------------------------------------------------------------------ */

describe("createBattleController", () => {
  it("starts the battle and exposes the opening events", () => {
    const controller = createBattleController(makeBattle());

    expect(controller.phase).toBe("select");
    expect(controller.battle.started).toBe(true);
    expect(controller.battle.currentActorId).toBe(ACTOR);
    expect(controller.selectedUnitId).toBeNull();
    expect(controller.lastEvents.map((event) => event.kind)).toEqual([
      "battleStarted",
      "unitDeployed",
      "unitDeployed",
      "turnStarted",
    ]);
    expect(controller.lastRejection).toBeNull();
  });

  it("reports a finished battle as finished", () => {
    const finished: BattleState = {
      ...makeBattle(),
      phase: "finished",
      outcome: "companyVictory",
    };
    expect(createBattleController(finished).phase).toBe("finished");
  });
});

/* --------------------------------------------------------------------------
 * Selection
 * ------------------------------------------------------------------------ */

describe("selectUnit", () => {
  it("unlocks the move range and the action menu for the acting soldier", () => {
    const controller = selected();

    expect(controller.phase).toBe("command");
    expect(controller.canAct).toBe(true);
    expect(controller.selectedUnitId).toBe(ACTOR);
    expect(controller.moveRange.length).toBeGreaterThan(1);
    expect(controller.moveRange.some((tile) => tile.at.x === 2 && tile.at.y === 0)).toBe(true);
    expect(controller.actions.map((action) => action.id)).toEqual([RIFLE.id, ADVANCE.id]);
    expect(controller.actions.every((action) => action.affordable)).toBe(true);
  });

  it("excludes tiles another soldier holds from the move range", () => {
    const controller = selected();
    expect(
      controller.moveRange.some((tile) => tile.at.x === FOE_AT.x && tile.at.y === FOE_AT.y),
    ).toBe(false);
  });

  it("selects a soldier whose turn it is not as read-only", () => {
    const controller = selectUnit(createBattleController(makeBattle()), FOE);

    expect(controller.phase).toBe("command");
    expect(controller.canAct).toBe(false);
    expect(controller.moveRange).toEqual([]);
    expect(controller.actions).toEqual([]);
  });

  it("refuses an unknown soldier without changing the phase", () => {
    const controller = selectUnit(createBattleController(makeBattle()), asUnitId("ghost"));

    expect(controller.lastRejection?.reason).toBe("unknown-unit");
    expect(controller.phase).toBe("select");
  });
});

/* --------------------------------------------------------------------------
 * Move range queries
 * ------------------------------------------------------------------------ */

describe("move range queries", () => {
  it("exposes moveRangeFor and pathFor as reusable helpers", () => {
    const battle = makeBattle();
    const actor = findUnit(battle, ACTOR);
    if (actor === undefined) throw new Error("actor missing");

    expect(moveRangeFor(battle, actor).some((tile) => tile.at.x === 2 && tile.at.y === 0)).toBe(
      true,
    );
    expect(pathFor(battle, actor, coord(2, 0))?.at(-1)).toEqual(coord(2, 0));
  });

  it("returns null for a destination behind impassable terrain", () => {
    const walled = withTile(MAP, coord(1, 0), "wall");
    const battle = makeBattle([RIFLE], walled);
    const actor = findUnit(battle, ACTOR);
    if (actor === undefined) throw new Error("actor missing");

    expect(pathFor(battle, actor, coord(1, 0))).toBeNull();
  });
});

/* --------------------------------------------------------------------------
 * Move planning
 * ------------------------------------------------------------------------ */

describe("move planning", () => {
  it("previews a path and commits it as exactly one move command", () => {
    let controller = selected();
    controller = planMove(controller, coord(2, 0));

    expect(controller.phase).toBe("move");
    expect(controller.pendingPath?.[0]).toEqual(coord(0, 0));
    expect(controller.pendingPath?.at(-1)).toEqual(coord(2, 0));
    expect(controller.cursor).toEqual(coord(2, 0));

    controller = commitMarch(controller);

    expect(controller.lastRejection).toBeNull();
    // The march leaves the same soldier's turn open: back in `command`, still
    // selected, with the move range spent and the action menu available (T138).
    expect(controller.phase).toBe("command");
    expect(controller.selectedUnitId).toBe(ACTOR);
    expect(controller.canAct).toBe(true);
    expect(controller.pendingPath).toBeNull();
    expect(controller.moveRange).toEqual([]);
    expect(controller.actions.map((action) => action.id)).toEqual([RIFLE.id, ADVANCE.id]);
    expect(controller.battle.currentActorId).toBe(ACTOR);
    expect(controller.battle.hasMovedThisTurn).toBe(true);
    expect(findUnit(controller.battle, ACTOR)?.at).toEqual(coord(2, 0));

    expect(controller.lastCommands.map((entry) => entry.kind)).toEqual(["move"]);
    const command = controller.lastCommands[0];
    expect(command.kind).toBe("move");
    if (command.kind === "move") {
      expect(command.unitId).toBe(ACTOR);
      expect(command.path.at(-1)).toEqual(coord(2, 0));
    }
    const kinds = controller.lastEvents.map((event) => event.kind);
    expect(kinds).toContain("moved");
    expect(kinds).not.toContain("turnEnded");
  });

  it("commits a previewed march through confirmOrder without closing the turn", () => {
    const controller = confirmOrder(planMove(selected(), coord(2, 0)));

    expect(controller.lastRejection).toBeNull();
    expect(controller.lastCommands.map((entry) => entry.kind)).toEqual(["move"]);
    expect(controller.phase).toBe("command");
    expect(controller.selectedUnitId).toBe(ACTOR);
    expect(controller.lastEvents.map((event) => event.kind)).not.toContain("turnEnded");
  });

  it("refuses a destination blocked by impassable terrain", () => {
    const walled = withTile(MAP, coord(1, 0), "wall");
    const controller = planMove(selected([RIFLE, ADVANCE], walled), coord(1, 0));

    expect(controller.lastRejection?.reason).toBe("illegal-move");
    expect(controller.phase).toBe("command");
    expect(controller.pendingPath).toBeNull();
  });

  it("refuses a move planned by a soldier whose turn it is not", () => {
    const readOnly = selectUnit(createBattleController(makeBattle()), FOE);
    expect(planMove(readOnly, coord(3, 0)).lastRejection?.reason).toBe("not-your-turn");
  });
});

/* --------------------------------------------------------------------------
 * Action targeting
 * ------------------------------------------------------------------------ */

describe("action targeting", () => {
  it("aims an action, exposes target tiles, and commits it", () => {
    let controller = selected();
    controller = chooseAction(controller, RIFLE.id);

    expect(controller.phase).toBe("target");
    expect(controller.pendingActionId).toBe(RIFLE.id);
    expect(controller.targetTiles).toContainEqual(FOE_AT);

    controller = chooseTarget(controller, { kind: "unit", unitId: FOE });
    expect(controller.phase).toBe("confirm");
    expect(controller.pendingTarget).toEqual({ kind: "unit", unitId: FOE });

    controller = confirmOrder(controller);

    expect(controller.lastRejection).toBeNull();
    expect(findUnit(controller.battle, ACTOR)?.mp).toBe(20 - RIFLE.mpCost);
    const kinds = controller.lastEvents.map((event) => event.kind);
    expect(kinds).toContain("abilityUsed");
    expect(kinds).toContain("abilityResolved");
    expect(kinds).toContain("turnEnded");
  });

  it("refuses an action the soldier cannot afford", () => {
    let controller = selected([EXPENSIVE]);
    controller = chooseAction(controller, EXPENSIVE.id);

    expect(controller.lastRejection?.reason).toBe("insufficient-elan");
    expect(controller.phase).toBe("command");
    expect(controller.pendingActionId).toBeNull();
  });

  it("refuses to stage an action while a march is only previewed", () => {
    const previewed = planMove(selected(), coord(2, 0));
    expect(previewed.phase).toBe("move");

    const refused = chooseAction(previewed, RIFLE.id);
    expect(refused.lastRejection?.reason).toBe("unsupported");
    expect(refused.lastRejection?.message).toContain("march");
    // The preview is not silently folded into the plan.
    expect(refused.phase).toBe("move");
    expect(refused.pendingActionId).toBeNull();
    expect(refused.pendingPath).toEqual(previewed.pendingPath);
    expect(refused.lastCommands).toEqual([]);
  });

  it("derives target tiles from the committed tile, not the preview", () => {
    // From the starting tile (0, 0) this far tile is out of the rifle's reach.
    const before = chooseAction(selected(), RIFLE.id);
    expect(before.targetTiles).not.toContainEqual(coord(4, 3));

    // Preview only: no targeting tiles are derived from the previewed path.
    const previewed = planMove(selected(), coord(2, 0));
    expect(chooseAction(previewed, RIFLE.id).phase).toBe("move");

    // Commit the march, then aim: reach comes from the soldier's new tile.
    const committed = commitMarch(previewed);
    expect(findUnit(committed.battle, ACTOR)?.at).toEqual(coord(2, 0));
    const aimed = chooseAction(committed, RIFLE.id);
    expect(aimed.phase).toBe("target");
    expect(aimed.targetTiles).toContainEqual(coord(4, 3));
  });

  it("refuses an action this battle does not know", () => {
    const controller = chooseAction(selected(), asAbilityId("unknown-action"));
    expect(controller.lastRejection?.reason).toBe("unknown-ability");
  });

  it("aims, targets and confirms an action in one call", () => {
    const controller = act(selected(), RIFLE.id, { kind: "unit", unitId: FOE });

    expect(controller.lastRejection).toBeNull();
    expect(findUnit(controller.battle, ACTOR)?.mp).toBe(20 - RIFLE.mpCost);
    expect(controller.lastCommands.map((command) => command.kind)).toEqual(["act"]);
  });
});

/* --------------------------------------------------------------------------
 * The full turn flow
 * ------------------------------------------------------------------------ */

describe("the full turn flow", () => {
  it("marches, then acts from the committed tile as two separate dispatches", () => {
    let controller = createBattleController(makeBattle());
    expect(controller.phase).toBe("select");

    controller = selectUnit(controller, ACTOR);
    expect(controller.phase).toBe("command");
    expect(controller.moveRange.length).toBeGreaterThan(1);

    // Move: preview, then commit the march on its own (T138).
    controller = planMove(controller, coord(1, 0));
    expect(controller.phase).toBe("move");
    expect(controller.pendingPath?.at(-1)).toEqual(coord(1, 0));

    controller = confirmOrder(controller);
    expect(controller.lastRejection).toBeNull();
    expect(controller.lastCommands.map((command) => command.kind)).toEqual(["move"]);
    expect(controller.phase).toBe("command");
    expect(controller.selectedUnitId).toBe(ACTOR);
    expect(findUnit(controller.battle, ACTOR)?.at).toEqual(coord(1, 0));

    // Act: aimed and confirmed from the tile the soldier now occupies.
    controller = chooseAction(controller, RIFLE.id);
    expect(controller.phase).toBe("target");
    expect(controller.targetTiles).toContainEqual(FOE_AT);

    controller = chooseTarget(controller, { kind: "unit", unitId: FOE });
    expect(controller.phase).toBe("confirm");

    controller = confirmOrder(controller);
    expect(controller.lastRejection).toBeNull();

    const actor = findUnit(controller.battle, ACTOR);
    expect(actor?.at).toEqual(coord(1, 0));
    expect(actor?.mp).toBe(20 - RIFLE.mpCost);

    // The action is one `act` command; the march was a separate dispatch, so
    // the human path never emits `[move, act]` in one batch (T139).
    expect(controller.lastCommands.map((command) => command.kind)).toEqual(["act"]);
    const kinds = controller.lastEvents.map((event) => event.kind);
    expect(kinds).not.toContain("moved");
    expect(kinds).toContain("abilityUsed");
    expect(kinds).toContain("abilityResolved");
    expect(kinds).toContain("turnEnded");
    expect(controller.battle.hasMovedThisTurn).toBe(false);
  });

  it("never bundles a march and an action into one dispatch", () => {
    const dispatches: string[][] = [];
    const record = (controller: BattleController): BattleController => {
      dispatches.push(controller.lastCommands.map((command) => command.kind));
      return controller;
    };

    let controller = selectUnit(createBattleController(makeBattle()), ACTOR);
    controller = planMove(controller, coord(2, 0));

    // Every action intent while the march is previewed is refused without a
    // dispatch and without staging anything.
    const refused = [
      chooseAction(controller, RIFLE.id),
      chooseAction(controller, ADVANCE.id),
      act(controller, RIFLE.id, { kind: "unit", unitId: FOE }),
      chooseTarget(controller, { kind: "self" }),
    ];
    for (const intent of refused) {
      expect(intent.lastRejection).not.toBeNull();
      expect(intent.lastCommands).toEqual([]);
      expect(intent.pendingActionId).toBeNull();
      expect(intent.phase).toBe("move");
    }

    controller = record(confirmOrder(controller));
    expect(controller.lastCommands.map((command) => command.kind)).toEqual(["move"]);

    controller = chooseAction(controller, RIFLE.id);
    controller = chooseTarget(controller, { kind: "unit", unitId: FOE });
    record(confirmOrder(controller));

    expect(dispatches).toEqual([["move"], ["act"]]);
    expect(dispatches.some((kinds) => kinds.includes("move") && kinds.includes("act"))).toBe(
      false,
    );
  });
});

/* --------------------------------------------------------------------------
 * T127 — per-turn action budget
 * ------------------------------------------------------------------------ */

describe("per-turn action budget (T127)", () => {
  it("commits the two-step move-and-act flow and clears the budget", () => {
    let controller = createBattleController(makeBattle());
    controller = selectUnit(controller, ACTOR);
    controller = planMove(controller, coord(1, 0));
    controller = confirmOrder(controller);
    expect(controller.lastCommands.map((command) => command.kind)).toEqual(["move"]);
    controller = chooseAction(controller, RIFLE.id);
    controller = chooseTarget(controller, { kind: "unit", unitId: FOE });
    controller = confirmOrder(controller);

    expect(controller.lastRejection).toBeNull();
    expect(controller.lastCommands.map((command) => command.kind)).toEqual(["act"]);
    expect(controller.battle.hasMovedThisTurn).toBe(false);
    expect(controller.battle.hasActedThisTurn).toBe(false);
  });

  it("hides the move range and refuses a second march once the move is spent", () => {
    const battle = makeBattle();
    const actor = battle.currentActorId as UnitId;
    // A native move leaves the turn open (T115); hand that mid-turn state to a
    // fresh controller, as a save/load would.
    const moved = step(battle, {
      kind: "move",
      unitId: actor,
      path: [coord(0, 0), coord(1, 0)],
    }).state;
    expect(moved.hasMovedThisTurn).toBe(true);

    const controller = selectUnit(createBattleController(moved), actor);
    expect(controller.canAct).toBe(true);
    expect(controller.moveRange).toEqual([]);
    expect(planMove(controller, coord(2, 0)).lastRejection?.reason).toBe("already-moved");
  });
});

/* --------------------------------------------------------------------------
 * Orders without a target
 * ------------------------------------------------------------------------ */

describe("orders without a target", () => {
  it("dispatches wait, hold and face for the acting soldier", () => {
    const base = selected();

    const waited = waitOrder(base);
    expect(waited.lastCommands[0]?.kind).toBe("wait");
    expect(waited.lastEvents.map((event) => event.kind)).toContain("turnEnded");

    const held = holdOrder(base);
    expect(held.lastCommands[0]?.kind).toBe("hold");
    expect(held.lastEvents.map((event) => event.kind)).toContain("conditionApplied");

    const faced = faceOrder(base, "east");
    expect(faced.lastCommands[0]?.kind).toBe("face");
    expect(findUnit(faced.battle, ACTOR)?.facing).toBe("east");
  });

  it("refuses orders from a soldier whose turn it is not", () => {
    const readOnly = selectUnit(createBattleController(makeBattle()), FOE);
    expect(waitOrder(readOnly).lastRejection?.reason).toBe("not-your-turn");
  });
});

/* --------------------------------------------------------------------------
 * Backing out
 * ------------------------------------------------------------------------ */

describe("cancel", () => {
  it("steps back through the phases and clears the plan", () => {
    let controller = selected();
    controller = chooseAction(controller, RIFLE.id);
    controller = chooseTarget(controller, { kind: "self" });
    expect(controller.phase).toBe("confirm");

    controller = cancel(controller);
    expect(controller.phase).toBe("target");

    controller = cancel(controller);
    expect(controller.phase).toBe("command");
    expect(controller.pendingActionId).toBeNull();

    controller = cancel(controller);
    expect(controller.phase).toBe("select");
    expect(controller.selectedUnitId).toBeNull();
  });

  it("backs out of a previewed march without staging its action", () => {
    let controller = planMove(selected(), coord(2, 0));
    expect(controller.phase).toBe("move");

    controller = cancel(controller);
    expect(controller.phase).toBe("command");
    expect(controller.pendingPath).toBeNull();
    expect(controller.pendingActionId).toBeNull();
    expect(controller.lastCommands).toEqual([]);
    expect(findUnit(controller.battle, ACTOR)?.at).toEqual(coord(0, 0));
  });
});

/* --------------------------------------------------------------------------
 * Cursor, purity and determinism
 * ------------------------------------------------------------------------ */

describe("cursor, purity and determinism", () => {
  it("moves the cursor and ignores off-grid tiles", () => {
    const controller = selected();
    expect(setCursor(controller, coord(2, 1)).cursor).toEqual(coord(2, 1));
    expect(setCursor(controller, coord(99, 99)).cursor).toBeNull();
    expect(setCursor(controller, null).cursor).toBeNull();
  });

  it("does not mutate the input controller", () => {
    const controller = selected();
    const before = JSON.stringify(controller);

    planMove(controller, coord(1, 0));
    chooseAction(controller, RIFLE.id);
    setCursor(controller, coord(3, 3));

    expect(JSON.stringify(controller)).toBe(before);
  });

  it("replays the same intent sequence to an identical battle", () => {
    const run = (): string => {
      let controller = selected();
      controller = planMove(controller, coord(1, 0));
      controller = confirmOrder(controller);
      controller = chooseAction(controller, RIFLE.id);
      controller = chooseTarget(controller, { kind: "unit", unitId: FOE });
      controller = confirmOrder(controller);
      return JSON.stringify(controller.battle);
    };
    expect(run()).toBe(run());
  });

  it("exposes a JSON-serialisable controller", () => {
    const controller = selected();
    expect(JSON.parse(JSON.stringify(controller))).toEqual(controller);
  });
});
