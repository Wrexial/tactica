/**
 * Battle commands (T020) — the **only** way to mutate a battle.
 *
 * Every order a player or the AI issues is a plain, discriminated-union
 * {@link Command} value (see `agents.md` §7). `step(state, command)` consumes
 * them; nothing else writes to the world. Keeping commands as data buys three
 * things the engine is built around (`agents.md` §2):
 *
 * - **Determinism** — a battle is fully described by a seed plus an *ordered
 *   command log*, so replays and future lockstep netcode (T112) need no extra
 *   machinery.
 * - **Rejectability** — a malformed command can be detected before it touches
 *   state ({@link isCommand} / {@link parseCommand}), and a command the rules
 *   consider illegal is refused without mutation (T022).
 * - **Serialisability** — commands are JSON-safe by construction: branded
 *   string ids, plain {@link Coord}s and primitives only. {@link serializeCommand}
 *   and {@link deserializeCommand} make that contract explicit at the boundary.
 *
 * Contract:
 * - Pure and framework-free: no DOM, no I/O, no `Math.random`, no `Date`.
 * - Commands never carry engine state (units, grids, RNG); they only name the
 *   actor, the intent and the raw parameters. All validation that needs the
 *   world (is the tile reachable? does the unit have the ability?) belongs to
 *   the battle layer (T022, T024).
 * - Mechanical keys stay FFTA-shaped (`abilityId`, `judgePoints` on the unit);
 *   display fiction lives in `src/data/`, never here.
 *
 * The set below mirrors the FFTA commands the retheme keeps (mapping §12):
 * {@link MoveCommand} (Move), {@link ActCommand} (A-Ability), {@link WaitCommand}
 * (Wait), {@link FaceCommand} (change facing), {@link HoldCommand} (brace),
 * {@link VolleyCommand} (Combo → Volley, T061) and {@link GuardSortieCommand}
 * (Totema → Guard Sortie, T062). An {@link ActCommand} may fold the turn's free
 * Move into itself via an optional {@link ActMoveClause} (T124), so one command
 * can carry a complete move-and-act turn.
 */

import { isFacing, type Coord, type Facing } from "./grid";
import { isValidId, type AbilityId, type GuardSortieId, type UnitId } from "./ids";

/* --------------------------------------------------------------------------
 * Targeting
 * ------------------------------------------------------------------------ */

/** The three ways a command can name what it acts upon. */
export const TARGET_KINDS = ["self", "tile", "unit"] as const;
export type TargetKind = (typeof TARGET_KINDS)[number];

/**
 * What an action points at. A discriminated union (rather than a bare coord) so
 * a self-buff and a ground-targeted shell are distinguishable without extra
 * flags, and so an ability that must resolve a unit can carry its identity:
 *
 * - `"self"` — resolves to the acting unit's own tile (Self-target actions).
 * - `"tile"` — a ground square, for area effects and lobbed fire.
 * - `"unit"` — a specific soldier, for single-target aid or attack.
 *
 * `"self"` is deliberately not the same as `{ kind: "tile", at: actor.at }`:
 * the battle layer resolves it lazily, so a self command stays valid even if
 * the actor was shoved between declaration and resolution.
 */
export type Target =
  | { readonly kind: "self" }
  | { readonly kind: "tile"; readonly at: Coord }
  | { readonly kind: "unit"; readonly unitId: UnitId };

/** The actor's own tile (Self-target action). */
export function selfTarget(): Target {
  return { kind: "self" };
}

/** A ground tile (area effects, lobbed fire). The coordinate is copied. */
export function tileTarget(at: Coord): Target {
  return { kind: "tile", at: { x: at.x, y: at.y } };
}

/** A named soldier (single-target aid or attack). */
export function unitTarget(unitId: UnitId): Target {
  return { kind: "unit", unitId };
}

/* --------------------------------------------------------------------------
 * Folded move clause (T124)
 * ------------------------------------------------------------------------ */

/**
 * When a folded `act`'s march happens relative to the action it carries.
 *
 * - `"before"` — the soldier marches to {@link ActMoveClause.to} first, then the
 *   action resolves **from the destination** (close and strike).
 * - `"after"` — the action resolves from the soldier's **origin** tile first,
 *   then the soldier marches (hit and retreat).
 *
 * There is deliberately no default: the two orders resolve the action from
 * different tiles, so a missing value is a malformed command rather than a
 * silently chosen one (peer lesson L3).
 */
export const ACT_MOVE_ORDERS = ["before", "after"] as const;
export type ActMoveOrder = (typeof ACT_MOVE_ORDERS)[number];

/** Runtime guard for the folded move order (trust boundaries). */
export function isActMoveOrder(value: unknown): value is ActMoveOrder {
  return typeof value === "string" && (ACT_MOVE_ORDERS as readonly string[]).includes(value);
}

/**
 * An optional march folded into an {@link ActCommand}, so a full FFTA
 * move-and-act turn is one atomically validated, replayable command instead of
 * a half-open `move` plus a second command (peer lesson L3, T124). The move is
 * priced and validated by the same rules gate a standalone `move` uses; the
 * clause only names the destination tile and the phase order.
 */
export interface ActMoveClause {
  /** Destination tile the soldier marches to (the path is derived by the battle layer). */
  readonly to: Coord;
  /** Whether the march runs **before** or **after** the action. Required. */
  readonly order: ActMoveOrder;
}

/* --------------------------------------------------------------------------
 * Commands
 * ------------------------------------------------------------------------ */

/** Every command kind the engine understands. */
export const COMMAND_KINDS = [
  "move",
  "act",
  "wait",
  "face",
  "hold",
  "volley",
  "guardSortie",
] as const;
export type CommandKind = (typeof COMMAND_KINDS)[number];

/** Runtime guard for untrusted command-kind strings (replays, network). */
export function isCommandKind(value: unknown): value is CommandKind {
  return typeof value === "string" && (COMMAND_KINDS as readonly string[]).includes(value);
}

/**
 * Fields every command shares. All commands name their actor with a branded
 * {@link UnitId}; the battle layer looks up the unit and validates that it is
 * the one whose Orders Tempo turn it currently is.
 */
export interface CommandBase {
  /** The soldier being ordered. */
  readonly unitId: UnitId;
}

/**
 * Move along a path (FFTA "Move", mapping §12). `path` is the sequence of tiles
 * the soldier steps through; the pathfinder (T015) returns it starting at the
 * origin and ending at the destination, and the battle layer re-validates it
 * against terrain, Climb and occupied tiles before applying it.
 */
export interface MoveCommand extends CommandBase {
  readonly kind: "move";
  /** Tiles to traverse, origin first when produced by `findPath`. */
  readonly path: readonly Coord[];
}

/**
 * Use an active ability (FFTA A-Ability → Action, mapping §6). The battle
 * layer checks Élan cost, charge time, range/LoS and Article legality (T024+).
 *
 * A turn may fold its free **Move** into the action via {@link move} (T124): the
 * battle layer derives and validates the path with the same gate a standalone
 * `move` command uses, then settles Orders Tempo exactly once. Omitting the
 * clause keeps the original action-only command (and the two-step UI).
 */
export interface ActCommand extends CommandBase {
  readonly kind: "act";
  /** The action/reaction/volley ability being invoked. */
  readonly abilityId: AbilityId;
  /** Who or what the ability is aimed at. */
  readonly target: Target;
  /** Optional free march folded into this turn (T124). */
  readonly move?: ActMoveClause;
}

/**
 * End the soldier's turn without acting (FFTA "Wait"). Still advances Orders
 * Tempo, so it is a real choice under pressure.
 */
export interface WaitCommand extends CommandBase {
  readonly kind: "wait";
}

/**
 * Turn in place to a new cardinal direction (mapping §12 facing). Used to set up
 * a firing line, protect a flank, or deny a rear bonus.
 */
export interface FaceCommand extends CommandBase {
  readonly kind: "face";
  /** The direction to face. */
  readonly facing: Facing;
}

/**
 * Hold / brace in place (T026), the defensive counterpart to attacking. The
 * condition engine (T039) turns this into Formed / Entrenched as the rules
 * dictate; the command only declares the intent.
 */
export interface HoldCommand extends CommandBase {
  readonly kind: "hold";
}

/**
 * Initiate a **Volley** (FFTA Combo → Volley, mapping §6, T061). Adjacent allies
 * chain in and damage scales with the Honour (FFTA JP) committed, so the amount
 * is part of the command and the battle layer verifies the actor can afford it.
 */
export interface VolleyCommand extends CommandBase {
  readonly kind: "volley";
  /** The volley ability being initiated. */
  readonly abilityId: AbilityId;
  /** The tile or soldier the volley is directed at. */
  readonly target: Target;
  /** Honour committed to the volley; scales its damage (T061). Never negative. */
  readonly honour: number;
}

/**
 * Call a national **Guard Sortie** (FFTA Totema, mapping §4, T062). Costs a
 * fixed 10 Honour, hits the whole field and must be unlocked, all of which the
 * battle layer enforces — the command only names the guard formation.
 */
export interface GuardSortieCommand extends CommandBase {
  readonly kind: "guardSortie";
  /** The power's guard formation to call on. */
  readonly guardSortieId: GuardSortieId;
}

/**
 * The complete command union. Narrow on `kind` to get the payload; because the
 * shapes are disjoint, exhaustiveness checking (`switch` + `never`) works and
 * adding a kind is a compile error everywhere it must be handled.
 */
export type Command =
  | MoveCommand
  | ActCommand
  | WaitCommand
  | FaceCommand
  | HoldCommand
  | VolleyCommand
  | GuardSortieCommand;

/** Every command names its actor; this reads it without narrowing. */
export function commandUnitId(command: Command): UnitId {
  return command.unitId;
}

/* --------------------------------------------------------------------------
 * Runtime validation (replays, network, save files)
 * ------------------------------------------------------------------------ */

/** Error thrown when a value is not a well-formed command. */
export class CommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommandError";
  }
}

/** Narrow an unknown value to a plain object bag for field inspection. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Integers only: coordinates and amounts are exact, never fractional. */
function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

/** A plain, JSON-safe tile position. */
function isCoord(value: unknown): value is Coord {
  return isRecord(value) && isInteger(value.x) && isInteger(value.y);
}

/** Whether `value` is one of the {@link Target} shapes. */
export function isTarget(value: unknown): value is Target {
  if (!isRecord(value)) return false;
  switch (value.kind) {
    case "self":
      return true;
    case "tile":
      return isCoord(value.at);
    case "unit":
      return isValidId(value.unitId);
    default:
      return false;
  }
}

/**
 * Whether `value` is a well-formed folded move clause (shape only). `order` is
 * required, so a clause that omits it is rejected rather than defaulted.
 */
export function isActMoveClause(value: unknown): value is ActMoveClause {
  return isRecord(value) && isCoord(value.to) && isActMoveOrder(value.order);
}

/**
 * Whether `value` is a structurally valid {@link Command}.
 *
 * This checks **shape only** — kinds, id types, coordinate integrality. It
 * cannot know whether the move is legal, the ability affordable, or the Article
 * unbroken; that is the battle layer's job (T022). Use it at trust boundaries
 * (replay logs, network messages, test fixtures) before handing a value to
 * `step`.
 */
export function isCommand(value: unknown): value is Command {
  if (!isRecord(value) || !isValidId(value.unitId) || !isCommandKind(value.kind)) {
    return false;
  }
  switch (value.kind) {
    case "move":
      return Array.isArray(value.path) && value.path.every(isCoord);
    case "act":
      return (
        isValidId(value.abilityId) &&
        isTarget(value.target) &&
        (value.move === undefined || isActMoveClause(value.move))
      );
    case "wait":
    case "hold":
      return true;
    case "face":
      return isFacing(value.facing);
    case "volley":
      return (
        isValidId(value.abilityId) &&
        isTarget(value.target) &&
        isInteger(value.honour) &&
        value.honour >= 0
      );
    case "guardSortie":
      return isValidId(value.guardSortieId);
  }
}

/** Compact, human-readable description of a rejected value for error messages. */
function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return typeof value;
}

/** Deep-copy a positive target, dropping any foreign fields. */
function copyTarget(target: Target): Target {
  switch (target.kind) {
    case "self":
      return { kind: "self" };
    case "tile":
      return { kind: "tile", at: { x: target.at.x, y: target.at.y } };
    case "unit":
      return { kind: "unit", unitId: target.unitId };
  }
}

/** Deep-copy a validated command so callers cannot alias its nested values. */
function copyCommand(command: Command): Command {
  switch (command.kind) {
    case "move":
      return { kind: "move", unitId: command.unitId, path: command.path.map((at) => ({ ...at })) };
    case "act":
      return {
        kind: "act",
        unitId: command.unitId,
        abilityId: command.abilityId,
        target: copyTarget(command.target),
        ...(command.move === undefined
          ? {}
          : {
              move: {
                to: { x: command.move.to.x, y: command.move.to.y },
                order: command.move.order,
              },
            }),
      };
    case "wait":
      return { kind: "wait", unitId: command.unitId };
    case "face":
      return { kind: "face", unitId: command.unitId, facing: command.facing };
    case "hold":
      return { kind: "hold", unitId: command.unitId };
    case "volley":
      return {
        kind: "volley",
        unitId: command.unitId,
        abilityId: command.abilityId,
        target: copyTarget(command.target),
        honour: command.honour,
      };
    case "guardSortie":
      return { kind: "guardSortie", unitId: command.unitId, guardSortieId: command.guardSortieId };
  }
}

/**
 * Validate untrusted input and return it as a normalised, freshly cloned
 * {@link Command}. Throws {@link CommandError} on anything malformed, so a bad
 * replay or packet fails at the boundary instead of corrupting a battle.
 *
 * ```ts
 * const command = parseCommand(JSON.parse(line), "replay[3]");
 * ```
 */
export function parseCommand(value: unknown, label = "command"): Command {
  if (!isCommand(value)) {
    throw new CommandError(`${label} is not a valid battle command (received ${describe(value)})`);
  }
  return copyCommand(value);
}

/* --------------------------------------------------------------------------
 * Serialisation
 * ------------------------------------------------------------------------ */

/**
 * Serialise a command to JSON. Commands are plain data, so this is a thin,
 * named wrapper over `JSON.stringify` that documents the engine's contract: a
 * command log is text and can be stored, diffed and replayed.
 */
export function serializeCommand(command: Command): string {
  return JSON.stringify(command);
}

/** Parse and validate a command from JSON, throwing {@link CommandError} on bad input. */
export function deserializeCommand(json: string): Command {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new CommandError("command JSON could not be parsed");
  }
  return parseCommand(parsed);
}
