import { describe, expect, it } from "vitest";

import {
  createBattleController,
  setCursor,
  type BattleController,
} from "../../src/app/battleController";
import {
  activateCursor,
  clickTile,
  createGamepadEdge,
  defaultCursor,
  directionForKey,
  EMPTY_GAMEPAD_FRAME,
  firstConnectedGamepad,
  isNavigationKey,
  moveCursor,
  nextFocusIndex,
  ordersAwait,
  pressKey,
  readGamepad,
  type FocusRect,
  type GamepadFrame,
} from "../../src/app/input";
import { createBattle, findUnit } from "../../src/engine/battle";
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

  it("maps keys to cardinal directions", () => {
    expect(directionForKey("ArrowLeft")).toBe("left");
    expect(directionForKey("ArrowRight")).toBe("right");
    expect(directionForKey("ArrowUp")).toBe("up");
    expect(directionForKey("ArrowDown")).toBe("down");
    expect(directionForKey("D")).toBe("right");
    expect(directionForKey("Enter")).toBeNull();
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

  it("commits the march and keeps the same soldier in command", () => {
    let controller = clickTile(activateCursor(focused()), coord(2, 1));
    const planned = controller.pendingPath?.length ?? 0;
    controller = pressKey(controller, "Enter");

    expect(controller.phase).toBe("command");
    expect(controller.selectedUnitId).toBe(ACTOR);
    expect(controller.canAct).toBe(true);
    expect(controller.pendingPath).toBeNull();
    expect(controller.moveRange).toEqual([]);
    expect(controller.lastRejection).toBeNull();
    expect(controller.lastCommands.map((command) => command.kind)).toEqual(["move"]);
    expect(controller.lastEvents.map((event) => event.kind)).toContain("moved");
    expect(controller.lastEvents.map((event) => event.kind)).not.toContain("turnEnded");
    expect(findUnit(controller.battle, ACTOR)?.at).toEqual(coord(2, 1));
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
    // Backing out never commits the preview.
    expect(cancelled.lastCommands).toEqual([]);
    expect(findUnit(cancelled.battle, ACTOR)?.at).toEqual(coord(1, 1));
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

/* --------------------------------------------------------------------------
 * T087 — gamepad navigation and menu focus geometry
 * ------------------------------------------------------------------------ */

/** Build a fake rectangle at a grid position (100px cells). */
function rect(col: number, row: number): FocusRect {
  const left = col * 100;
  const top = row * 100;
  return { left, top, right: left + 80, bottom: top + 40 };
}

/** A 3x3 grid of focusable rects in row-major order. */
const GRID: readonly FocusRect[] = [
  rect(0, 0),
  rect(1, 0),
  rect(2, 0),
  rect(0, 1),
  rect(1, 1),
  rect(2, 1),
  rect(0, 2),
  rect(1, 2),
  rect(2, 2),
];

describe("nextFocusIndex", () => {
  it("starts at the first control when nothing is focused", () => {
    expect(nextFocusIndex(GRID, -1, "right")).toBe(0);
  });

  it("moves within a row and wraps to the next row", () => {
    expect(nextFocusIndex(GRID, 0, "right")).toBe(1);
    expect(nextFocusIndex(GRID, 1, "right")).toBe(2);
    expect(nextFocusIndex(GRID, 0, "down")).toBe(3);
    expect(nextFocusIndex(GRID, 4, "up")).toBe(1);
    expect(nextFocusIndex(GRID, 4, "left")).toBe(3);
  });

  it("returns -1 when nothing lies in that direction", () => {
    expect(nextFocusIndex(GRID, 0, "up")).toBe(-1);
    expect(nextFocusIndex(GRID, 0, "left")).toBe(-1);
    expect(nextFocusIndex(GRID, 8, "down")).toBe(-1);
    expect(nextFocusIndex([rect(0, 0)], 0, "right")).toBe(-1);
  });
});

describe("readGamepad", () => {
  const buttons = (pressed: readonly number[]): { pressed: boolean }[] =>
    Array.from({ length: 16 }, (_, index) => ({ pressed: pressed.includes(index) }));

  it("reads the D-pad as a single direction", () => {
    expect(readGamepad({ buttons: buttons([15]) }).direction).toBe("right");
    expect(readGamepad({ buttons: buttons([12]) }).direction).toBe("up");
    expect(readGamepad({ buttons: buttons([]) }).direction).toBeNull();
  });

  it("reads the left stick with a deadzone", () => {
    expect(readGamepad({ buttons: buttons([]), axes: [0.9, 0] }).direction).toBe("right");
    expect(readGamepad({ buttons: buttons([]), axes: [0, -0.9] }).direction).toBe("up");
    expect(readGamepad({ buttons: buttons([]), axes: [0.3, 0.2] }).direction).toBeNull();
  });

  it("reads the action and menu buttons", () => {
    const frame = readGamepad({ buttons: buttons([0, 2, 9]) });
    expect(frame.confirm).toBe(true);
    expect(frame.orders).toBe(true);
    expect(frame.menu).toBe(true);
    expect(frame.cancel).toBe(false);
  });
});

describe("createGamepadEdge", () => {
  const frame = (overrides: Partial<GamepadFrame>): GamepadFrame => ({
    ...EMPTY_GAMEPAD_FRAME,
    ...overrides,
  });

  it("fires a button once on the rising edge", () => {
    const edge = createGamepadEdge();
    edge.update(EMPTY_GAMEPAD_FRAME, 0);
    expect(edge.update(frame({ confirm: true }), 16).confirm).toBe(true);
    expect(edge.update(frame({ confirm: true }), 32).confirm).toBe(false);
    expect(edge.update(EMPTY_GAMEPAD_FRAME, 48).confirm).toBe(false);
    expect(edge.update(frame({ confirm: true }), 64).confirm).toBe(true);
  });

  it("fires a direction once, then repeats while held", () => {
    const edge = createGamepadEdge({ initialDelayMs: 300, repeatMs: 100 });
    edge.update(EMPTY_GAMEPAD_FRAME, 0);
    expect(edge.update(frame({ direction: "right" }), 16).direction).toBe("right");
    expect(edge.update(frame({ direction: "right" }), 200).direction).toBeNull();
    expect(edge.update(frame({ direction: "right" }), 340).direction).toBe("right");
    expect(edge.update(frame({ direction: "right" }), 400).direction).toBeNull();
    expect(edge.update(frame({ direction: "right" }), 460).direction).toBe("right");
  });
});

describe("firstConnectedGamepad", () => {
  it("skips empty and disconnected pads", () => {
    const pad = { connected: true } as Gamepad;
    expect(firstConnectedGamepad([null, undefined])).toBeNull();
    expect(firstConnectedGamepad([{ connected: false } as Gamepad, pad])).toBe(pad);
  });
});

describe("ordersAwait", () => {
  it("is false until an actor with an Orders menu is confirmed", () => {
    expect(ordersAwait(focused(), coord(1, 1))).toBe(false);
    expect(ordersAwait(activateCursor(focused()), null)).toBe(false);
  });
});
