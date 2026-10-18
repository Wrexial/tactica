/**
 * Input controller (T030, T087) — turns pointer, touch, keyboard and **gamepad**
 * events into calls on the battle controller and into DOM focus navigation for
 * the camp menus (`agents.md` §7).
 *
 * The input layer owns **no simulation**: it reads the current
 * {@link BattleController}, converts an intent (a cursor move, a click on a
 * tile, a confirm) into the controller's pure transition functions, and hands
 * the new value to the app through `onControllerChange`. That keeps the engine
 * deterministic and the UI testable — the interesting part of this module
 * ({@link pressKey}, {@link clickTile}, {@link moveCursor}, {@link readGamepad},
 * {@link nextFocusIndex}) is framework-free and unit-tested in Node.
 *
 * ## Two navigation layers
 *
 * The game runs in one of two modes, chosen per keypress by {@link isMenuMode}:
 *
 * - **Battle** — the arrows / WASD / D-pad move a **grid cursor** across the
 *   battlefield (`moveCursor`), confirm walks the FFTA turn ladder
 *   (select → march → act → target → confirm), and cancel backs out.
 * - **Menu** — the same keys move **DOM focus** between the camp screens'
 *   buttons ({@link focusDirection}), confirm activates the focused control and
 *   cancel leaves the camp for the field.
 *
 * A view is a menu when a camp screen is open (`view !== "battle"`) or when a
 * control inside the battlefield stage holds focus. That means the HUD's
 * Orders buttons are reachable without a mouse: confirming the acting soldier's
 * tile focuses the first order (or press `O` / gamepad **X**), then the arrows
 * browse and confirm fires it.
 *
 * ## Controls
 *
 * | Input                | Battle                                   | Menus                          |
 * | -------------------- | ---------------------------------------- | ------------------------------ |
 * | Arrows / WASD / D-pad / stick | Move the cursor one tile        | Move focus between controls    |
 * | Enter / Space / gamepad A     | Confirm the focused tile        | Activate the focused control   |
 * | Escape / gamepad B            | Back out one step               | Leave the camp for the field   |
 * | `O` / gamepad X               | Focus the Orders menu           | —                              |
 * | `M` / gamepad Start/Back      | Open the camp menu              | Return to the field            |
 * | Click / tap                   | Focus that tile, then confirm   | Click the control              |
 * | Drag / wheel                  | Handled by `render/scene.ts` (pan / zoom), not here |
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
 * Key / direction mapping
 * ------------------------------------------------------------------------ */

/** A cardinal navigation direction, shared by keyboard, gamepad and focus. */
export type Direction = "up" | "down" | "left" | "right";

/**
 * Cursor deltas for navigation, in **grid** space. `up`/`down` map to the
 * engine's north/south (`north = -y`) and `left`/`right` to west/east, keeping
 * input independent of the isometric projection (locked decision D10).
 */
export const DIRECTION_DELTAS: Readonly<Record<Direction, Coord>> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/**
 * Cursor deltas for the navigation keys, in **grid** space. Kept for backward
 * compatibility with the T030 controller; new code should use
 * {@link DIRECTION_DELTAS} via {@link directionForKey}.
 */
export const NAVIGATION_KEYS: Readonly<Record<string, Coord>> = {
  ArrowUp: DIRECTION_DELTAS.up,
  ArrowDown: DIRECTION_DELTAS.down,
  ArrowLeft: DIRECTION_DELTAS.left,
  ArrowRight: DIRECTION_DELTAS.right,
  w: DIRECTION_DELTAS.up,
  s: DIRECTION_DELTAS.down,
  a: DIRECTION_DELTAS.left,
  d: DIRECTION_DELTAS.right,
};

/** `true` for a key that moves the cursor or the menu focus. */
const DIRECTION_KEYS: Readonly<Record<string, Direction>> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  w: "up",
  s: "down",
  a: "left",
  d: "right",
};

const CONFIRM_KEYS = new Set(["Enter", " ", "Spacebar"]);
const CANCEL_KEYS = new Set(["Escape", "Esc"]);
const ORDERS_KEYS = new Set(["o", "O"]);
const MENU_KEYS = new Set(["m", "M"]);

/** The direction a key requests, case-insensitively, or `null`. */
export function directionForKey(key: string): Direction | null {
  return DIRECTION_KEYS[key] ?? DIRECTION_KEYS[key.toLowerCase()] ?? null;
}

/** Whether a navigation key is handled (used to decide `preventDefault`). */
export function isNavigationKey(key: string): boolean {
  return directionForKey(key) !== null;
}

/** Whether a confirm key is handled. */
export function isConfirmKey(key: string): boolean {
  return CONFIRM_KEYS.has(key);
}

/** Whether a cancel key is handled. */
export function isCancelKey(key: string): boolean {
  return CANCEL_KEYS.has(key);
}

/* --------------------------------------------------------------------------
 * Pure intents
 * ------------------------------------------------------------------------ */

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
 * Whether the acting soldier is selected with its cursor on its own tile and an
 * Orders menu to open. Confirming then should browse orders instead of being a
 * no-op.
 */
export function ordersAwait(controller: BattleController, at: Coord | null): boolean {
  if (at === null) return false;
  if (controller.phase !== "command" || controller.selectedUnitId === null) return false;
  if (controller.actions.length === 0) return false;
  const actor = selectedActor(controller);
  return actor !== undefined && coordEquals(at, actor.at);
}

/**
 * Apply a keyboard intent. Navigation keys move the cursor, confirm keys act on
 * it and cancel keys back out; anything else is ignored (so typing in a future
 * input field is unaffected).
 */
export function pressKey(controller: BattleController, key: string): BattleController {
  const direction = directionForKey(key);
  if (direction !== null) return moveCursor(controller, DIRECTION_DELTAS[direction]);
  if (CONFIRM_KEYS.has(key)) return activateCursor(controller);
  if (CANCEL_KEYS.has(key)) return cancel(controller);
  return controller;
}

/* --------------------------------------------------------------------------
 * Menu focus navigation (pure geometry + thin DOM glue)
 * ------------------------------------------------------------------------ */

/** A screen-space rectangle, matching `DOMRect`'s useful edges. */
export interface FocusRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * The index of the next focusable rectangle in `direction` from `current`,
 * using nearest-centre scoring with a strong cross-axis penalty so a grid
 * moves row/column-wise rather than diagonally. Returns `-1` when nothing lies
 * that way; `current < 0` starts at the first element.
 *
 * Pure and DOM-free so the menu navigation can be unit-tested in Node.
 */
export function nextFocusIndex(
  rects: readonly FocusRect[],
  current: number,
  direction: Direction,
): number {
  if (rects.length === 0) return -1;
  if (current < 0 || current >= rects.length) return 0;

  const origin = rects[current];
  const ox = (origin.left + origin.right) / 2;
  const oy = (origin.top + origin.bottom) / 2;
  let best = -1;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let index = 0; index < rects.length; index++) {
    if (index === current) continue;
    const rect = rects[index];
    const cx = (rect.left + rect.right) / 2;
    const cy = (rect.top + rect.bottom) / 2;
    const dx = cx - ox;
    const dy = cy - oy;

    let primary: number;
    let secondary: number;
    switch (direction) {
      case "right":
        if (dx <= 0) continue;
        primary = dx;
        secondary = Math.abs(dy);
        break;
      case "left":
        if (dx >= 0) continue;
        primary = -dx;
        secondary = Math.abs(dy);
        break;
      case "down":
        if (dy <= 0) continue;
        primary = dy;
        secondary = Math.abs(dx);
        break;
      case "up":
        if (dy >= 0) continue;
        primary = -dy;
        secondary = Math.abs(dx);
        break;
    }

    const score = primary + secondary * 4;
    if (score < bestScore) {
      bestScore = score;
      best = index;
    }
  }

  return best;
}

/** Selector for elements the focus navigator will land on. */
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Whether an element is a text field that must keep its own key handling. */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
}

/** Every visible, enabled focus target under `root`, in DOM order. */
export function focusableElements(root: ParentNode): HTMLElement[] {
  const nodes = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  return nodes.filter((element) => {
    if (element.getAttribute("aria-hidden") === "true") return false;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const style = window.getComputedStyle(element);
    return style.visibility !== "hidden" && style.display !== "none";
  });
}

/** The currently focused element, unless it is the document body. */
function currentControl(): HTMLElement | null {
  const active = document.activeElement;
  if (active === null || active === document.body) return null;
  return active instanceof HTMLElement ? active : null;
}

/** Move focus to the nearest control in `direction`. */
export function focusDirection(direction: Direction): boolean {
  const elements = focusableElements(document);
  if (elements.length === 0) return false;
  const active = currentControl();
  const current = active === null ? -1 : elements.indexOf(active);
  const next = nextFocusIndex(
    elements.map((element) => element.getBoundingClientRect()),
    current,
    direction,
  );
  if (next < 0) return false;
  elements[next].focus();
  return true;
}

/** Focus the first focus target on the current screen. */
export function focusFirst(): boolean {
  const [first] = focusableElements(document);
  if (first === undefined) return false;
  first.focus();
  return true;
}

/** Activate the focused control, or focus the first one when none is focused. */
export function activateFocused(): boolean {
  const active = currentControl();
  if (active !== null && !isTextEntry(active)) {
    active.click();
    return true;
  }
  return focusFirst();
}

/** Drop focus back to the document (leaving the menu layer for the grid). */
export function blurFocused(): boolean {
  const active = currentControl();
  if (active === null) return false;
  active.blur();
  return true;
}

/** Focus the first affordable Orders button, if the Orders menu is showing. */
export function focusOrdersMenu(): boolean {
  const button = document.querySelector<HTMLElement>(".action-menu__button:not(:disabled)");
  if (button === null) return false;
  button.focus();
  return true;
}

/**
 * Whether a key should be treated as menu navigation rather than battlefield
 * navigation: the camp is open, or a control inside the battlefield stage
 * (the Orders menu, a Tempo card) holds focus. The view-nav buttons live
 * outside the stage, so switching to the Field leaves the grid in control.
 */
export function isMenuMode(view: string): boolean {
  if (view !== "battle") return true;
  const active = currentControl();
  if (active === null) return false;
  const stage = document.querySelector(".stage");
  return stage !== null && stage.contains(active);
}

/* --------------------------------------------------------------------------
 * Gamepad mapping
 * ------------------------------------------------------------------------ */

/** Standard-mapping button indices (W3C Gamepad API). */
export const GAMEPAD_BUTTONS = {
  confirm: 0,
  cancel: 1,
  orders: 2,
  view: 8,
  menu: 9,
  dpadUp: 12,
  dpadDown: 13,
  dpadLeft: 14,
  dpadRight: 15,
} as const;

/** A button as read from `Gamepad.buttons` (pressed flag or analog value). */
export interface GamepadButtonLike {
  readonly pressed?: boolean;
  readonly value?: number;
}

/** The parts of a `Gamepad` the mapper reads; also handy for tests. */
export interface GamepadSnapshot {
  readonly buttons: readonly GamepadButtonLike[];
  readonly axes?: readonly number[];
}

/** One normalised gamepad frame, before edge detection. */
export interface GamepadFrame {
  readonly direction: Direction | null;
  readonly confirm: boolean;
  readonly cancel: boolean;
  readonly orders: boolean;
  readonly menu: boolean;
}

/** A neutral frame (no stick, no buttons) — also useful as a test fixture. */
export const EMPTY_GAMEPAD_FRAME: GamepadFrame = {
  direction: null,
  confirm: false,
  cancel: false,
  orders: false,
  menu: false,
};

/** Left-stick travel beyond which a direction registers. */
const STICK_THRESHOLD = 0.5;

/** Whether button `index` counts as pressed (digital or analog). */
function buttonPressed(buttons: readonly GamepadButtonLike[], index: number): boolean {
  const button = buttons[index];
  if (button === undefined) return false;
  return button.pressed === true || (button.value ?? 0) > 0.5;
}

/**
 * Normalise a gamepad snapshot into a {@link GamepadFrame}: a single dominant
 * direction from the D-pad or left stick, plus the action buttons. Pure so it
 * is unit-tested with a plain object.
 */
export function readGamepad(snapshot: GamepadSnapshot): GamepadFrame {
  const buttons = snapshot.buttons;
  const axes = snapshot.axes ?? [];
  const x = axes[0] ?? 0;
  const y = axes[1] ?? 0;

  let direction: Direction | null = null;
  if (buttonPressed(buttons, GAMEPAD_BUTTONS.dpadUp) || y < -STICK_THRESHOLD) direction = "up";
  else if (buttonPressed(buttons, GAMEPAD_BUTTONS.dpadDown) || y > STICK_THRESHOLD)
    direction = "down";
  else if (buttonPressed(buttons, GAMEPAD_BUTTONS.dpadLeft) || x < -STICK_THRESHOLD)
    direction = "left";
  else if (buttonPressed(buttons, GAMEPAD_BUTTONS.dpadRight) || x > STICK_THRESHOLD)
    direction = "right";

  return {
    direction,
    confirm: buttonPressed(buttons, GAMEPAD_BUTTONS.confirm),
    cancel: buttonPressed(buttons, GAMEPAD_BUTTONS.cancel),
    orders: buttonPressed(buttons, GAMEPAD_BUTTONS.orders),
    menu:
      buttonPressed(buttons, GAMEPAD_BUTTONS.menu) || buttonPressed(buttons, GAMEPAD_BUTTONS.view),
  };
}

/** Tunables for held-button auto-repeat. */
export interface GamepadEdgeOptions {
  /** Delay (ms) a direction is held before it starts repeating. */
  readonly initialDelayMs?: number;
  /** Interval (ms) between repeats once repeating. */
  readonly repeatMs?: number;
}

/** The one-shot intents produced by a gamepad frame. */
export interface GamepadIntents {
  readonly direction: Direction | null;
  readonly confirm: boolean;
  readonly cancel: boolean;
  readonly orders: boolean;
  readonly menu: boolean;
}

/** A stateful edge detector: rising edges fire once, held directions repeat. */
export interface GamepadEdge {
  /** Fold `frame` at time `now` (ms) into the intents to dispatch. */
  update(frame: GamepadFrame, now: number): GamepadIntents;
}

/**
 * Build an edge detector with auto-repeat for directions. Buttons fire on the
 * rising edge only; a direction fires immediately, then again after
 * `initialDelayMs`, then every `repeatMs` while held. `now` is injected so the
 * behaviour is testable without a clock.
 */
export function createGamepadEdge(options: GamepadEdgeOptions = {}): GamepadEdge {
  const initialDelay = options.initialDelayMs ?? 320;
  const repeat = options.repeatMs ?? 120;
  let previous: GamepadFrame = EMPTY_GAMEPAD_FRAME;
  let held: Direction | null = null;
  let heldSince = 0;
  let lastRepeat = 0;

  return {
    update(frame: GamepadFrame, now: number): GamepadIntents {
      const intents: {
        direction: Direction | null;
        confirm: boolean;
        cancel: boolean;
        orders: boolean;
        menu: boolean;
      } = { direction: null, confirm: false, cancel: false, orders: false, menu: false };

      if (frame.confirm && !previous.confirm) intents.confirm = true;
      if (frame.cancel && !previous.cancel) intents.cancel = true;
      if (frame.orders && !previous.orders) intents.orders = true;
      if (frame.menu && !previous.menu) intents.menu = true;

      if (frame.direction !== null) {
        if (frame.direction !== held) {
          held = frame.direction;
          heldSince = now;
          lastRepeat = now;
          intents.direction = frame.direction;
        } else if (now - heldSince >= initialDelay && now - lastRepeat >= repeat) {
          lastRepeat = now;
          intents.direction = frame.direction;
        }
      } else {
        held = null;
      }

      previous = frame;
      return intents;
    },
  };
}

/** Read the first connected gamepad, or `null` when none is present. */
export function firstConnectedGamepad(
  gamepads: readonly (Gamepad | null | undefined)[],
): Gamepad | null {
  for (const gamepad of gamepads) {
    if (gamepad !== null && gamepad !== undefined && gamepad.connected !== false) return gamepad;
  }
  return null;
}

/* --------------------------------------------------------------------------
 * DOM binding
 * ------------------------------------------------------------------------ */

/** Which navigation layer a view uses. */
export type InputView = "battle" | "menu";

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
  /** Reads the active view ("menu" for camp screens). Defaults to `"battle"`. */
  readonly getView?: () => InputView;
  /** Leaves the camp for the field (Escape / gamepad B in a menu). */
  readonly onBack?: () => void;
  /** Toggles the camp menu (M / gamepad Start). */
  readonly onOpenMenu?: () => void;
  /** Reads connected gamepads. Defaults to `navigator.getGamepads`. */
  readonly getGamepads?: () => readonly (Gamepad | null | undefined)[];
}

/** A live input binding. Call {@link InputController.dispose} on unmount. */
export interface InputController {
  /** Remove every listener. Idempotent. */
  dispose(): void;
}

/** Pointer travel (px) above which a press is treated as a camera drag, not a click. */
const CLICK_SLOP = 6;

/**
 * Bind pointer, touch, keyboard and gamepad input and drive the controller.
 * Listeners are removed by the returned {@link InputController}.
 */
export function createInputController(options: InputControllerOptions): InputController {
  const {
    canvas,
    getCamera,
    getController,
    onControllerChange,
    getView = () => "battle",
    onBack,
    onOpenMenu,
    getGamepads = () =>
      typeof navigator !== "undefined" && typeof navigator.getGamepads === "function"
        ? navigator.getGamepads()
        : [],
  } = options;

  /* ---- pointer ---------------------------------------------------------- */

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

  /* ---- shared intents --------------------------------------------------- */

  const menuMode = (): boolean => isMenuMode(getView());

  const handleDirection = (direction: Direction): void => {
    if (menuMode()) {
      focusDirection(direction);
      return;
    }
    onControllerChange(moveCursor(getController(), DIRECTION_DELTAS[direction]));
  };

  const handleConfirm = (): void => {
    if (menuMode()) {
      activateFocused();
      return;
    }
    const controller = getController();
    if (ordersAwait(controller, controller.cursor) && focusOrdersMenu()) return;
    onControllerChange(activateCursor(controller));
  };

  const handleCancel = (): void => {
    if (getView() !== "battle") {
      onBack?.();
      return;
    }
    if (blurFocused()) return;
    onControllerChange(cancel(getController()));
  };

  const handleOrders = (): void => {
    if (getView() !== "battle") return;
    focusOrdersMenu();
  };

  const handleMenu = (): void => {
    onOpenMenu?.();
  };

  /* ---- keyboard --------------------------------------------------------- */

  const onKeyDown = (event: KeyboardEvent): void => {
    if (isTextEntry(event.target)) return;
    const key = event.key;

    const direction = directionForKey(key);
    if (direction !== null) {
      event.preventDefault();
      handleDirection(direction);
      return;
    }

    if (CONFIRM_KEYS.has(key)) {
      const target = event.target;
      // A focused link (e.g. T109's skip link) keeps the browser's native
      // activation, wherever it sits; so does a focused control in a menu.
      const isLink = target instanceof HTMLElement && target.matches("a[href]");
      if (
        isLink ||
        (menuMode() &&
          currentControl() !== null &&
          target instanceof HTMLElement &&
          target.matches(FOCUSABLE_SELECTOR))
      ) {
        return;
      }
      event.preventDefault();
      handleConfirm();
      return;
    }

    if (CANCEL_KEYS.has(key)) {
      event.preventDefault();
      handleCancel();
      return;
    }

    if (ORDERS_KEYS.has(key)) {
      event.preventDefault();
      handleOrders();
      return;
    }

    if (MENU_KEYS.has(key)) {
      event.preventDefault();
      handleMenu();
    }
  };

  /* ---- gamepad ---------------------------------------------------------- */

  const edge = createGamepadEdge();
  let rafId = 0;

  const pollGamepad = (now: number): void => {
    rafId = requestAnimationFrame(pollGamepad);
    const gamepad = firstConnectedGamepad(getGamepads());
    const frame =
      gamepad === null
        ? EMPTY_GAMEPAD_FRAME
        : readGamepad({ buttons: gamepad.buttons, axes: gamepad.axes });
    const intents = edge.update(frame, now);
    if (intents.direction !== null) handleDirection(intents.direction);
    if (intents.orders) handleOrders();
    if (intents.menu) handleMenu();
    if (intents.cancel) handleCancel();
    if (intents.confirm) handleConfirm();
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerCancel);
  window.addEventListener("keydown", onKeyDown);
  if (typeof requestAnimationFrame === "function") rafId = requestAnimationFrame(pollGamepad);

  return {
    dispose(): void {
      canvas.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("keydown", onKeyDown);
      if (rafId !== 0) cancelAnimationFrame(rafId);
    },
  };
}
