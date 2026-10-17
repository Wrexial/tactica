import { describe, expect, it } from "vitest";

import {
  createBattleController,
  setCursor,
  type BattleController,
} from "../../src/app/battleController";
import {
  activateCursor,
  clickTile,
  defaultCursor,
  isNavigationKey,
  moveCursor,
  pressKey,
} from "../../src/app/input";
import { createBattle } from "../../src/engine/battle";
import { coord, type Coord } from "../../src/engine/grid";
import { asPostId, asUnitId, type UnitId } from "../../src/engine/ids";
import { createTerrainMap } from "../../src/engine/terrain";
import { createUnit, type Unit, type UnitSide } from "../../src/engine/unit";
import type { StatBlock } from "../../src/data/schema";

/* --------------------------------------------------------------------------
 * T030 — Input controller
 *
 * The DOM binding is exercised by the Playwright spec; these tests pin the
 * framework-free intents it calls: cursor navigation, the confirm ladder
 * (select → plan → confirm), clicking a tile and backing out with Escape. They
 * also pin purity — each intent returns a new controller and never mutates the
 * one passed in.
 * ------------------------------------------------------------------------ */

const ACTOR = asUnitId("unit-actor");
const FOE = asUnitId("unit-foe");

const STATS: StatBlock = {
  hp: 40,
  mp: 10,
  atk: 8,
  def: 6,
  mag: 3,
  res: 4,
  spd: 40,
  move: 3,
  jump: 2,
};

function makeUnit(id: UnitId, at: Coord, side: UnitSide, spd: number): Unit {
  return createUnit({
    id,
    name: `Soldier ${id}`,
    power: "france",
    postId: asPostId("fusilier"),
    side,
    level: 1,
    at,
    stats: { ...STATS, spd },
  });
}

function makeController(): BattleController {
  const battle = createBattle(7, {
    map: createTerrainMap(6, 5, "field"),
    units: [makeUnit(ACTOR, coord(1, 1), "company", 40), makeUnit(FOE, coord(4, 4), "enemy", 0)],
  });
  return createBattleController(battle);
}

/** The controller focused on the acting soldier's tile. */
function focused(): BattleController {
  return setCursor(makeController(), coord(1, 1));
}

describe("key mapping", () => {
  it("recognises arrows and WASD, case-insensitively", () => {
    expect(isNavigationKey("ArrowUp")).toBe(true);
    expect(isNavigationKey("w")).toBe(true);
    expect(isNavigationKey("W")).toBe(true);
    expect(isNavigationKey("Enter")).toBe(false);
  });
});

describe("defaultCursor", () => {
  it("starts on the soldier whose Orders Tempo turn it is", () => {
    expect(defaultCursor(makeController())).toEqual(coord(1, 1));
  });
});

describe("moveCursor", () => {
  it("moves one cardinal step at a time", () => {
    expect(moveCursor(focused(), { x: 1, y: 0 }).cursor).toEqual(coord(2, 1));
    expect(moveCursor(focused(), { x: 0, y: -1 }).cursor).toEqual(coord(1, 0));
  });

  it("initialises from the actor when no cursor is set yet", () => {
    expect(pressKey(makeController(), "ArrowRight").cursor).toEqual(coord(2, 1));
  });

  it("refuses to leave the battlefield", () => {
    const atEdge = setCursor(makeController(), coord(0, 0));
    expect(moveCursor(atEdge, { x: -1, y: 0 }).cursor).toEqual(coord(0, 0));
    expect(moveCursor(atEdge, { x: 0, y: -1 }).cursor).toEqual(coord(0, 0));
  });

  it("does not mutate the controller it is given", () => {
    const before = focused();
    const after = moveCursor(before, { x: 1, y: 0 });
    expect(before.cursor).toEqual(coord(1, 1));
    expect(after).not.toBe(before);
  });
});

describe("the confirm ladder", () => {
  it("selects the soldier under the cursor and reveals the move range", () => {
    const controller = activateCursor(focused());

    expect(controller.phase).toBe("command");
    expect(controller.selectedUnitId).toBe(ACTOR);
    expect(controller.canAct).toBe(true);
    expect(controller.moveRange.length).toBeGreaterThan(1);
  });

  it("plans a march on a reachable tile and previews the path", () => {
    let controller = activateCursor(focused());
    controller = activateCursor(setCursor(controller, coord(2, 1)));

    expect(controller.phase).toBe("move");
    expect(controller.pendingPath?.at(0)).toEqual(coord(1, 1));
    expect(controller.pendingPath?.at(-1)).toEqual(coord(2, 1));
  });

  it("re-plans when the cursor moves to another reachable tile", () => {
    let controller = activateCursor(focused());
    controller = clickTile(controller, coord(2, 1));
    controller = clickTile(controller, coord(1, 2));

    expect(controller.phase).toBe("move");
    expect(controller.pendingPath?.at(-1)).toEqual(coord(1, 2));
  });

  it("confirms the march when the destination is confirmed again", () => {
    let controller = clickTile(activateCursor(focused()), coord(2, 1));
    const planned = controller.pendingPath?.length ?? 0;
    controller = pressKey(controller, "Enter");

    expect(controller.phase).toBe("select");
    expect(controller.lastRejection).toBeNull();
    expect(controller.lastCommands[0]?.kind).toBe("move");
    expect(planned).toBeGreaterThan(1);
  });
});

describe("cancel", () => {
  it("backs out of the command screen with Escape", () => {
    const controller = activateCursor(focused());
    const cancelled = pressKey(controller, "Escape");
    expect(cancelled.phase).toBe("select");
    expect(cancelled.selectedUnitId).toBeNull();
  });

  it("backs out of a planned march to the command screen", () => {
    const planned = clickTile(activateCursor(focused()), coord(2, 1));
    const cancelled = pressKey(planned, "Escape");
    expect(cancelled.phase).toBe("command");
    expect(cancelled.pendingPath).toBeNull();
  });
});

describe("clickTile", () => {
  it("focuses and confirms a tile in one intent", () => {
    const controller = clickTile(makeController(), coord(1, 1));
    expect(controller.cursor).toEqual(coord(1, 1));
    expect(controller.phase).toBe("command");
  });

  it("ignores a tile outside the battlefield", () => {
    const before = focused();
    expect(clickTile(before, coord(99, 99))).toBe(before);
  });
});

describe("unhandled keys", () => {
  it("leaves the controller untouched", () => {
    const before = focused();
    expect(pressKey(before, "q")).toBe(before);
  });
});
