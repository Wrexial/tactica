/**
 * Battle events (T021) — the **report** a resolved command leaves behind.
 *
 * A command ({@link ./commands.ts}) says what a player or the AI *intends*. The
 * battle state machine (T022) consumes it and returns `{ state, events }`,
 * where each {@link BattleEvent} records one observable thing that happened:
 * a soldier stepped, a shot landed, a condition took hold, an Article of War
 * was broken, an ability was mastered. This is the one channel from the engine
 * to the presentation layers (`agents.md` §7):
 *
 * ```
 *   Command ──► step(state, command) ──► { state', events[] }
 *                                             │
 *                                             ├─► renderer animates (T082)
 *                                             └─► UI logs, bars, popups (T071+)
 * ```
 *
 * Why events (and not "let the renderer diff the state")?
 * - **No ambiguity.** Two identical end states can be reached by very different
 *   actions (a shove versus a walk); only the event stream knows which.
 * - **Ordering.** Events are emitted in resolution order, so wind-ups, impacts
 *   and follow-ups animate in the right sequence.
 * - **Purity.** Events are plain, readonly, JSON-safe data — no engine state is
 *   attached and nothing here mutates the world. The renderer *reads* events;
 *   it never writes back (`agents.md` §7).
 *
 * Vocabulary follows the retheme (`docs/NAPOLEONIC_MAPPING.md`): FFTA "MP" is
 * **Élan** (and morale, D4), "JP" is **Honour**, "AP" is **Drill**, the "Judge"
 * is the **Provost Marshal**, a "Law" is an **Article of War**, and "Totema" is
 * a **Guard Sortie**. Mechanical keys stay FFTA-shaped (`mp`, `judgePoints`,
 * `element`) so formulas and the reference map 1:1.
 *
 * Contract (agents.md §2, §7, §9):
 * - Pure and framework-free: no DOM, no I/O, no `Math.random`, no `Date`.
 *   Time is the integer Orders Tempo {@link EventBase.tick}.
 * - Every event is a discriminated-union member keyed by `kind`, so exhaustive
 *   handling and adding a kind is a compile error everywhere it must be handled.
 * - JSON-serialisable by construction: branded string ids, plain {@link Coord}s
 *   and finite integers only. {@link serializeEvent} / {@link parseEvent} make
 *   the boundary explicit for replay logs and worker/UI transports.
 */

import { isFacing, type Coord, type Facing } from "./grid";
import {
  isValidId,
  type AbilityId,
  type ArticleId,
  type ConditionId,
  type EquipmentId,
  type GuardSortieId,
  type PostId,
  type UnitId,
} from "./ids";
import { isUnitSide, type UnitSide } from "./unit";
import { ELEMENT_KEYS, type ElementKey } from "../data/schema";

/* --------------------------------------------------------------------------
 * Shared vocabularies
 * ------------------------------------------------------------------------ */

/**
 * How a point of damage was delivered (mapping §12). FFTA's physical/magical
 * split becomes **Steel** and **Powder**; `"none"` is reserved for
 * environmental or condition damage (Bleeding, a fall) that is neither.
 */
export const DAMAGE_TYPES = ["steel", "powder", "none"] as const;
export type DamageType = (typeof DAMAGE_TYPES)[number];

/** Why a unit's **Élan** (FFTA "MP", mapping §5) changed. */
export const MP_CHANGE_REASONS = ["spent", "regenerated", "drained", "morale"] as const;
export type MpChangeReason = (typeof MP_CHANGE_REASONS)[number];

/**
 * Why a unit's **Honour** (FFTA "JP", mapping §5) changed. `legalKo` is an
 * Article-legal knockout; `commended` is a Provost-approved act; `penalty`
 * covers reprimands and court-martial costs.
 */
export const HONOUR_CHANGE_REASONS = [
  "legalKo",
  "commended",
  "volley",
  "guardSortie",
  "penalty",
] as const;
export type HonourChangeReason = (typeof HONOUR_CHANGE_REASONS)[number];

/** Why a condition left a unit (T039). */
export const CONDITION_REMOVAL_REASONS = ["expired", "cured", "replaced", "removed"] as const;
export type ConditionRemovalReason = (typeof CONDITION_REMOVAL_REASONS)[number];

/** Why a soldier left the field without being knocked out. */
export const UNIT_REMOVAL_REASONS = ["courtMartial", "captured", "withdrawn", "escaped"] as const;
export type UnitRemovalReason = (typeof UNIT_REMOVAL_REASONS)[number];

/**
 * Severity of an enforcement action (mapping §9). A **Reprimand** is FFTA's
 * Yellow Card; a **Court-Martial** is the Red Card that removes the soldier.
 */
export const CARD_SEVERITIES = ["reprimand", "courtMartial"] as const;
export type CardSeverity = (typeof CARD_SEVERITIES)[number];

/** How a battle finished, from the free company's point of view (T031). */
export const BATTLE_OUTCOMES = ["companyVictory", "companyDefeat", "draw"] as const;
export type BattleOutcome = (typeof BATTLE_OUTCOMES)[number];

/* --------------------------------------------------------------------------
 * Event kinds
 * ------------------------------------------------------------------------ */

/** Every event kind the battle layer can emit. */
export const EVENT_KINDS = [
  "battleStarted",
  "battleEnded",
  "unitDeployed",
  "unitRemoved",
  "turnStarted",
  "turnEnded",
  "chargeStarted",
  "chargeResolved",
  "moved",
  "faced",
  "shoved",
  "abilityUsed",
  "abilityResolved",
  "itemUsed",
  "reactionTriggered",
  "volleyStarted",
  "volleyChained",
  "guardSortieCalled",
  "damaged",
  "healed",
  "missed",
  "outOfAction",
  "revived",
  "mpChanged",
  "honourChanged",
  "conditionApplied",
  "conditionRemoved",
  "drillGained",
  "abilityLearned",
  "experienceGained",
  "levelUp",
  "postUnlocked",
  "articleBroken",
  "reprimandIssued",
  "courtMartialIssued",
  "commended",
  "rewardGranted",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/** Runtime guard for untrusted event-kind strings (replays, network). */
export function isEventKind(value: unknown): value is EventKind {
  return typeof value === "string" && (EVENT_KINDS as readonly string[]).includes(value);
}

/* --------------------------------------------------------------------------
 * Event base
 * ------------------------------------------------------------------------ */

/**
 * Fields every event shares. `tick` is the integer Orders Tempo clock when the
 * event occurred — the engine's only notion of time, so animations and logs
 * order deterministically without wall-clock timestamps.
 */
export interface EventBase {
  /** Which event this is; narrow on it to read the payload. */
  readonly kind: EventKind;
  /** Orders Tempo tick at which the event occurred (`>= 0`). */
  readonly tick: number;
}

/* --------------------------------------------------------------------------
 * Battle lifecycle
 * ------------------------------------------------------------------------ */

/** The battle has been set up and Orders Tempo is about to begin. */
export interface BattleStartedEvent extends EventBase {
  readonly kind: "battleStarted";
}

/**
 * The battle is over. `outcome` is stated from the company's point of view so
 * the UI never has to infer winners from unit sides.
 */
export interface BattleEndedEvent extends EventBase {
  readonly kind: "battleEnded";
  readonly outcome: BattleOutcome;
}

/** A soldier entered the field (deployment / reinforcement). */
export interface UnitDeployedEvent extends EventBase {
  readonly kind: "unitDeployed";
  readonly unitId: UnitId;
  /** Tile it deployed onto. */
  readonly at: Coord;
  /** Which side it fights for. */
  readonly side: UnitSide;
}

/** A soldier left the field without being knocked out (removed from play). */
export interface UnitRemovedEvent extends EventBase {
  readonly kind: "unitRemoved";
  readonly unitId: UnitId;
  readonly reason: UnitRemovalReason;
}

/* --------------------------------------------------------------------------
 * Orders Tempo (turn order and charging)
 * ------------------------------------------------------------------------ */

/** A soldier's Orders Tempo turn began (FFTA CTB, mapping §12). */
export interface TurnStartedEvent extends EventBase {
  readonly kind: "turnStarted";
  readonly unitId: UnitId;
}

/** The acting soldier's turn ended and charge was spent. */
export interface TurnEndedEvent extends EventBase {
  readonly kind: "turnEnded";
  readonly unitId: UnitId;
}

/**
 * An ability (or other effect) started charging; it will resolve after
 * `ticks` tempo ticks. The UI uses this to show the wind-up timer (T083).
 */
export interface ChargeStartedEvent extends EventBase {
  readonly kind: "chargeStarted";
  readonly unitId: UnitId;
  /** Caller-owned id linking this charge to its resolution. */
  readonly chargeId: string;
  readonly abilityId: AbilityId;
  /** Whole tempo ticks until resolution (`>= 1`). */
  readonly ticks: number;
}

/** A charging effect reached zero ticks and is about to resolve. */
export interface ChargeResolvedEvent extends EventBase {
  readonly kind: "chargeResolved";
  readonly unitId: UnitId;
  readonly chargeId: string;
  readonly abilityId: AbilityId;
}

/* --------------------------------------------------------------------------
 * Movement, facing and displacement
 * ------------------------------------------------------------------------ */

/**
 * A soldier stepped along a path. `path` is the full route (origin first), so
 * the renderer can animate each tile without querying state; `facing` is the
 * orientation after the move (turning to travel may change it).
 */
export interface MovedEvent extends EventBase {
  readonly kind: "moved";
  readonly unitId: UnitId;
  readonly from: Coord;
  readonly to: Coord;
  readonly path: readonly Coord[];
  readonly facing: Facing;
}

/** A soldier turned in place (mapping §12 facing). */
export interface FacedEvent extends EventBase {
  readonly kind: "faced";
  readonly unitId: UnitId;
  readonly from: Facing;
  readonly to: Facing;
}

/** A soldier was pushed one or more tiles (FFTA knockback → Shove, mapping §12). */
export interface ShovedEvent extends EventBase {
  readonly kind: "shoved";
  readonly unitId: UnitId;
  readonly from: Coord;
  readonly to: Coord;
}

/* --------------------------------------------------------------------------
 * Actions
 * ------------------------------------------------------------------------ */

/**
 * A soldier declared an action (FFTA A-Ability → Action, mapping §6). `at` is
 * the resolved centre of the effect (a self-buff uses the actor's own tile)
 * and `targetId` is present only when the action named a specific soldier.
 * `chargeTime` mirrors the authored ability so the renderer knows whether to
 * play a wind-up or an instant effect.
 */
export interface AbilityUsedEvent extends EventBase {
  readonly kind: "abilityUsed";
  readonly unitId: UnitId;
  readonly abilityId: AbilityId;
  /** Resolved tile the effect is centred on. */
  readonly at: Coord;
  /** The named target, when the action was single-target. */
  readonly targetId?: UnitId;
  /** Tempo ticks the action charges for (`0` = instant). */
  readonly chargeTime: number;
}

/** The declared action's effect now lands (after any charge time). */
export interface AbilityResolvedEvent extends EventBase {
  readonly kind: "abilityResolved";
  readonly unitId: UnitId;
  readonly abilityId: AbilityId;
  readonly at: Coord;
  readonly targetId?: UnitId;
}

/** A piece of kit was used from the field (medicine, grenades, tools). */
export interface ItemUsedEvent extends EventBase {
  readonly kind: "itemUsed";
  readonly unitId: UnitId;
  readonly itemId: EquipmentId;
  readonly at: Coord;
  readonly targetId?: UnitId;
}

/** A reaction (FFTA R-Ability, mapping §6) triggered in response to `sourceId`. */
export interface ReactionTriggeredEvent extends EventBase {
  readonly kind: "reactionTriggered";
  readonly unitId: UnitId;
  readonly abilityId: AbilityId;
  /** The soldier whose action provoked the reaction, when known. */
  readonly sourceId?: UnitId;
  readonly at: Coord;
}

/** A **Volley** (FFTA Combo, mapping §6, T061) was initiated. */
export interface VolleyStartedEvent extends EventBase {
  readonly kind: "volleyStarted";
  readonly unitId: UnitId;
  readonly abilityId: AbilityId;
  readonly at: Coord;
  readonly targetId?: UnitId;
  /** Honour committed to the volley, scaling its damage. */
  readonly honour: number;
}

/** An adjacent ally chained into an in-progress Volley. */
export interface VolleyChainedEvent extends EventBase {
  readonly kind: "volleyChained";
  readonly unitId: UnitId;
  readonly abilityId: AbilityId;
  readonly at: Coord;
  readonly targetId?: UnitId;
}

/** A national **Guard Sortie** (FFTA Totema, mapping §4, T062) was called. */
export interface GuardSortieCalledEvent extends EventBase {
  readonly kind: "guardSortieCalled";
  readonly unitId: UnitId;
  readonly guardSortieId: GuardSortieId;
}

/* --------------------------------------------------------------------------
 * Damage, healing and defeat
 * ------------------------------------------------------------------------ */

/**
 * A soldier took damage. `hpAfter` is the clamped post-hit value so HP bars
 * stay in sync even if the renderer missed earlier events; `critical` flags a
 * critical strike and `fatal` says whether this hit reduced HP to zero.
 */
export interface DamagedEvent extends EventBase {
  readonly kind: "damaged";
  readonly unitId: UnitId;
  /** Who dealt it, when known (environmental damage omits it). */
  readonly sourceId?: UnitId;
  readonly abilityId?: AbilityId;
  /** Point loss (`>= 0`; healing is a separate event). */
  readonly amount: number;
  /** Hit points remaining after the hit. */
  readonly hpAfter: number;
  readonly damageType: DamageType;
  /** Incendiary, Cold, Shock, ... (mapping §7, D5), when elemental. */
  readonly element?: ElementKey;
  readonly critical: boolean;
  readonly fatal: boolean;
}

/** A soldier recovered hit points. */
export interface HealedEvent extends EventBase {
  readonly kind: "healed";
  readonly unitId: UnitId;
  readonly sourceId?: UnitId;
  readonly abilityId?: AbilityId;
  /** Points restored (`>= 0`). */
  readonly amount: number;
  readonly hpAfter: number;
}

/** An attack failed to connect (miss, dodge, perfect Parry). */
export interface MissedEvent extends EventBase {
  readonly kind: "missed";
  readonly unitId: UnitId;
  readonly sourceId?: UnitId;
  readonly abilityId?: AbilityId;
}

/** A soldier was knocked out (FFTA KO → Out of Action, mapping §8). */
export interface OutOfActionEvent extends EventBase {
  readonly kind: "outOfAction";
  readonly unitId: UnitId;
  readonly sourceId?: UnitId;
}

/** A downed soldier was brought back (medicine, Last Rites). */
export interface RevivedEvent extends EventBase {
  readonly kind: "revived";
  readonly unitId: UnitId;
  readonly sourceId?: UnitId;
  readonly hpAfter: number;
}

/* --------------------------------------------------------------------------
 * Resources and progression
 * ------------------------------------------------------------------------ */

/** A soldier's **Élan** (FFTA "MP") changed; `delta` is signed. */
export interface MpChangedEvent extends EventBase {
  readonly kind: "mpChanged";
  readonly unitId: UnitId;
  /** Signed change; negative when spent or drained. */
  readonly delta: number;
  /** Élan after the change, clamped. */
  readonly mpAfter: number;
  readonly reason: MpChangeReason;
}

/** A soldier's **Honour** (FFTA "JP", max 10) changed; `delta` is signed. */
export interface HonourChangedEvent extends EventBase {
  readonly kind: "honourChanged";
  readonly unitId: UnitId;
  readonly delta: number;
  readonly honourAfter: number;
  readonly reason: HonourChangeReason;
}

/** A condition took hold (or was refreshed) on a soldier (mapping §8). */
export interface ConditionAppliedEvent extends EventBase {
  readonly kind: "conditionApplied";
  readonly unitId: UnitId;
  readonly conditionId: ConditionId;
  /** Remaining tempo ticks; `0` means indefinite until cured. */
  readonly duration: number;
  readonly sourceId?: UnitId;
}

/** A condition left a soldier. */
export interface ConditionRemovedEvent extends EventBase {
  readonly kind: "conditionRemoved";
  readonly unitId: UnitId;
  readonly conditionId: ConditionId;
  readonly reason: ConditionRemovalReason;
}

/** **Drill** (FFTA AP) accumulated toward mastering a kit-bound ability (T048). */
export interface DrillGainedEvent extends EventBase {
  readonly kind: "drillGained";
  readonly unitId: UnitId;
  readonly abilityId: AbilityId;
  /** Drill gained by this award (`> 0`). */
  readonly amount: number;
  /** Total Drill toward the ability after the award. */
  readonly drillAfter: number;
  /** `true` when this award completed mastery. */
  readonly mastered: boolean;
}

/**
 * An ability has been mastered and is now permanently available, even after
 * the kit that taught it is removed (mapping §10, T048).
 */
export interface AbilityLearnedEvent extends EventBase {
  readonly kind: "abilityLearned";
  readonly unitId: UnitId;
  readonly abilityId: AbilityId;
}

/** Experience was awarded. */
export interface ExperienceGainedEvent extends EventBase {
  readonly kind: "experienceGained";
  readonly unitId: UnitId;
  readonly amount: number;
  readonly experienceAfter: number;
}

/** A soldier reached a new level (T049). */
export interface LevelUpEvent extends EventBase {
  readonly kind: "levelUp";
  readonly unitId: UnitId;
  /** The new level. */
  readonly level: number;
}

/** A post's prerequisites were met and it is now unlockable (mapping §10). */
export interface PostUnlockedEvent extends EventBase {
  readonly kind: "postUnlocked";
  readonly unitId: UnitId;
  readonly postId: PostId;
}

/* --------------------------------------------------------------------------
 * Articles of War and the Provost Marshal (mapping §9)
 * ------------------------------------------------------------------------ */

/** A daily **Article of War** (FFTA "law") was violated. */
export interface ArticleBrokenEvent extends EventBase {
  readonly kind: "articleBroken";
  readonly unitId: UnitId;
  readonly articleId: ArticleId;
  readonly severity: CardSeverity;
}

/** A **Reprimand** (FFTA Yellow Card) was issued. */
export interface ReprimandIssuedEvent extends EventBase {
  readonly kind: "reprimandIssued";
  readonly unitId: UnitId;
  readonly articleId: ArticleId;
  /** Total reprimands the soldier now carries. */
  readonly reprimands: number;
}

/** A **Court-Martial** (FFTA Red Card) removed a soldier from the field. */
export interface CourtMartialIssuedEvent extends EventBase {
  readonly kind: "courtMartialIssued";
  readonly unitId: UnitId;
  readonly articleId: ArticleId;
}

/** A Provost-approved act granted **Honour** (the commended half of §9). */
export interface CommendedEvent extends EventBase {
  readonly kind: "commended";
  readonly unitId: UnitId;
  /** Honour granted (`> 0`). */
  readonly honour: number;
}

/* --------------------------------------------------------------------------
 * Rewards
 * ------------------------------------------------------------------------ */

/** Post-action spoils: Crowns and any captured kit (mapping §5, §10). */
export interface RewardGrantedEvent extends EventBase {
  readonly kind: "rewardGranted";
  /** Crowns awarded (`>= 0`). */
  readonly crowns: number;
  /** Captured equipment, when any. */
  readonly equipmentIds?: readonly EquipmentId[];
}

/* --------------------------------------------------------------------------
 * The union
 * ------------------------------------------------------------------------ */

/**
 * The complete battle-event union. Narrow on `kind` to get the payload; because
 * the shapes are disjoint, exhaustiveness checking (`switch` + `never`) works
 * and adding a kind is a compile error everywhere it must be handled.
 *
 * ```ts
 * function render(event: BattleEvent) {
 *   switch (event.kind) {
 *     case "moved":  return animateStep(event.path);
 *     case "damaged": return popDamage(event.unitId, event.amount);
 *     // ...
 *   }
 * }
 * ```
 */
export type BattleEvent =
  | BattleStartedEvent
  | BattleEndedEvent
  | UnitDeployedEvent
  | UnitRemovedEvent
  | TurnStartedEvent
  | TurnEndedEvent
  | ChargeStartedEvent
  | ChargeResolvedEvent
  | MovedEvent
  | FacedEvent
  | ShovedEvent
  | AbilityUsedEvent
  | AbilityResolvedEvent
  | ItemUsedEvent
  | ReactionTriggeredEvent
  | VolleyStartedEvent
  | VolleyChainedEvent
  | GuardSortieCalledEvent
  | DamagedEvent
  | HealedEvent
  | MissedEvent
  | OutOfActionEvent
  | RevivedEvent
  | MpChangedEvent
  | HonourChangedEvent
  | ConditionAppliedEvent
  | ConditionRemovedEvent
  | DrillGainedEvent
  | AbilityLearnedEvent
  | ExperienceGainedEvent
  | LevelUpEvent
  | PostUnlockedEvent
  | ArticleBrokenEvent
  | ReprimandIssuedEvent
  | CourtMartialIssuedEvent
  | CommendedEvent
  | RewardGrantedEvent;

/**
 * The soldier an event concerns, or `undefined` for field-wide events such as
 * {@link BattleEndedEvent} and {@link RewardGrantedEvent}. Lets a renderer
 * easily bucket events by unit without a hand-written switch.
 */
export function eventUnitId(event: BattleEvent): UnitId | undefined {
  return "unitId" in event ? event.unitId : undefined;
}

/** Narrow a union member by kind, e.g. `isEventOfKind(event, "damaged")`. */
export function isEventOfKind<K extends EventKind>(
  event: BattleEvent,
  kind: K,
): event is Extract<BattleEvent, { kind: K }> {
  return event.kind === kind;
}

/* --------------------------------------------------------------------------
 * Runtime validation (replays, network, save files, tests)
 * ------------------------------------------------------------------------ */

/** Error thrown when a value is not a well-formed battle event. */
export class EventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EventError";
  }
}

/** Narrow an unknown value to a plain object bag for field inspection. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Non-negative whole number: coordinates, amounts and durations are exact. */
function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** Signed whole number (resource deltas, shove distance, ...). */
function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

/** A plain, JSON-safe tile position. */
function isCoord(value: unknown): value is Coord {
  return isRecord(value) && isInteger(value.x) && isInteger(value.y);
}

/** Only `undefined` or a valid non-empty id. */
function isOptionalId(value: unknown): boolean {
  return value === undefined || isValidId(value);
}

/** Closed-set membership for the shared vocabularies above. */
function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function isElementKey(value: unknown): value is ElementKey {
  return isOneOf(ELEMENT_KEYS, value);
}

/**
 * Whether `value` is a structurally valid {@link BattleEvent}.
 *
 * This checks **shape only**: kinds, id types, coordinate integrality and the
 * closed vocabularies. It cannot know whether an event is *true* of the world;
 * only the battle layer (T022) emits events, so use this at trust boundaries
 * (replay logs, network messages, test fixtures) before trusting a value.
 */
export function isBattleEvent(value: unknown): value is BattleEvent {
  if (!isRecord(value) || !isEventKind(value.kind) || !isNonNegativeInteger(value.tick)) {
    return false;
  }

  switch (value.kind) {
    case "battleStarted":
      return true;

    case "battleEnded":
      return isOneOf(BATTLE_OUTCOMES, value.outcome);

    case "unitDeployed":
      return isValidId(value.unitId) && isCoord(value.at) && isUnitSide(value.side);

    case "unitRemoved":
      return isValidId(value.unitId) && isOneOf(UNIT_REMOVAL_REASONS, value.reason);

    case "turnStarted":
    case "turnEnded":
      return isValidId(value.unitId);

    case "abilityLearned":
      return isValidId(value.unitId) && isValidId(value.abilityId);

    case "courtMartialIssued":
      return isValidId(value.unitId) && isValidId(value.articleId);

    case "chargeStarted":
      return (
        isValidId(value.unitId) &&
        isValidId(value.chargeId) &&
        isValidId(value.abilityId) &&
        isNonNegativeInteger(value.ticks) &&
        value.ticks >= 1
      );

    case "chargeResolved":
      return isValidId(value.unitId) && isValidId(value.chargeId) && isValidId(value.abilityId);

    case "moved":
      return (
        isValidId(value.unitId) &&
        isCoord(value.from) &&
        isCoord(value.to) &&
        Array.isArray(value.path) &&
        value.path.every(isCoord) &&
        isFacing(value.facing)
      );

    case "faced":
      return isValidId(value.unitId) && isFacing(value.from) && isFacing(value.to);

    case "shoved":
      return isValidId(value.unitId) && isCoord(value.from) && isCoord(value.to);

    case "abilityUsed":
      return (
        isValidId(value.unitId) &&
        isValidId(value.abilityId) &&
        isCoord(value.at) &&
        isOptionalId(value.targetId) &&
        isNonNegativeInteger(value.chargeTime)
      );

    case "abilityResolved":
      return (
        isValidId(value.unitId) &&
        isValidId(value.abilityId) &&
        isCoord(value.at) &&
        isOptionalId(value.targetId)
      );

    case "itemUsed":
      return (
        isValidId(value.unitId) &&
        isValidId(value.itemId) &&
        isCoord(value.at) &&
        isOptionalId(value.targetId)
      );

    case "reactionTriggered":
      return (
        isValidId(value.unitId) &&
        isValidId(value.abilityId) &&
        isOptionalId(value.sourceId) &&
        isCoord(value.at)
      );

    case "volleyStarted":
      return (
        isValidId(value.unitId) &&
        isValidId(value.abilityId) &&
        isCoord(value.at) &&
        isOptionalId(value.targetId) &&
        isNonNegativeInteger(value.honour)
      );

    case "volleyChained":
      return (
        isValidId(value.unitId) &&
        isValidId(value.abilityId) &&
        isCoord(value.at) &&
        isOptionalId(value.targetId)
      );

    case "guardSortieCalled":
      return isValidId(value.unitId) && isValidId(value.guardSortieId);

    case "damaged":
      return (
        isValidId(value.unitId) &&
        isOptionalId(value.sourceId) &&
        isOptionalId(value.abilityId) &&
        isNonNegativeInteger(value.amount) &&
        isNonNegativeInteger(value.hpAfter) &&
        isOneOf(DAMAGE_TYPES, value.damageType) &&
        (value.element === undefined || isElementKey(value.element)) &&
        typeof value.critical === "boolean" &&
        typeof value.fatal === "boolean"
      );

    case "healed":
      return (
        isValidId(value.unitId) &&
        isOptionalId(value.sourceId) &&
        isOptionalId(value.abilityId) &&
        isNonNegativeInteger(value.amount) &&
        isNonNegativeInteger(value.hpAfter)
      );

    case "missed":
      return (
        isValidId(value.unitId) && isOptionalId(value.sourceId) && isOptionalId(value.abilityId)
      );

    case "outOfAction":
      return isValidId(value.unitId) && isOptionalId(value.sourceId);

    case "revived":
      return (
        isValidId(value.unitId) &&
        isOptionalId(value.sourceId) &&
        isNonNegativeInteger(value.hpAfter)
      );

    case "mpChanged":
      return (
        isValidId(value.unitId) &&
        isInteger(value.delta) &&
        isNonNegativeInteger(value.mpAfter) &&
        isOneOf(MP_CHANGE_REASONS, value.reason)
      );

    case "honourChanged":
      return (
        isValidId(value.unitId) &&
        isInteger(value.delta) &&
        isNonNegativeInteger(value.honourAfter) &&
        isOneOf(HONOUR_CHANGE_REASONS, value.reason)
      );

    case "conditionApplied":
      return (
        isValidId(value.unitId) &&
        isValidId(value.conditionId) &&
        isNonNegativeInteger(value.duration) &&
        isOptionalId(value.sourceId)
      );

    case "conditionRemoved":
      return (
        isValidId(value.unitId) &&
        isValidId(value.conditionId) &&
        isOneOf(CONDITION_REMOVAL_REASONS, value.reason)
      );

    case "drillGained":
      return (
        isValidId(value.unitId) &&
        isValidId(value.abilityId) &&
        isNonNegativeInteger(value.amount) &&
        value.amount > 0 &&
        isNonNegativeInteger(value.drillAfter) &&
        typeof value.mastered === "boolean"
      );

    case "experienceGained":
      return (
        isValidId(value.unitId) &&
        isNonNegativeInteger(value.amount) &&
        isNonNegativeInteger(value.experienceAfter)
      );

    case "levelUp":
      return isValidId(value.unitId) && isNonNegativeInteger(value.level) && value.level >= 1;

    case "postUnlocked":
      return isValidId(value.unitId) && isValidId(value.postId);

    case "articleBroken":
      return (
        isValidId(value.unitId) &&
        isValidId(value.articleId) &&
        isOneOf(CARD_SEVERITIES, value.severity)
      );

    case "reprimandIssued":
      return (
        isValidId(value.unitId) &&
        isValidId(value.articleId) &&
        isNonNegativeInteger(value.reprimands)
      );

    case "commended":
      return isValidId(value.unitId) && isNonNegativeInteger(value.honour) && value.honour > 0;

    case "rewardGranted":
      return (
        isNonNegativeInteger(value.crowns) &&
        (value.equipmentIds === undefined ||
          (Array.isArray(value.equipmentIds) && value.equipmentIds.every(isValidId)))
      );
  }
}

/** Compact, human-readable description of a rejected value for error messages. */
function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return typeof value;
}

/**
 * Validate untrusted input and return it as a detached {@link BattleEvent}.
 *
 * Events are plain JSON data by construction, so this validates the shape and
 * then deep-clones through JSON, ensuring the caller cannot alias a nested
 * coordinate back into engine state. Throws {@link EventError} on malformed
 * input so a bad replay log fails at the boundary.
 *
 * ```ts
 * const event = parseEvent(JSON.parse(line), "replay[3]");
 * ```
 */
export function parseEvent(value: unknown, label = "event"): BattleEvent {
  if (!isBattleEvent(value)) {
    throw new EventError(`${label} is not a valid battle event (received ${describe(value)})`);
  }
  return JSON.parse(JSON.stringify(value)) as BattleEvent;
}

/* --------------------------------------------------------------------------
 * Serialisation
 * ------------------------------------------------------------------------ */

/**
 * Serialise an event to JSON. Events are plain data, so this is a thin, named
 * wrapper over `JSON.stringify` that documents the contract: the event stream
 * is text and can be logged, diffed and replayed.
 */
export function serializeEvent(event: BattleEvent): string {
  return JSON.stringify(event);
}

/** Parse and validate an event from JSON, throwing {@link EventError} on bad input. */
export function deserializeEvent(json: string): BattleEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new EventError("event JSON could not be parsed");
  }
  return parseEvent(parsed);
}
