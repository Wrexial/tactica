/**
 * Battle-state serialisation and hashing (T023).
 *
 * A battle is a plain, JSON-safe value (`agents.md` §7), so the whole world can
 * be written to text, compared and resumed. This module owns the three things
 * the rest of the engine needs from that fact:
 *
 * 1. **Canonical serialisation** — {@link serializeBattleState} writes a battle
 *    to a *canonical* string: object keys are sorted, so two states that differ
 *    only in property order produce byte-identical text.
 * 2. **Hashing** — {@link hashBattleState} reduces a battle to a short,
 *    stable hex digest. This is the desync detector future lockstep netcode
 *    (T112) and the save system (T100/T101) lean on.
 * 3. **Replay** — {@link replayBattle} runs an authored seed plus an ordered
 *    command log through the deterministic {@link step} loop, so a battle is
 *    fully described by `seed + setup + commands` (mapping §12, D15).
 *
 * Contract (agents.md §2, §7, §9):
 * - Pure, framework-free, deterministic: no DOM, no I/O, no `Math.random`, no
 *   `Date`. The hash depends only on the value handed in.
 * - Serialisation is **canonical**, not merely "some JSON": the digest of a
 *   state is a function of the state's *content*, never of key insertion order.
 * - Deserialisation is a *trust boundary*. {@link deserializeBattleState}
 *   validates the full structure (and re-runs `createUnit` for every soldier)
 *   before returning a value, so a corrupt save or a hostile packet fails
 *   loudly instead of poisoning a battle.
 *
 * Reference: `docs/wiki/pages/Battle_system.md` for the state the engine must
 * carry; the fiction follows `docs/NAPOLEONIC_MAPPING.md` (Élan = MP,
 * Honour = JP, Articles of War = laws).
 */

import {
  BATTLE_PHASES,
  createBattle,
  step,
  type BattleRejection,
  type BattleSetup,
  type BattleState,
} from "./battle";
import type { ActionCatalogue, ActionSpec, PendingAction } from "./actions/resolve";
import { parseCommand, serializeCommand, type Command } from "./commands";
import { BATTLE_OUTCOMES } from "./events";
import { coordKey, inBounds, isFacing, type Coord, type Grid } from "./grid";
import { isValidId, type EquipmentId } from "./ids";
import {
  copyObjective,
  isObjectiveTracker,
  type ObjectiveTracker,
} from "./objectives";
import type { RngState, Seed } from "./rng";
import {
  MAX_HEIGHT,
  MIN_HEIGHT,
  isTerrainType,
  type TerrainMap,
  type TerrainTile,
} from "./terrain";
import type { OrdersTempo, TempoCharge, TempoEntry } from "./turn";
import {
  HONOUR_MAX,
  createUnit,
  isPowerKey,
  isUnitSide,
  type ActiveCondition,
  type EquipmentLoadout,
  type LearnedAbility,
  type Unit,
} from "./unit";
import { EQUIP_SLOTS, type StatBlock } from "../data/schema";

/* --------------------------------------------------------------------------
 * Errors
 * ------------------------------------------------------------------------ */

/** Thrown when a value cannot be serialised or is not a valid battle state. */
export class BattleSerializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BattleSerializationError";
  }
}

/**
 * Thrown by {@link replayBattle} when a command in the log is refused by the
 * rules. A valid replay log should never contain a rejected command; when one
 * appears the log and the seed/state have diverged, so we fail loudly rather
 * than silently skip it.
 */
export class BattleReplayError extends Error {
  /** Position of the offending command in the log. */
  readonly commandIndex: number;
  /** Why the engine refused it; see {@link BattleRejection}. */
  readonly rejection: BattleRejection;

  constructor(message: string, commandIndex: number, rejection: BattleRejection) {
    super(message);
    this.name = "BattleReplayError";
    this.commandIndex = commandIndex;
    this.rejection = rejection;
  }
}

/* --------------------------------------------------------------------------
 * Canonical serialisation
 * ------------------------------------------------------------------------ */

/**
 * Serialise any JSON-compatible value to a **canonical** string: object keys
 * are emitted in sorted order and `undefined` object properties are omitted
 * (matching `JSON.stringify`). Two values that are deeply equal therefore
 * always produce the same text, regardless of how they were built.
 *
 * Non-finite numbers, functions and cyclic structures throw a
 * {@link BattleSerializationError}; everything the engine holds is finite
 * integers, strings, booleans, `null`, plain objects and arrays.
 *
 * ```ts
 * canonicalStringify({ b: 2, a: 1 }) === '{"a":1,"b":2}';
 * ```
 */
export function canonicalStringify(value: unknown): string {
  return writeCanonical(value, new WeakSet<object>());
}

function writeCanonical(value: unknown, seen: WeakSet<object>): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) {
        throw new BattleSerializationError(`cannot serialise non-finite number: ${String(value)}`);
      }
      // `JSON.stringify` renders -0 as "0" and every finite number canonically.
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "object": {
      if (seen.has(value)) {
        throw new BattleSerializationError("cannot serialise a cyclic value");
      }
      seen.add(value);
      let out: string;
      if (Array.isArray(value)) {
        out = `[${value.map((item) => writeCanonical(item, seen)).join(",")}]`;
      } else {
        const record = value as Record<string, unknown>;
        const parts: string[] = [];
        for (const key of Object.keys(record).sort()) {
          const item = record[key];
          // Mirror JSON.stringify: undefined properties simply disappear.
          if (item === undefined) continue;
          parts.push(`${JSON.stringify(key)}:${writeCanonical(item, seen)}`);
        }
        out = `{${parts.join(",")}}`;
      }
      seen.delete(value);
      return out;
    }
    default:
      throw new BattleSerializationError(`cannot serialise a value of type ${typeof value}`);
  }
}

/* --------------------------------------------------------------------------
 * Hashing
 * ------------------------------------------------------------------------ */

/** 64-bit FNV-1a offset basis. */
const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
/** 64-bit FNV-1a prime. */
const FNV_PRIME = 0x100000001b3n;
/** Mask keeping a BigInt inside 64 bits. */
const UINT64_MASK = 0xffffffffffffffffn;

/**
 * FNV-1a 64-bit over the UTF-16 code units of `input`. Integer-only (BigInt),
 * so the digest is identical on every platform and does not depend on
 * floating-point rounding. Kept private so the hashing scheme can change
 * without breaking callers — they use {@link hashString}.
 */
function fnv1a64(input: string): bigint {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * FNV_PRIME) & UINT64_MASK;
  }
  return hash;
}

/**
 * A stable 16-character hex digest of a string. FNV-1a is not cryptographic;
 * it is a fast fingerprint for replay/desync detection, which is exactly what
 * the engine needs.
 */
export function hashString(input: string): string {
  return fnv1a64(input).toString(16).padStart(16, "0");
}

/** Canonical digest of any JSON-compatible value. See {@link canonicalStringify}. */
export function hashValue(value: unknown): string {
  return hashString(canonicalStringify(value));
}

/* --------------------------------------------------------------------------
 * Battle state serialisation
 * ------------------------------------------------------------------------ */

/**
 * Serialise a battle to canonical JSON. The result is stable: serialising the
 * same state twice (or an equal state rebuilt with a different key order)
 * yields the same string.
 */
export function serializeBattleState(state: BattleState): string {
  return canonicalStringify(state);
}

/**
 * Fingerprint a battle. Two deterministic runs of the same `seed + setup +
 * commands` must produce the same digest; a differing digest means the two
 * simulations have desynced (mapping D15, T112).
 */
export function hashBattleState(state: BattleState): string {
  return hashValue(state);
}

/* --------------------------------------------------------------------------
 * Runtime validation (trust boundary)
 * ------------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return isInteger(value) && value >= 0;
}

function isUint32(value: unknown): value is number {
  return isInteger(value) && value >= 0 && value < 2 ** 32;
}

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function isSeed(value: unknown): value is Seed {
  return typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
}

function isCoord(value: unknown): value is Coord {
  return isRecord(value) && isInteger(value.x) && isInteger(value.y);
}

function isGrid(value: unknown): value is Grid {
  return (
    isRecord(value) &&
    Number.isInteger(value.width) &&
    (value.width as number) > 0 &&
    Number.isInteger(value.height) &&
    (value.height as number) > 0
  );
}

function isTerrainTile(value: unknown): value is TerrainTile {
  return (
    isRecord(value) &&
    isTerrainType(value.terrain) &&
    isInteger(value.height) &&
    value.height >= MIN_HEIGHT &&
    value.height <= MAX_HEIGHT
  );
}

function isTerrainMap(value: unknown): value is TerrainMap {
  if (!isRecord(value) || !isGrid(value.grid) || !Array.isArray(value.tiles)) {
    return false;
  }
  const grid = value.grid;
  if (value.tiles.length !== grid.width * grid.height) return false;
  return value.tiles.every(isTerrainTile);
}

function isRngState(value: unknown): value is RngState {
  return (
    isRecord(value) &&
    isUint32(value.a) &&
    isUint32(value.b) &&
    isUint32(value.c) &&
    isUint32(value.d) &&
    isNonNegativeInteger(value.calls)
  );
}

const STAT_KEYS = ["hp", "mp", "atk", "def", "mag", "res", "spd", "move", "jump"] as const;

function isStatBlock(value: unknown): value is StatBlock {
  if (!isRecord(value)) return false;
  if (!STAT_KEYS.every((key) => isNonNegativeInteger(value[key]))) return false;
  const hp = value.hp;
  return isNonNegativeInteger(hp) && hp >= 1;
}

function isActiveCondition(value: unknown): value is ActiveCondition {
  return (
    isRecord(value) &&
    isValidId(value.conditionId) &&
    isNonNegativeInteger(value.duration) &&
    (value.sourceId === undefined || isValidId(value.sourceId))
  );
}

function isLearnedAbility(value: unknown): value is LearnedAbility {
  return (
    isRecord(value) &&
    isValidId(value.abilityId) &&
    isNonNegativeInteger(value.drill) &&
    typeof value.mastered === "boolean"
  );
}

function isActionSpec(value: unknown): value is ActionSpec {
  return (
    isRecord(value) &&
    isValidId(value.id) &&
    isNonNegativeInteger(value.mpCost) &&
    isNonNegativeInteger(value.chargeTime) &&
    isNonNegativeInteger(value.range) &&
    isInteger(value.power)
  );
}

function isActionCatalogue(value: unknown): value is ActionCatalogue {
  return (
    isRecord(value) &&
    Object.entries(value).every(
      ([key, spec]) => isValidId(key) && isActionSpec(spec) && spec.id === key,
    )
  );
}

function isPendingAction(value: unknown): value is PendingAction {
  return (
    isRecord(value) &&
    isValidId(value.chargeId) &&
    isValidId(value.unitId) &&
    isValidId(value.abilityId) &&
    isCoord(value.at) &&
    (value.targetId === undefined || isValidId(value.targetId)) &&
    isNonNegativeInteger(value.declaredTick)
  );
}

function isEquipmentIdOrNull(value: unknown): value is EquipmentId | null {
  return value === null || isValidId(value);
}

function isEquipmentLoadout(value: unknown): value is EquipmentLoadout {
  return isRecord(value) && EQUIP_SLOTS.every((slot) => isEquipmentIdOrNull(value[slot]));
}

function isUnit(value: unknown): value is Unit {
  if (!isRecord(value)) return false;
  if (!isValidId(value.id)) return false;
  if (typeof value.name !== "string" || value.name.trim().length === 0) return false;
  if (!isPowerKey(value.power)) return false;
  if (!isValidId(value.postId)) return false;
  if (!isUnitSide(value.side)) return false;
  if (!isInteger(value.level) || value.level < 1) return false;
  if (!isNonNegativeInteger(value.experience)) return false;
  if (!isCoord(value.at)) return false;
  if (!isFacing(value.facing)) return false;
  if (!isStatBlock(value.stats)) return false;
  const hp = value.hp;
  const mp = value.mp;
  const judgePoints = value.judgePoints;
  if (!isNonNegativeInteger(hp) || hp > value.stats.hp) return false;
  if (!isNonNegativeInteger(mp) || mp > value.stats.mp) return false;
  if (!isNonNegativeInteger(judgePoints) || judgePoints > HONOUR_MAX) return false;
  if (!Array.isArray(value.conditions) || !value.conditions.every(isActiveCondition)) return false;
  if (!isEquipmentLoadout(value.equipment)) return false;
  if (!Array.isArray(value.abilities) || !value.abilities.every(isLearnedAbility)) return false;
  return true;
}

function isUnitArray(value: unknown): value is Unit[] {
  return Array.isArray(value) && value.length > 0 && value.every(isUnit);
}

function toObjectiveTracker(tracker: ObjectiveTracker): ObjectiveTracker {
  return {
    objective: copyObjective(tracker.objective),
    turnsElapsed: tracker.turnsElapsed,
    heldTurns: tracker.heldTurns,
  };
}

function isTempoCharge(value: unknown): value is TempoCharge {
  return (
    isRecord(value) &&
    typeof value.chargeId === "string" &&
    value.chargeId.trim().length > 0 &&
    isValidId(value.unitId) &&
    isInteger(value.remaining) &&
    value.remaining >= 1
  );
}

function isTempoEntry(value: unknown): value is TempoEntry {
  return (
    isRecord(value) &&
    isValidId(value.unitId) &&
    isNonNegativeInteger(value.charge) &&
    Array.isArray(value.pending) &&
    value.pending.every(isTempoCharge)
  );
}

function isOrdersTempo(value: unknown): value is OrdersTempo {
  return (
    isRecord(value) &&
    isInteger(value.threshold) &&
    value.threshold > 0 &&
    isNonNegativeInteger(value.tick) &&
    Array.isArray(value.entries) &&
    value.entries.every(isTempoEntry) &&
    isRngState(value.rng)
  );
}

/**
 * Whether `value` is a structurally valid {@link BattleState}.
 *
 * This is the trust-boundary check for saves, replays and network messages. It
 * verifies every field the engine reads, including that soldiers and Orders
 * Tempo entries line up (unique ids, tiles in bounds and not stacked) and that
 * HP/Élan/Honour sit inside their pools. It cannot prove the battle is
 * *reachable* from a seed, only that it is well-formed.
 */
export function isBattleState(value: unknown): value is BattleState {
  if (!isRecord(value)) return false;
  if (!isSeed(value.seed)) return false;
  if (!isTerrainMap(value.map)) return false;
  if (!isUnitArray(value.units)) return false;
  if (!isOrdersTempo(value.tempo)) return false;
  if (!isActionCatalogue(value.abilities)) return false;
  if (!Array.isArray(value.pendingActions) || !value.pendingActions.every(isPendingAction)) {
    return false;
  }
  if (value.currentActorId !== null && !isValidId(value.currentActorId)) return false;
  if (!isOneOf(BATTLE_PHASES, value.phase)) return false;
  if (value.outcome !== null && !isOneOf(BATTLE_OUTCOMES, value.outcome)) return false;
  if (value.objective !== null && !isObjectiveTracker(value.objective)) return false;
  if (typeof value.hasMovedThisTurn !== "boolean") return false;
  if (typeof value.hasActedThisTurn !== "boolean") return false;
  if (typeof value.started !== "boolean") return false;

  const grid = value.map.grid;
  const units = value.units;
  const unitIds = new Set<string>();
  const tiles = new Set<string>();
  for (const unit of units) {
    if (unitIds.has(unit.id)) return false;
    unitIds.add(unit.id);
    if (!inBounds(grid, unit.at)) return false;
    const key = coordKey(unit.at);
    if (tiles.has(key)) return false;
    tiles.add(key);
  }

  if (value.currentActorId !== null && !unitIds.has(value.currentActorId)) return false;

  // Every Orders Tempo entry must track a deployed soldier, exactly once.
  const entryIds = new Set<string>();
  for (const entry of value.tempo.entries) {
    if (entryIds.has(entry.unitId)) return false;
    if (!unitIds.has(entry.unitId)) return false;
    entryIds.add(entry.unitId);
  }

  // A charging action must belong to a soldier still on the field.
  for (const pending of value.pendingActions) {
    if (!unitIds.has(pending.unitId)) return false;
  }

  return true;
}

/* --------------------------------------------------------------------------
 * Reconstruction (drop foreign fields, re-validate through the factories)
 * ------------------------------------------------------------------------ */

function toTerrainMap(map: TerrainMap): TerrainMap {
  return {
    grid: { width: map.grid.width, height: map.grid.height },
    tiles: map.tiles.map((tile) => ({ terrain: tile.terrain, height: tile.height })),
  };
}

function toUnit(unit: Unit): Unit {
  // Rebuild through `createUnit` so a deserialised soldier passes the same
  // validation as an authored one, and any foreign keys are dropped.
  return createUnit({
    id: unit.id,
    name: unit.name,
    power: unit.power,
    postId: unit.postId,
    side: unit.side,
    level: unit.level,
    experience: unit.experience,
    at: unit.at,
    facing: unit.facing,
    stats: unit.stats,
    hp: unit.hp,
    mp: unit.mp,
    judgePoints: unit.judgePoints,
    conditions: unit.conditions,
    equipment: unit.equipment,
    abilities: unit.abilities,
  });
}

function toOrdersTempo(tempo: OrdersTempo): OrdersTempo {
  return {
    threshold: tempo.threshold,
    tick: tempo.tick,
    entries: tempo.entries.map((entry) => ({
      unitId: entry.unitId,
      charge: entry.charge,
      pending: entry.pending.map((charge) => ({
        chargeId: charge.chargeId,
        unitId: charge.unitId,
        remaining: charge.remaining,
      })),
    })),
    rng: { ...tempo.rng },
  };
}

function toActionCatalogue(catalogue: ActionCatalogue): ActionCatalogue {
  const result: Record<string, ActionSpec> = {};
  for (const [key, spec] of Object.entries(catalogue)) {
    result[key] = {
      id: spec.id,
      mpCost: spec.mpCost,
      chargeTime: spec.chargeTime,
      range: spec.range,
      power: spec.power,
    };
  }
  return result;
}

function toPendingAction(pending: PendingAction): PendingAction {
  return {
    chargeId: pending.chargeId,
    unitId: pending.unitId,
    abilityId: pending.abilityId,
    at: { x: pending.at.x, y: pending.at.y },
    ...(pending.targetId === undefined ? {} : { targetId: pending.targetId }),
    declaredTick: pending.declaredTick,
  };
}

/**
 * Validate an untrusted value and return it as a fresh {@link BattleState}.
 * Throws {@link BattleSerializationError} when the shape is wrong.
 */
export function parseBattleState(value: unknown, label = "battle state"): BattleState {
  if (!isBattleState(value)) {
    throw new BattleSerializationError(`${label} is not a well-formed battle state`);
  }
  return {
    seed: value.seed,
    map: toTerrainMap(value.map),
    units: value.units.map(toUnit),
    tempo: toOrdersTempo(value.tempo),
    abilities: toActionCatalogue(value.abilities),
    pendingActions: value.pendingActions.map(toPendingAction),
    currentActorId: value.currentActorId,
    hasMovedThisTurn: value.hasMovedThisTurn,
    hasActedThisTurn: value.hasActedThisTurn,
    phase: value.phase,
    outcome: value.outcome,
    objective:
      value.objective === null ? null : toObjectiveTracker(value.objective),
    started: value.started,
  };
}

/**
 * Parse a battle state from JSON, validating it at the boundary. Round-trips
 * through {@link serializeBattleState} and preserves the state hash.
 */
export function deserializeBattleState(json: string, label = "battle state"): BattleState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new BattleSerializationError(`${label} JSON could not be parsed`);
  }
  return parseBattleState(parsed, label);
}

/* --------------------------------------------------------------------------
 * Command logs and replay
 * ------------------------------------------------------------------------ */

/**
 * Serialise an ordered command log to JSON. Commands are plain data, so a log
 * is text that can be stored, diffed and replayed (`agents.md` §7).
 */
export function serializeCommandLog(commands: readonly Command[]): string {
  return `[${commands.map((command) => serializeCommand(command)).join(",")}]`;
}

/**
 * Parse and validate a command log from JSON. Throws
 * {@link BattleSerializationError} on malformed input; individual commands are
 * validated and cloned by `parseCommand`, so a bad entry names its index.
 */
export function deserializeCommandLog(json: string): Command[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new BattleSerializationError("command log JSON could not be parsed");
  }
  if (!Array.isArray(parsed)) {
    throw new BattleSerializationError("command log must be a JSON array");
  }
  return parsed.map((entry, index) => parseCommand(entry, `command log[${index}]`));
}

/**
 * A complete deterministic battle description: the seed, the authored setup and
 * the ordered commands. Replaying it always yields the same final state and
 * therefore the same {@link hashBattleState}.
 */
export interface BattleScript {
  readonly seed: Seed;
  readonly setup: BattleSetup;
  readonly commands: readonly Command[];
}

/**
 * Replay a {@link BattleScript} through the pure {@link step} loop and return
 * the final battle state.
 *
 * Every command must be accepted; if the rules refuse one, a
 * {@link BattleReplayError} is thrown naming its index and reason. A rejected
 * command means the log does not match the seed/state it is being replayed
 * against — exactly the condition future lockstep netcode must detect
 * (mapping D15, T112).
 *
 * ```ts
 * const final = replayBattle({ seed, setup, commands });
 * const digest = hashBattleState(final);
 * ```
 */
export function replayBattle(script: BattleScript): BattleState {
  let state = createBattle(script.seed, script.setup);
  for (let index = 0; index < script.commands.length; index++) {
    const command = script.commands[index] as Command;
    const result = step(state, command);
    if (result.rejection !== undefined) {
      throw new BattleReplayError(
        `replay command ${index} (${command.kind}) was rejected: ${result.rejection.message}`,
        index,
        result.rejection,
      );
    }
    state = result.state;
  }
  return state;
}
