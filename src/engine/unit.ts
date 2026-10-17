/**
 * The unit model (T017) — one combatant: a single specialist or small crew
 * (mapping §0, decision D0).
 *
 * A {@link Unit} is the atom of the Orders Tempo scheduler (T019), the battle
 * state machine (T022) and every action (T024+). It bundles the three layers
 * the retheme keeps apart (mapping §14):
 *
 * - **Identity & fiction** — `id`, `name`, the great-power military school
 *   (`power`, FFTA "race") and the role (`postId`, FFTA "job").
 * - **Deterministic state** — grid position and cardinal {@link Facing}, the
 *   raw stat block, current `hp`, current **Élan** (`mp`, FFTA "MP"), current
 *   **Honour** (`judgePoints`, FFTA "JP"), active conditions and the equip
 *   loadout.
 * - **Progression** — `level`, `experience` and the learned abilities that
 *   Drill (AP) masters from equipped kit (T048).
 *
 * Contract (agents.md §2, §7, §9):
 * - Pure, deterministic and JSON-serialisable: plain readonly objects, no DOM,
 *   no `Math.random`, no mutation of inputs. Every update helper returns a
 *   **new** unit, so `step` can treat state as immutable.
 * - Mechanical keys stay FFTA-shaped where the reference maps 1:1 (`mp`,
 *   `judgePoints`, `atk`, ...); display text carries the period fiction.
 * - All tunables live here as named constants, never inline in logic.
 *
 * The FFTA-shaped ids come from `engine/ids.ts` (T012) and the shared stat /
 * power / slot types from the authored schema (`src/data/schema.ts`, T008).
 * `src/data/` may be imported by the engine, never the reverse (data README).
 */

import {
  isFacing,
  type Coord,
  type Facing,
} from "./grid";
import {
  assertId,
  type AbilityId,
  type ConditionId,
  type EquipmentId,
  type PostId,
  type UnitId,
} from "./ids";
import {
  EQUIP_SLOTS,
  POWER_KEYS,
  type EquipSlot,
  type PowerKey,
  type StatBlock,
} from "../data/schema";

/* --------------------------------------------------------------------------
 * Constants (tunable balance lives here, per agents.md §9)
 * ------------------------------------------------------------------------ */

/**
 * Maximum **Honour** a unit may hold (FFTA's Judge Point cap of 10, mapping §5).
 * Fuels Volleys (T061) and Guard Sorties (T062).
 */
export const HONOUR_MAX = 10;

/**
 * Minimum experience a unit of a given level needs. Levels start at 1, so a
 * fresh recruit has 0 experience. T049 owns the real growth table; this keeps
 * the field honest until then.
 */
export const EXPERIENCE_MIN = 0;

/* --------------------------------------------------------------------------
 * Faction side
 * ------------------------------------------------------------------------ */

/**
 * Which side of the field a unit belongs to. The multinational free company is
 * `"company"` (mapping §1), hostile irregulars are `"enemy"`, and the Provost
 * Marshal and other arbiters are `"neutral"` (mapping §9).
 */
export const UNIT_SIDES = ["company", "enemy", "neutral"] as const;
export type UnitSide = (typeof UNIT_SIDES)[number];

/** Runtime guard for untrusted side values (saves, network). */
export function isUnitSide(value: unknown): value is UnitSide {
  return typeof value === "string" && (UNIT_SIDES as readonly string[]).includes(value);
}

/* --------------------------------------------------------------------------
 * Conditions, equipment and learned abilities
 * ------------------------------------------------------------------------ */

/**
 * One condition currently affecting a unit (mapping §8, FFTA status).
 *
 * The condition engine (T039) owns stacking and expiry rules; the unit only
 * carries the instances. Keeping the duration on the instance (rather than on
 * the definition) is what lets two units carry *Bleeding* for different spans.
 */
export interface ActiveCondition {
  /** FFTA-shaped condition key, e.g. `bleeding` / `formed`. */
  readonly conditionId: ConditionId;
  /** Remaining Orders-Tempo ticks; `0` means indefinite until cured. */
  readonly duration: number;
  /** Who applied it, when known (for kill credit / cure attribution). */
  readonly sourceId?: UnitId;
}

/**
 * A unit's filled equipment slots. Every slot is always present; an empty slot
 * is `null`, which keeps the shape stable for serialisation and UI.
 */
export type EquipmentLoadout = Readonly<Record<EquipSlot, EquipmentId | null>>;

/**
 * An ability a unit has learned. In FFTA an ability is bound to a piece of kit
 * until enough AP (= our **Drill**) is earned; mastery is then permanent even
 * after the kit is removed (mapping §10, T048).
 */
export interface LearnedAbility {
  /** The mastered or in-progress ability. */
  readonly abilityId: AbilityId;
  /** Drill (AP) accumulated toward mastery. */
  readonly drill: number;
  /** `true` once the Drill threshold is reached; permanent (T048). */
  readonly mastered: boolean;
}

/* --------------------------------------------------------------------------
 * The unit
 * ------------------------------------------------------------------------ */

/**
 * A combatant on the battlefield. Treat as immutable: use the `with…` helpers
 * below (or `{ ...unit, ... }` inside the engine) rather than mutating fields.
 */
export interface Unit {
  /** Stable, branded identity. */
  readonly id: UnitId;
  /** Player-facing name (the fiction layer). */
  readonly name: string;
  /** Great-power military school (FFTA "race", mapping §2). */
  readonly power: PowerKey;
  /** Primary role / post (FFTA "job", mapping §3). */
  readonly postId: PostId;
  /** Which side of the field the unit fights for. */
  readonly side: UnitSide;
  /** Experience level, starting at 1 (T049). */
  readonly level: number;
  /** Experience toward the next level (T049). */
  readonly experience: number;
  /** Grid position. */
  readonly at: Coord;
  /** Cardinal facing — front/side/rear maths (T037, mapping §12). */
  readonly facing: Facing;
  /**
   * The unit's stat block. Equipment and temporary modifiers layer on top in
   * `stats.ts` (T018); this is the stored base at creation.
   */
  readonly stats: StatBlock;
  /** Current hit points, within `[0, stats.hp]`. */
  readonly hp: number;
  /** Current **Élan** (FFTA "MP", mapping §5); within `[0, stats.mp]`. */
  readonly mp: number;
  /** Current **Honour** (FFTA "JP", mapping §5); within `[0, HONOUR_MAX]`. */
  readonly judgePoints: number;
  /** Active conditions; at most one instance per condition id (T039). */
  readonly conditions: readonly ActiveCondition[];
  /** Filled kit slots. */
  readonly equipment: EquipmentLoadout;
  /** Abilities learned from Drill (T048). */
  readonly abilities: readonly LearnedAbility[];
}

/**
 * Authoring/creation input for {@link createUnit}. Optional fields default to a
 * fresh, full-strength soldier: `side` to the free company, `facing` to north,
 * `hp`/`mp` to their maxima and `judgePoints` to 0.
 */
export interface UnitInit {
  readonly id: UnitId;
  readonly name: string;
  readonly power: PowerKey;
  readonly postId: PostId;
  readonly side?: UnitSide;
  readonly level: number;
  readonly experience?: number;
  readonly at: Coord;
  readonly facing?: Facing;
  readonly stats: StatBlock;
  readonly hp?: number;
  readonly mp?: number;
  readonly judgePoints?: number;
  readonly conditions?: readonly ActiveCondition[];
  readonly equipment?: Partial<EquipmentLoadout>;
  readonly abilities?: readonly LearnedAbility[];
}

/* --------------------------------------------------------------------------
 * Validation helpers (fail fast at the data/save boundary)
 * ------------------------------------------------------------------------ */

/** The stats every unit carries; used to validate a {@link StatBlock}. */
const STAT_KEYS: readonly (keyof StatBlock)[] = [
  "hp",
  "mp",
  "atk",
  "def",
  "mag",
  "res",
  "spd",
  "move",
  "jump",
];

function assertNonEmptyString(value: unknown, label: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RangeError(`${label} must be a non-empty string`);
  }
}

function assertInteger(value: number, label: string, min: number): void {
  if (!Number.isInteger(value) || value < min) {
    throw new RangeError(`${label} must be an integer >= ${min}, received ${String(value)}`);
  }
}

/** Any integer, including negatives — used before a value is clamped. */
function assertAnyInteger(value: number, label: string): void {
  if (!Number.isInteger(value)) {
    throw new RangeError(`${label} must be an integer, received ${String(value)}`);
  }
}

function assertInRange(value: number, min: number, max: number, label: string): void {
  assertInteger(value, label, min);
  if (value > max) {
    throw new RangeError(`${label} must be within [${min}, ${max}], received ${String(value)}`);
  }
}

/** Coordinates may be negative (offset vectors), but never fractional. */
function assertCoord(at: Coord): void {
  if (!Number.isInteger(at.x) || !Number.isInteger(at.y)) {
    throw new RangeError(
      `unit.at must be integer coordinates, received { x: ${at.x}, y: ${at.y} }`,
    );
  }
}

function assertStatBlock(stats: StatBlock): void {
  for (const key of STAT_KEYS) {
    assertInteger(stats[key], `unit.stats.${key}`, 0);
  }
  // A fielded unit has at least one hit point at full strength.
  if (stats.hp < 1) {
    throw new RangeError(`unit.stats.hp must be >= 1, received ${String(stats.hp)}`);
  }
}

/** Runtime guard for the closed set of great-power schools (mapping §2). */
export function isPowerKey(value: unknown): value is PowerKey {
  return typeof value === "string" && (POWER_KEYS as readonly string[]).includes(value);
}

function validateCondition(condition: ActiveCondition): ActiveCondition {
  assertId(condition.conditionId, "condition.conditionId");
  assertInteger(condition.duration, "condition.duration", 0);
  if (condition.sourceId !== undefined) {
    assertId(condition.sourceId, "condition.sourceId");
  }
  return {
    conditionId: condition.conditionId,
    duration: condition.duration,
    ...(condition.sourceId !== undefined ? { sourceId: condition.sourceId } : {}),
  };
}

function validateLearnedAbility(ability: LearnedAbility): LearnedAbility {
  assertId(ability.abilityId, "ability.abilityId");
  assertInteger(ability.drill, "ability.drill", 0);
  if (typeof ability.mastered !== "boolean") {
    throw new RangeError("ability.mastered must be a boolean");
  }
  return {
    abilityId: ability.abilityId,
    drill: ability.drill,
    mastered: ability.mastered,
  };
}

/** Clamp an integer into the inclusive `[min, max]` band. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/* --------------------------------------------------------------------------
 * Creation
 * ------------------------------------------------------------------------ */

/**
 * Build a full equip loadout, filling any omitted slot with `null`. Accepts a
 * partial so fixtures can name only the kit they care about.
 */
export function createEquipmentLoadout(
  partial: Partial<EquipmentLoadout> = {},
): EquipmentLoadout {
  return {
    // Listed explicitly (rather than looping) so adding an `EquipSlot` is a
    // compile error here, not a silently missing slot.
    weapon: partial.weapon ?? null,
    offhand: partial.offhand ?? null,
    armour: partial.armour ?? null,
    head: partial.head ?? null,
    accessory: partial.accessory ?? null,
  };
}

/**
 * Validate and normalise a unit. Throws a `RangeError` on malformed input
 * (unknown power, non-positive level, current HP/Élan/Honour out of range,
 * fractional coordinates, ...) so bad data fails at the boundary rather than
 * corrupting a battle.
 *
 * ```ts
 * const unit = createUnit({
 *   id: asUnitId("unit-1"),
 *   name: "Sgt. Aubry",
 *   power: "france",
 *   postId: asPostId("fusilier"),
 *   level: 1,
 *   at: coord(2, 3),
 *   stats: FUSILIER_STATS,
 * });
 * ```
 */
export function createUnit(init: UnitInit): Unit {
  assertId(init.id, "unit.id");
  assertNonEmptyString(init.name, "unit.name");
  if (!isPowerKey(init.power)) {
    throw new RangeError(
      `unit.power must be one of ${POWER_KEYS.join(", ")}, received ${String(init.power)}`,
    );
  }
  assertId(init.postId, "unit.postId");

  const side = init.side ?? "company";
  if (!isUnitSide(side)) {
    throw new RangeError(
      `unit.side must be one of ${UNIT_SIDES.join(", ")}, received ${String(side)}`,
    );
  }

  assertInteger(init.level, "unit.level", 1);
  const experience = init.experience ?? EXPERIENCE_MIN;
  assertInteger(experience, "unit.experience", EXPERIENCE_MIN);

  assertCoord(init.at);

  const facing = init.facing ?? "north";
  if (!isFacing(facing)) {
    throw new RangeError(`unit.facing must be a cardinal direction, received ${String(facing)}`);
  }

  assertStatBlock(init.stats);

  const hp = init.hp ?? init.stats.hp;
  assertInRange(hp, 0, init.stats.hp, "unit.hp");
  const mp = init.mp ?? init.stats.mp;
  assertInRange(mp, 0, init.stats.mp, "unit.mp");
  const judgePoints = init.judgePoints ?? 0;
  assertInRange(judgePoints, 0, HONOUR_MAX, "unit.judgePoints");

  const conditions = (init.conditions ?? []).map(validateCondition);
  const abilities = (init.abilities ?? []).map(validateLearnedAbility);

  return {
    id: init.id,
    name: init.name,
    power: init.power,
    postId: init.postId,
    side,
    level: init.level,
    experience,
    at: { x: init.at.x, y: init.at.y },
    facing,
    stats: { ...init.stats },
    hp,
    mp,
    judgePoints,
    conditions,
    equipment: createEquipmentLoadout(init.equipment),
    abilities,
  };
}

/* --------------------------------------------------------------------------
 * Queries
 * ------------------------------------------------------------------------ */

/** Whether a unit is out of action (FFTA KO, mapping §8). */
export function isOutOfAction(unit: Unit): boolean {
  return unit.hp <= 0;
}

/** Whether a unit currently carries `conditionId`. */
export function hasCondition(unit: Unit, conditionId: ConditionId): boolean {
  return unit.conditions.some((condition) => condition.conditionId === conditionId);
}

/** The active instance of `conditionId`, or `undefined` when absent. */
export function getCondition(
  unit: Unit,
  conditionId: ConditionId,
): ActiveCondition | undefined {
  return unit.conditions.find((condition) => condition.conditionId === conditionId);
}

/* --------------------------------------------------------------------------
 * Immutable updates (the only way the engine changes a unit)
 * ------------------------------------------------------------------------ */

/** Move a unit, optionally turning it to face a new direction. */
export function withPosition(unit: Unit, at: Coord, facing?: Facing): Unit {
  assertCoord(at);
  if (facing !== undefined && !isFacing(facing)) {
    throw new RangeError(`facing must be a cardinal direction, received ${String(facing)}`);
  }
  return {
    ...unit,
    at: { x: at.x, y: at.y },
    ...(facing !== undefined ? { facing } : {}),
  };
}

/** Turn a unit to face a new cardinal direction, leaving its tile unchanged. */
export function withFacing(unit: Unit, facing: Facing): Unit {
  if (!isFacing(facing)) {
    throw new RangeError(`facing must be a cardinal direction, received ${String(facing)}`);
  }
  return { ...unit, facing };
}

/**
 * Set current HP, clamped into `[0, stats.hp]`. Out-of-range values (overkill
 * damage, oversized heals) are clamped rather than rejected — only a
 * non-integer is a programmer error.
 */
export function withHp(unit: Unit, hp: number): Unit {
  assertAnyInteger(hp, "hp");
  return { ...unit, hp: clamp(hp, 0, unit.stats.hp) };
}

/** Set current **Élan** (FFTA "MP"), clamped into `[0, stats.mp]`. */
export function withMp(unit: Unit, mp: number): Unit {
  assertAnyInteger(mp, "mp");
  return { ...unit, mp: clamp(mp, 0, unit.stats.mp) };
}

/** Set current **Honour** (FFTA "JP"), clamped into `[0, HONOUR_MAX]`. */
export function withJudgePoints(unit: Unit, judgePoints: number): Unit {
  assertAnyInteger(judgePoints, "judgePoints");
  return { ...unit, judgePoints: clamp(judgePoints, 0, HONOUR_MAX) };
}

/**
 * Apply a condition, refreshing the duration when the unit already carries it.
 * Stacking and expiry rules live in the condition engine (T039); this keeps at
 * most one instance per condition id.
 */
export function addCondition(unit: Unit, condition: ActiveCondition): Unit {
  const validated = validateCondition(condition);
  const existing = unit.conditions.findIndex(
    (current) => current.conditionId === validated.conditionId,
  );
  if (existing === -1) {
    return { ...unit, conditions: [...unit.conditions, validated] };
  }
  const conditions = unit.conditions.slice();
  conditions[existing] = validated;
  return { ...unit, conditions };
}

/** Remove every instance of `conditionId`; a no-op when absent. */
export function removeCondition(unit: Unit, conditionId: ConditionId): Unit {
  const conditions = unit.conditions.filter(
    (condition) => condition.conditionId !== conditionId,
  );
  if (conditions.length === unit.conditions.length) return unit;
  return { ...unit, conditions };
}

/** Replace one equipment slot (or clear it with `null`). */
export function withEquipment(
  unit: Unit,
  slot: EquipSlot,
  itemId: EquipmentId | null,
): Unit {
  if (!(EQUIP_SLOTS as readonly string[]).includes(slot)) {
    throw new RangeError(`unknown equipment slot: ${String(slot)}`);
  }
  if (itemId !== null) assertId(itemId, "equipment itemId");
  return { ...unit, equipment: { ...unit.equipment, [slot]: itemId } };
}

/**
 * Record a learned ability, refreshing an existing entry (e.g. when more Drill
 * is earned). Mastery is sticky: once `mastered` is `true` it stays `true`.
 */
export function learnAbility(unit: Unit, ability: LearnedAbility): Unit {
  const validated = validateLearnedAbility(ability);
  const existing = unit.abilities.findIndex(
    (current) => current.abilityId === validated.abilityId,
  );
  if (existing === -1) {
    return { ...unit, abilities: [...unit.abilities, validated] };
  }
  const previous = unit.abilities[existing];
  const merged: LearnedAbility = {
    abilityId: validated.abilityId,
    drill: Math.max(previous.drill, validated.drill),
    mastered: previous.mastered || validated.mastered,
  };
  const abilities = unit.abilities.slice();
  abilities[existing] = merged;
  return { ...unit, abilities };
}
