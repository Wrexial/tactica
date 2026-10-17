/**
 * Battle input controller (T030) — turns pointer, touch and keyboard events
 * into calls on the battle controller (`agents.md` §7).
 *
 * The input layer owns **no simulation**: it reads the current
 * {@link BattleController}, converts an intent (a cursor move, a click on a
 * tile, a confirm) into the controller's pure transition functions, and hands
 * the new value to the app through `onControllerChange`. That keeps the engine
 * deterministic and the UI testable — the interesting part of this module
 * ({@link pressKey}, {@link clickTile}, {@link moveCursor}) is framework-free
 * and unit-tested in Node.
 *
 * ## Controls
 *
 * | Input                | Effect                                                   |
 * | -------------------- | -------------------------------------------------------- |
 * | Arrows / WASD        | Move the cursor one tile (north/east/south/west)         |
 * | Click / tap          | Focus that tile, then confirm it                          |
 * | Enter / Space        | Confirm the focused tile (select → plan → confirm)       |
 * | Escape               | Back out one step (cancel the staged order)              |
 * | Drag / wheel         | Handled by `render/scene.ts` (pan / zoom), not here      |
 *
 * A click is distinguished from a camera drag by a small movement threshold, so
 * panning never accidentally selects a tile. Pointer events cover mouse, pen
 * and touch uniformly.
 *
 * ## The confirm ladder
 *
 * Confirming a tile is contextual, mirroring the FFTA turn (march, then act):
 *
 * - `select`  → a soldier on the tile is selected (the range appears);
 * - `command` → a reachable tile plans the march (path preview);
 * - `move`    → confirming the path's destination commits the march;
 * - `target`  → the tile (or its soldier) becomes the aimed target;
 * - `confirm` → the staged order is dispatched through the engine.
 *
 * Screens and orders the retheme names: a **soldier** takes an Orders Tempo
 * turn and marches across the field; the fiction never leaks the FFTA terms.
 */

import { findUnit } from "../engine/battle";
import { tileTarget, unitTarget, type Target } from "../engine/commands";
import { coordEquals, inBounds, type Coord } from "../engine/grid";
import { isOutOfAction, type Unit } from "../engine/unit";
import { pickTile, worldFromScreen, type Camera } from "../render/tiles";
import {
  cancel,
  chooseTarget,
  confirmOrder,
  planMove,
  selectUnit,
  setCursor,
  type BattleController,
} from "./battleController";

/* --------------------------------------------------------------------------
 * Key mapping
 * ------------------------------------------------------------------------ */

/**
 * Cursor deltas for the navigation keys, in **grid** space. Arrow/WASD map to
 * the engine's cardinal axes (`north = -y`, `east = +x`), keeping input
 * independent of the isometric projection (locked decision D10).
 */
export const NAVIGATION_KEYS: Readonly<Record<string, Coord>> = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  w: { x: 0, y: -1 },
  s: { x: 0, y: 1 },
  a: { x: -1, y: 0 },
  d: { x: 1, y: 0 },
};

const CONFIRM_KEYS = new Set(["Enter", " ", "Spacebar"]);
const CANCEL_KEYS = new Set(["Escape", "Esc"]);

/* --------------------------------------------------------------------------
 * Pure intents
 * ------------------------------------------------------------------------ */

/** Whether a navigation key is handled (used to decide `preventDefault`). */
export function isNavigationKey(key: string): boolean {
  return NAVIGATION_KEYS[key] !== undefined || NAVIGATION_KEYS[key.toLowerCase()] !== undefined;
}

/** The living soldier standing on `at`, if any. */
function unitAt(controller: BattleController, at: Coord): Unit | undefined {
  return controller.battle.units.find(
    (unit) => !isOutOfAction(unit) && unit.at.x === at.x && unit.at.y === at.y,
  );
}

/** The selected soldier, if one is selected and still on the field. */
function selectedActor(controller: BattleController): Unit | undefined {
  if (controller.selectedUnitId === null) return undefined;
  return findUnit(controller.battle, controller.selectedUnitId);
}

/**
 * Where the cursor starts when a navigation key is pressed before any tile has
 * been focused: the soldier whose turn it is, then the first deployed soldier.
 */
export function defaultCursor(controller: BattleController): Coord {
  if (controller.battle.currentActorId !== null) {
    const actor = findUnit(controller.battle, controller.battle.currentActorId);
    if (actor !== undefined) return { x: actor.at.x, y: actor.at.y };
  }
  const first = controller.battle.units[0];
  return first !== undefined ? { x: first.at.x, y: first.at.y } : { x: 0, y: 0 };
}

/** Move the cursor one step, ignoring a step that would leave the battlefield. */
export function moveCursor(controller: BattleController, delta: Coord): BattleController {
  const from = controller.cursor ?? defaultCursor(controller);
  const next = { x: from.x + delta.x, y: from.y + delta.y };
  if (!inBounds(controller.battle.map.grid, next)) return controller;
  return setCursor(controller, next);
}

/**
 * Confirm a specific tile, advancing the contextual ladder described in the
 * module header. Always pure: the input controller is returned unchanged when
 * no order applies.
 */
export function activateTile(controller: BattleController, at: Coord): BattleController {
  switch (controller.phase) {
    case "select": {
      const unit = unitAt(controller, at);
      return unit !== undefined ? selectUnit(controller, unit.id) : controller;
    }

    case "command": {
      const actor = selectedActor(controller);
      if (actor !== undefined && coordEquals(at, actor.at)) return controller;
      if (controller.moveRange.some((tile) => coordEquals(tile.at, at))) {
        return planMove(controller, at);
      }
      const unit = unitAt(controller, at);
      return unit !== undefined ? selectUnit(controller, unit.id) : controller;
    }

    case "move": {
      const destination = controller.pendingPath?.at(-1);
      if (destination !== undefined && coordEquals(at, destination)) {
        return confirmOrder(controller);
      }
      if (controller.moveRange.some((tile) => coordEquals(tile.at, at))) {
        return planMove(controller, at);
      }
      return controller;
    }

    case "target": {
      const unit = unitAt(controller, at);
      const target: Target = unit !== undefined ? unitTarget(unit.id) : tileTarget(at);
      return chooseTarget(controller, target);
    }

    case "confirm":
      return confirmOrder(controller);

    case "finished":
      return controller;
  }
}

/** Confirm the focused tile (or the default cursor tile when none is focused). */
export function activateCursor(controller: BattleController): BattleController {
  return activateTile(controller, controller.cursor ?? defaultCursor(controller));
}

/** Focus `at` (when legal) and confirm it in one intent — the click/tap path. */
export function clickTile(controller: BattleController, at: Coord): BattleController {
  if (!inBounds(controller.battle.map.grid, at)) return controller;
  return activateTile(setCursor(controller, at), at);
}

/**
 * Apply a keyboard intent. Navigation keys move the cursor, confirm keys act on
 * it and cancel keys back out; anything else is ignored (so typing in a future
 * input field is unaffected).
 */
export function pressKey(controller: BattleController, key: string): BattleController {
  const delta = NAVIGATION_KEYS[key] ?? NAVIGATION_KEYS[key.toLowerCase()];
  if (delta !== undefined) return moveCursor(controller, delta);
  if (CONFIRM_KEYS.has(key)) return activateCursor(controller);
  if (CANCEL_KEYS.has(key)) return cancel(controller);
  return controller;
}

/* --------------------------------------------------------------------------
 * DOM binding
 * ------------------------------------------------------------------------ */

/** The canvas, camera and controller the input controller reads and writes. */
export interface InputControllerOptions {
  /** The battlefield canvas that receives pointer input. */
  readonly canvas: HTMLCanvasElement;
  /** Reads the scene's current pan/zoom so screen pixels can be unprojected. */
  readonly getCamera: () => Camera;
  /** Reads the latest controller value (held in a ref by the app). */
  readonly getController: () => BattleController;
  /** Receives the new controller after every accepted intent. */
  readonly onControllerChange: (controller: BattleController) => void;
}

/** A live input binding. Call {@link InputController.dispose} on unmount. */
export interface InputController {
  /** Remove every listener. Idempotent. */
  dispose(): void;
}

/** Pointer travel (px) above which a press is treated as a camera drag, not a click. */
const CLICK_SLOP = 6;

/**
 * Bind pointer, touch and keyboard input to `canvas` and drive the controller.
 * Listeners are removed by the returned {@link InputController}.
 */
export function createInputController(options: InputControllerOptions): InputController {
  const { canvas, getCamera, getController, onControllerChange } = options;
  let pressedAt: { x: number; y: number } | null = null;
  let dragged = false;

  /** Unproject a client point through the camera and pick its tile. */
  const tileForPointer = (clientX: number, clientY: number): Coord | null => {
    const rect = canvas.getBoundingClientRect();
    const screen = { x: clientX - rect.left, y: clientY - rect.top };
    const world = worldFromScreen(getCamera(), screen);
    return pickTile(getController().battle.map, world);
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    pressedAt = { x: event.clientX, y: event.clientY };
    dragged = false;
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (pressedAt === null) return;
    const travel = Math.abs(event.clientX - pressedAt.x) + Math.abs(event.clientY - pressedAt.y);
    if (travel > CLICK_SLOP) dragged = true;
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (pressedAt === null) return;
    const wasClick = !dragged;
    pressedAt = null;
    dragged = false;
    if (!wasClick) return; // a camera drag, handled by the scene
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const at = tileForPointer(event.clientX, event.clientY);
    if (at !== null) onControllerChange(clickTile(getController(), at));
  };

  const onPointerCancel = (): void => {
    pressedAt = null;
    dragged = false;
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    if (
      target !== null &&
      (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
    ) {
      return;
    }
    const key = event.key;
    const handled = isNavigationKey(key) || CONFIRM_KEYS.has(key) || CANCEL_KEYS.has(key);
    if (!handled) return;
    event.preventDefault();
    onControllerChange(pressKey(getController(), key));
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerCancel);
  window.addEventListener("keydown", onKeyDown);

  return {
    dispose(): void {
      canvas.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("keydown", onKeyDown);
    },
  };
}
