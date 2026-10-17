/**
 * The Provost Marshal (T066) — FFTA's **Judge**, rethemed as the neutral
 * arbiter who polices the battlefield (mapping §1, §9).
 *
 * FFTA sends a Judge to every engagement:
 *
 * > Judges enforce the laws of Ivalice ... They award Judge Points to
 * > combatants who perform recommended actions, but also issue Yellow and Red
 * > Cards to any unit successfully performing forbidden actions. They also
 * > teleport all units that receive Red Cards to prison. ... Judges can also
 * > move corpses or petrified units out of the way to avoid battlefield
 * > gridlock. They cannot, however, enter Ivalice's three Jagds.
 * > — `docs/wiki/pages/Judge_(Tactics_Advance).md`
 *
 * Tactica keeps every one of those duties and puts a **Provost Marshal** on the
 * field (mapping §9). This module owns the *entity*: what the arbiter is, and
 * the two field actions it performs. It deliberately reuses the pure rules
 * primitives that already exist rather than re-deriving them:
 *
 * ```text
 *   createProvost({ id, power, at }) ──► a neutral, non-combatant Unit
 *        │
 *        ├─ isNonCombatant(unit) ──► true (side "neutral"; no one may attack it)
 *        ├─ isProvostUnit(unit)  ──► true (side neutral + the marshal post)
 *        └─ findProvost(units)   ──► the marshal deployed on a field
 *
 *   issueCard(context, request) ──► escalateBreach (T057) then, when the card is
 *        │                          red, applyCourtMartial (T058):
 *        │                            articleBroken
 *        │                              ├─ reprimand  ──► reprimandIssued
 *        │                              └─ courtMartial ──► courtMartialIssued
 *        │                                                   + unitRemoved
 *        │                                                   (+ battleEnded when
 *        │                                                      the commander falls)
 *        │
 *        └─ no Provost enters a No-Man's Land (T065), so a lawless field refuses
 *           every card before any roll
 *
 *   moveCasualty(context, request) ──► clear a corpse or petrified soldier to a
 *        │                              nearby free tile so the field cannot
 *        │                              deadlock on its own casualties
 *        └─ emits a `shoved` event (external displacement: the Provost drags
 *           the casualty, the casualty does not march)
 * ```
 *
 * ## Neutral, non-combatant
 *
 * The retheme already encodes the Judge's untouchability in the `"neutral"`
 * side (`engine/unit.ts`, mapping §9): `targeting.areHostile` is false against
 * a neutral actor, so no combat action may name the marshal as a target, and
 * `objectives.ts` never counts the arbiter toward either side. This module adds
 * no new combat flag — {@link isNonCombatant} is simply the neutral-side test,
 * and there is exactly one definition of "the Provost" ({@link isProvostUnit},
 * the neutral marshal post).
 *
 * ## What this module does not own
 *
 * - **Generation** — which Articles a day carries
 *   ({@link import("./rules/articles").generateDailyArticles}, T055).
 * - **Detection** — whether a resolved action broke an Article
 *   ({@link import("./rules/articles").detectArticles}, T056).
 * - **Escalation policy** — the Yellow/Red decision
 *   ({@link import("./rules/articles").escalateBreach}, T057) and the removal a
 *   Red Card causes ({@link import("./rules/articles").applyCourtMartial},
 *   T058). The Provost *invokes* those primitives; it does not restate them.
 * - **Whose Orders Tempo turn it is** — the arbiter acts out of band, between
 *   turns, exactly as FFTA's Judge does. The battle layer decides *when* to ask.
 *
 * ## Contracts (`agents.md` §2, §7, §9)
 *
 * - **Pure & deterministic** — no DOM, no I/O, no `Math.random`, no `Date`.
 *   The same context and request always yield byte-identical units and events.
 * - **State in, state out** — inputs are read, never written; a new roster and
 *   event list are returned (structural sharing is fine).
 * - **Data-driven** — the marshal post, casualty conditions and search range
 *   live as named constants; no unit id is special-cased.
 * - **Integer only** — ticks and coordinates are whole numbers, so replays
 *   never drift.
 *
 * Reference: `docs/wiki/pages/Judge_(Tactics_Advance).md` (the Judge's duties),
 * `docs/wiki/pages/Law_system_(Tactics_Advance).md` (cards and Jagds) and
 * `docs/NAPOLEONIC_MAPPING.md` §1, §9.
 */

import type { ArticleDef, PowerKey, StatBlock } from "../data/schema";
import type { BattleEvent, BattleOutcome } from "./events";
import {
  coordEquals,
  coordKey,
  inBounds,
  manhattanDistance,
  type Coord,
  type Facing,
} from "./grid";
import {
  asArticleId,
  asConditionId,
  asPostId,
  type ArticleId,
  type PostId,
  type UnitId,
} from "./ids";
import {
  applyCourtMartial,
  escalateBreach,
  isCommissioned,
  type ArticleRecord,
  type CardDecision,
  type Commissions,
} from "./rules/articles";
import { hasProvost, type Battlefield } from "./rules/noMansLand";
import { getTerrainDef, terrainTileAt, type TerrainMap } from "./terrain";
import { createUnit, hasCondition, isOutOfAction, withPosition, type Unit } from "./unit";

/* --------------------------------------------------------------------------
 * Tunables & identity (Phase 13 owns the final balance pass)
 * ------------------------------------------------------------------------ */

/**
 * The mechanical post id of the arbiter. There is no authored `PostDef` for it:
 * the Provost is a field role, not a recruitable career, so the id is a stable
 * engine handle rather than a `src/data/posts` entry. Keeping it here (and
 * forcing it in {@link createProvost}) is what makes {@link isProvostUnit}
 * reliable without special-casing any unit id.
 */
export const PROVOST_POST_ID: PostId = asPostId("provost-marshal");

/** Player-facing name of the arbiter when none is supplied. */
export const PROVOST_NAME = "Provost Marshal";

/**
 * Authored stat block for the marshal. Attack is **zero** on purpose — the
 * arbiter does not fight — while Move/Climb match the reference's Judge (Move
 * Rate 3, Jump Rate 2). These are re-authored balance values, not scraped
 * numbers (`agents.md` §3, §10).
 */
export const PROVOST_STATS: StatBlock = {
  hp: 40,
  mp: 0,
  atk: 0,
  def: 6,
  mag: 0,
  res: 6,
  spd: 8,
  move: 3,
  jump: 2,
};

/**
 * How far the Provost may clear a casualty from its tile. Matches the
 * marshal's Move Rate: it nudges bodies aside, it does not march them across
 * the field. Authored balance, inspired by the reference's "out of the way to
 * avoid battlefield gridlock" (`Judge_(Tactics_Advance).md`).
 */
export const CASUALTY_CLEAR_RANGE = 3;

/**
 * The condition the reference names as a body the Judge will clear: **Petrify**
 * — the retheme's "Broken" (`src/data/conditions.ts`, mapping §8), whose own
 * description reads "counts as a casualty".
 */
export const PETRIFIED_CONDITION_ID = asConditionId("petrify");

/* --------------------------------------------------------------------------
 * The entity
 * ------------------------------------------------------------------------ */

/**
 * Authoring input for {@link createProvost}. The neutral side, the marshal post
 * and the "cannot fight" contract are forced by the constructor; the caller
 * supplies what is actually theirs to choose.
 */
export interface ProvostInit {
  /** Stable, branded identity. */
  readonly id: UnitId;
  /**
   * The marshal's nominal home army. It is fiction only: neutrality is a
   * property of the **side**, not the power, so the arbiter is hostile to no
   * one whichever school commissioned it.
   */
  readonly power: PowerKey;
  /** Tile the marshal stands on. */
  readonly at: Coord;
  /** Player-facing name; defaults to {@link PROVOST_NAME}. */
  readonly name?: string;
  /** Experience level; defaults to `1`. */
  readonly level?: number;
  /** Initial facing; defaults to north (via `createUnit`). */
  readonly facing?: Facing;
  /** Override the authored {@link PROVOST_STATS} (tests, scenario variants). */
  readonly stats?: StatBlock;
}

/**
 * Build the neutral, non-combatant arbiter.
 *
 * The returned value is an ordinary {@link Unit} — so it can be deployed,
 * drawn and fed to the same rules as any soldier — but its `side` is forced to
 * `"neutral"` and its `postId` to {@link PROVOST_POST_ID}. Neutral units are
 * excluded from hostility (`targeting.areHostile`) and from objective scoring
 * (`objectives.ts`), which is exactly the Judge's untouchability.
 *
 * ```ts
 * const marshal = createProvost({ id: asUnitId("provost"), power: "france", at: coord(0, 0) });
 * ```
 */
export function createProvost(init: ProvostInit): Unit {
  if (init === null || typeof init !== "object") {
    throw new RangeError("provost init must be an object");
  }
  return createUnit({
    id: init.id,
    name: init.name ?? PROVOST_NAME,
    power: init.power,
    postId: PROVOST_POST_ID,
    side: "neutral",
    level: init.level ?? 1,
    at: init.at,
    ...(init.facing !== undefined ? { facing: init.facing } : {}),
    stats: init.stats ?? PROVOST_STATS,
  });
}

/**
 * Whether a unit is **non-combatant**: it fights for no one and no hostile
 * action may name it. The retheme's one marker is the `"neutral"` side
 * (`engine/unit.ts`), shared by the Provost Marshal and other arbiters.
 */
export function isNonCombatant(unit: { readonly side: string }): boolean {
  return unit.side === "neutral";
}

/**
 * Whether a unit is *the* Provost Marshal: neutral **and** posted as the
 * arbiter. Prefer this over {@link isNonCombatant} when the distinction
 * matters; use {@link isNonCombatant} for the general "cannot be attacked"
 * rule.
 */
export function isProvostUnit(unit: Unit): boolean {
  return unit.side === "neutral" && unit.postId === PROVOST_POST_ID;
}

/** The first Provost Marshal deployed in `units`, or `undefined` when none. */
export function findProvost(units: readonly Unit[]): Unit | undefined {
  return units.find(isProvostUnit);
}

/**
 * Whether `unit` is a **casualty** the Provost will clear: out of action
 * (FFTA KO, HP `<= 0`) or **Petrified** — the retheme's "Broken"
 * (`Judge_(Tactics_Advance).md`: "move corpses or petrified units out of the
 * way"). A standing soldier is never a casualty.
 */
export function isCasualty(unit: Unit): boolean {
  return isOutOfAction(unit) || hasCondition(unit, PETRIFIED_CONDITION_ID);
}

/* --------------------------------------------------------------------------
 * Card issuance (T057 escalation + T058 removal)
 * ------------------------------------------------------------------------ */

/** Why the Provost could not act at all. A closed set so callers can branch. */
export const PROVOST_ABSENCE_REASONS = ["lawless", "no-provost"] as const;
export type ProvostAbsenceReason = (typeof PROVOST_ABSENCE_REASONS)[number];

/** Runtime guard for untrusted absence-reason strings (replays, logs). */
export function isProvostAbsenceReason(value: unknown): value is ProvostAbsenceReason {
  return (
    typeof value === "string" && (PROVOST_ABSENCE_REASONS as readonly string[]).includes(value)
  );
}

/**
 * The field as the Provost sees it when it rules or clears: the legal regime, a
 * terrain map for casualty clearing, the deployed soldiers and the Orders Tempo
 * tick. Following {@link import("./rules/articles").CourtMartialContext} and
 * {@link import("./rules/shove").ShoveContext}, this is a small structural view
 * rather than the whole `BattleState`, so the module stays free of the state
 * machine (`agents.md` §7).
 */
export interface ProvostContext {
  /** The region's legal setting; a No-Man's Land has no Provost (T065). */
  readonly field: Battlefield;
  /** Every soldier currently on the field, including the marshal itself. */
  readonly units: readonly Unit[];
  /** The battlefield geometry, used when clearing a casualty. */
  readonly map: TerrainMap;
  /** Orders Tempo tick to stamp events with; defaults to `0`. */
  readonly tick?: number;
  /** The company commander's soldier id, for the Red Card game-over rule. */
  readonly commanderId?: UnitId;
  /** Soldiers holding a **Commission** (hero medal), immune to removal (T059). */
  readonly commissions?: Commissions;
}

/** One breach for the Provost to rule on. */
export interface ProvostRulingRequest {
  /** The soldier found to have broken the Article. */
  readonly unitId: UnitId;
  /** The forbidding Article of War that was broken. */
  readonly article: ArticleDef;
  /**
   * The offender's record at the moment of judgement (reprimands carried so
   * far, whether the breach scored a knockout). The Provost adds the
   * Commission shield itself, so a caller need not duplicate `commissions`.
   */
  readonly record: ArticleRecord;
}

/** What the Provost ruled on one breach. */
export interface ProvostRulingResult {
  /** `false` when the marshal was absent and issued nothing. */
  readonly ok: boolean;
  /** The roster after the ruling (a Red Card removes the offender). */
  readonly units: readonly Unit[];
  /** Ordered events: `articleBroken`, then the card (and removal). */
  readonly events: readonly BattleEvent[];
  /** The escalation decision; present only when a card was issued. */
  readonly card?: CardDecision;
  /** The breached Article's id, branded; present only when a card was issued. */
  readonly articleId?: ArticleId;
  /** Reprimands on the offender's record **after** the ruling. */
  readonly reprimands?: number;
  /** The soldier a Red Card removed, when one did. */
  readonly removed?: Unit;
  /** `true` when the removed soldier was the company commander. */
  readonly commander: boolean;
  /** `companyDefeat` when the commander was removed; otherwise `null`. */
  readonly outcome: BattleOutcome | null;
  /** `true` when the ruling concluded the action. */
  readonly finished: boolean;
  /** `true` when a Commission (T059) stayed a removal. */
  readonly immune: boolean;
  /** Why no card was issued; present only when {@link ok} is `false`. */
  readonly reason?: ProvostAbsenceReason;
}

/**
 * The Provost rules on one breach: it escalates the offence
 * ({@link escalateBreach}, T057) and, when the card is red, enforces the
 * removal ({@link applyCourtMartial}, T058).
 *
 * A **Commission** (T059) held by the offender is folded into the record here,
 * so a hero always draws a Reprimand and is never removed — even if the caller
 * passed a clean record and a grave Article.
 *
 * A **No-Man's Land** (T065) has no Provost, and an ordinary field with no
 * marshal deployed has no one to rule, so both return `ok: false` with an
 * {@link ProvostAbsenceReason} and change nothing. Those are in-world
 * conditions; a malformed tick, an unknown offender or a commend Article
 * (nothing to breach) are programmer faults and throw.
 *
 * ```ts
 * const ruling = issueCard(context, {
 *   unitId: offender.id,
 *   article: ARTICLES["no-fire"],
 *   record: { reprimands: 0 },
 * });
 * if (ruling.ok) units = ruling.units;
 * ```
 */
export function issueCard(
  context: ProvostContext,
  request: ProvostRulingRequest,
): ProvostRulingResult {
  const tick = context.tick ?? 0;
  assertTick(tick);
  assertProvostContext(context);

  // A No-Man's Land is the one place Judges will not go; no card can be issued.
  if (!hasProvost(context.field)) {
    return absenceResult(context.units, "lawless");
  }
  if (findProvost(context.units) === undefined) {
    return absenceResult(context.units, "no-provost");
  }

  const offender = context.units.find((unit) => unit.id === request.unitId);
  if (offender === undefined) {
    throw new RangeError(`no soldier ${request.unitId} is on the field for the Provost to rule on`);
  }

  // Fold the Commission shield in: a hero may bank Reprimands but never leaves.
  const commissioned =
    isCommissioned(context.commissions, request.unitId) || request.record.commissioned === true;
  const record: ArticleRecord = {
    reprimands: request.record.reprimands,
    ...(request.record.illegalKo !== undefined ? { illegalKo: request.record.illegalKo } : {}),
    ...(commissioned ? { commissioned: true } : {}),
  };

  // `escalateBreach` validates the Article is a forbidding one.
  const card = escalateBreach(request.article, record);
  const articleId = asArticleId(request.article.id);

  const events: BattleEvent[] = [
    { kind: "articleBroken", tick, unitId: offender.id, articleId, severity: card.severity },
  ];

  if (card.severity === "reprimand") {
    events.push({
      kind: "reprimandIssued",
      tick,
      unitId: offender.id,
      articleId,
      reprimands: card.reprimands,
    });
    return {
      ok: true,
      units: context.units,
      events,
      card,
      articleId,
      reprimands: card.reprimands,
      commander: false,
      outcome: null,
      finished: false,
      immune: commissioned,
    };
  }

  // Red Card: the offender leaves the field (T058), and a commander's removal
  // ends the action in defeat.
  const ruling = applyCourtMartial(
    {
      units: context.units,
      tick,
      ...(context.commanderId !== undefined ? { commanderId: context.commanderId } : {}),
      ...(context.commissions !== undefined ? { commissions: context.commissions } : {}),
    },
    { unitId: offender.id, articleId },
  );
  events.push(...ruling.events);

  return {
    ok: true,
    units: ruling.units,
    events,
    card,
    articleId,
    reprimands: card.reprimands,
    ...(ruling.removed !== undefined ? { removed: ruling.removed } : {}),
    commander: ruling.commander,
    outcome: ruling.outcome,
    finished: ruling.finished,
    immune: ruling.immune,
  };
}

/** Build the no-op result returned when the Provost cannot act at all. */
function absenceResult(units: readonly Unit[], reason: ProvostAbsenceReason): ProvostRulingResult {
  return {
    ok: false,
    units,
    events: [],
    commander: false,
    outcome: null,
    finished: false,
    immune: false,
    reason,
  };
}

/* --------------------------------------------------------------------------
 * Clearing casualties
 * ------------------------------------------------------------------------ */

/**
 * Why the Provost could not clear a casualty. A superset of
 * {@link PROVOST_ABSENCE_REASONS} with the field reasons a specific
 * destination can be refused.
 */
export const CASUALTY_CLEAR_REFUSALS = [
  "lawless",
  "no-provost",
  "blocked",
  "occupied",
  "impassable",
  "out-of-bounds",
] as const;
export type CasualtyClearRefusal = (typeof CASUALTY_CLEAR_REFUSALS)[number];

/** Runtime guard for untrusted refusal strings (replays, logs). */
export function isCasualtyClearRefusal(value: unknown): value is CasualtyClearRefusal {
  return (
    typeof value === "string" && (CASUALTY_CLEAR_REFUSALS as readonly string[]).includes(value)
  );
}

/** What to clear, and optionally where to clear it to. */
export interface CasualtyClearRequest {
  /** The casualty (out of action or Petrified) to move aside. */
  readonly unitId: UnitId;
  /**
   * An exact destination. When omitted the Provost picks the nearest free,
   * passable tile within {@link CASUALTY_CLEAR_RANGE}. Supplying one lets a
   * scripted scene place a body precisely.
   */
  readonly to?: Coord;
}

/** The outcome of {@link moveCasualty}. */
export interface CasualtyClearResult {
  /** `false` when the casualty could not be cleared (nothing changed). */
  readonly ok: boolean;
  /** The roster after the move, or the input roster unchanged on refusal. */
  readonly units: readonly Unit[];
  /** A `shoved` event describing the displacement, when one happened. */
  readonly events: readonly BattleEvent[];
  /** The casualty after the move; present only when it moved. */
  readonly moved?: Unit;
  /** The tile the casualty was cleared from; present only when it moved. */
  readonly from?: Coord;
  /** The tile the casualty was cleared to; present only when it moved. */
  readonly to?: Coord;
  /** Why the casualty was not cleared; present only when {@link ok} is `false`. */
  readonly reason?: CasualtyClearRefusal;
}

/**
 * Clear a corpse or petrified soldier out of the way so the field cannot
 * deadlock on its own casualties (`Judge_(Tactics_Advance).md`: "move corpses
 * or petrified units out of the way to avoid battlefield gridlock").
 *
 * The displacement is reported as a **`shoved`** event because it is an
 * external move: the Provost drags the body, the casualty does not march. The
 * casualty's facing is unchanged.
 *
 * With no `to`, the Provost chooses the nearest free, passable tile (ties
 * broken north→south, west→east for determinism) within
 * {@link CASUALTY_CLEAR_RANGE}. A named destination is honoured only if it is
 * on the map, passable and unoccupied; otherwise the request is refused with
 * the matching reason.
 *
 * A No-Man's Land — no Provost — refuses outright, as does a field with no
 * marshal deployed. A malformed tick, an unknown soldier or a soldier who is
 * not actually a casualty are programmer faults and throw.
 *
 * ```ts
 * const cleared = moveCasualty(context, { unitId: downed.id });
 * if (cleared.ok) units = cleared.units;
 * ```
 */
export function moveCasualty(
  context: ProvostContext,
  request: CasualtyClearRequest,
): CasualtyClearResult {
  const tick = context.tick ?? 0;
  assertTick(tick);
  assertProvostContext(context);

  if (!hasProvost(context.field)) {
    return { ok: false, units: context.units, events: [], reason: "lawless" };
  }
  if (findProvost(context.units) === undefined) {
    return { ok: false, units: context.units, events: [], reason: "no-provost" };
  }

  const casualty = context.units.find((unit) => unit.id === request.unitId);
  if (casualty === undefined) {
    throw new RangeError(`no soldier ${request.unitId} is on the field to clear`);
  }
  if (!isCasualty(casualty)) {
    throw new RangeError(`soldier ${request.unitId} is not a casualty and will not be moved aside`);
  }

  let destination: Coord | undefined;
  if (request.to !== undefined) {
    const to = request.to;
    if (!Number.isInteger(to.x) || !Number.isInteger(to.y)) {
      throw new RangeError(
        `casualty destination must be integer coordinates, received { x: ${to.x}, y: ${to.y} }`,
      );
    }
    if (!inBounds(context.map.grid, to)) {
      return { ok: false, units: context.units, events: [], reason: "out-of-bounds" };
    }
    if (coordEquals(to, casualty.at)) {
      // Already on the requested tile: nothing to do, but not an error.
      return {
        ok: true,
        units: context.units,
        events: [],
        moved: casualty,
        from: { ...casualty.at },
        to: { ...casualty.at },
      };
    }
    if (isOccupied(context.units, to, casualty.id)) {
      return { ok: false, units: context.units, events: [], reason: "occupied" };
    }
    if (!isPassableAt(context.map, to)) {
      return { ok: false, units: context.units, events: [], reason: "impassable" };
    }
    destination = { x: to.x, y: to.y };
  } else {
    destination = findClearTile(context, casualty);
    if (destination === undefined) {
      return { ok: false, units: context.units, events: [], reason: "blocked" };
    }
  }

  const moved = withPosition(casualty, destination);
  const units = context.units.map((unit) => (unit.id === casualty.id ? moved : unit));
  const events: BattleEvent[] = [
    {
      kind: "shoved",
      tick,
      unitId: casualty.id,
      from: { x: casualty.at.x, y: casualty.at.y },
      to: { x: destination.x, y: destination.y },
    },
  ];

  return {
    ok: true,
    units,
    events,
    moved,
    from: { x: casualty.at.x, y: casualty.at.y },
    to: { x: destination.x, y: destination.y },
  };
}

/**
 * The nearest free, passable tile a casualty can be cleared to, or `undefined`
 * when none lies within {@link CASUALTY_CLEAR_RANGE}. The search scans the map
 * row-major and sorts by `(distance, y, x)`, so the choice is deterministic and
 * independent of the roster's order.
 *
 * Exported so a scenario or the UI can preview where a body would be moved.
 */
export function findClearTile(context: ProvostContext, casualty: Unit): Coord | undefined {
  const { map, units } = context;
  const candidates: { readonly at: Coord; readonly distance: number }[] = [];

  for (let y = 0; y < map.grid.height; y++) {
    for (let x = 0; x < map.grid.width; x++) {
      const at: Coord = { x, y };
      if (coordEquals(at, casualty.at)) continue; // the casualty's own tile
      if (isOccupied(units, at, casualty.id)) continue;
      if (!isPassableAt(map, at)) continue;
      candidates.push({ at, distance: manhattanDistance(casualty.at, at) });
    }
  }

  candidates.sort((a, b) => a.distance - b.distance || a.at.y - b.at.y || a.at.x - b.at.x);
  const best = candidates[0];
  if (best === undefined || best.distance > CASUALTY_CLEAR_RANGE) return undefined;
  return { x: best.at.x, y: best.at.y };
}

/* --------------------------------------------------------------------------
 * Internals
 * ------------------------------------------------------------------------ */

/** Whether a tile is held by any soldier other than `ignoreId`. */
function isOccupied(units: readonly Unit[], at: Coord, ignoreId: UnitId): boolean {
  const key = coordKey(at);
  return units.some((unit) => unit.id !== ignoreId && coordKey(unit.at) === key);
}

/** Whether a tile can hold a body: on the map and passable terrain. */
function isPassableAt(map: TerrainMap, at: Coord): boolean {
  if (!inBounds(map.grid, at)) return false;
  return getTerrainDef(terrainTileAt(map, at).terrain).passable;
}

/** Orders Tempo ticks are non-negative integers (`agents.md` §2). */
function assertTick(tick: number): void {
  if (!Number.isInteger(tick) || tick < 0) {
    throw new RangeError(`provost tick must be a non-negative integer, received ${String(tick)}`);
  }
}

/** Fail fast on a malformed context rather than silently misreading it. */
function assertProvostContext(context: ProvostContext): void {
  if (context === null || typeof context !== "object") {
    throw new RangeError("provost context must be an object");
  }
  const field = context.field;
  if (field === null || typeof field !== "object") {
    throw new RangeError("provost context must provide a battlefield");
  }
  if (typeof field.lawless !== "boolean") {
    throw new RangeError("provost context battlefield must have a boolean lawless flag");
  }
  if (!Array.isArray(context.units)) {
    throw new RangeError("provost context units must be an array");
  }
  const map = context.map;
  if (map === null || typeof map !== "object" || !Array.isArray(map.tiles)) {
    throw new RangeError("provost context must provide a terrain map");
  }
}
