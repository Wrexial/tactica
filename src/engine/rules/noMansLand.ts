/**
 * No-Man's Land (T065) — FFTA's **Jagd**, rethemed as the lawless ground
 * between the lines (mapping §1, §9).
 *
 * The reference is explicit about what a Jagd changes
 * (`docs/wiki/pages/Jagd.md`, `docs/wiki/pages/Final_Fantasy_Tactics_Advance.md`
 * §"Jagds"):
 *
 * > Although Laws govern the majority of Ivalice, there are three lawless
 * > locations called jagds, which judges avoid. No actions are forbidden, nor
 * > can Judge Points be earned. A character that is KO'd in these locations
 * > will, unless revived before the end of the battle, permanently leave the
 * > party (and in the case of Marche, a Game Over will occur).
 *
 * Mapping §9 fixes the retheme in one line:
 *
 * > **No-Man's Land** = Jagd: no provost, no Honour, KO is permanent,
 * > commander's KO is defeat.
 *
 * This module is the **policy** the rest of the engine asks about a region:
 * does a Provost Marshal stand here? are Articles in force? may a soldier earn
 * Honour? what happens to the fallen after the smoke clears? It deliberately
 * owns no battle state of its own — a {@link Battlefield} is a tiny,
 * JSON-safe descriptor naming the region and whether it is lawless, and every
 * helper is a pure function over that value plus ordinary engine values.
 *
 * ```text
 *   createNoMansLand(regionId) ──► Battlefield { lawless: true }
 *        │
 *        ├─ hasProvost() / articlesInForce() ──► false  (no Judge, no Articles)
 *        ├─ createFieldOrders(field, articles)  ──► BattleOrders { lawless: true }
 *        │                                          with every Article dropped
 *        ├─ canEarnHonour() / resolveFieldHonour() ──► no Honour award
 *        ├─ koIsPermanent() / resolveAftermath()   ──► KO'd men are lost
 *        └─ commanderKoEndsCampaign() / resolveKnockout()
 *                                  ──► commander's KO ends the campaign
 * ```
 *
 * ## Why a `Battlefield` value and not a `BattleState` field
 *
 * The battle state machine (T022) is deliberately free of campaign concepts.
 * A region's regime is a property of the **theatre**, decided before a battle
 * is built, so it travels as a small value that content and the campaign layer
 * own (T068, T073) and the battle layer reads. Following
 * {@link import("./articles").CourtMartialContext}, the helpers take narrow
 * structural views rather than the whole `BattleState`, so this rules module
 * stays free of the state machine (`agents.md` §7).
 *
 * ## When is a KO permanent?
 *
 * FFTA gives the player until the **end of the battle** to revive a fallen
 * soldier ("unless revived before the end of the battle"). Permanence is
 * therefore resolved **after** the fighting, by {@link resolveAftermath}: a
 * soldier still out of action when the battle ends is lost; one who was brought
 * back (HP `> 0`) stays with the company. The commander is the exception —
 * their KO ends the campaign at once.
 *
 * ## Contracts (`agents.md` §2, §7, §9)
 *
 * - **Pure & deterministic** — no DOM, no I/O, no `Math.random`, no `Date`.
 *   The same field, roster and request always produce byte-identical results.
 * - **State in, state out** — inputs are read, never written; the resolvers
 *   return new event lists (structural sharing of units is fine).
 * - **Data-driven** — no Article, post, power or unit id is special-cased. The
 *   only rule is the region's `lawless` flag.
 * - **Integer only** — the Orders Tempo tick is a non-negative whole number,
 *   so a replay never drifts.
 *
 * Reference: `docs/wiki/pages/Jagd.md` and
 * `docs/wiki/pages/Final_Fantasy_Tactics_Advance.md` §"Jagds". Fiction:
 * `docs/NAPOLEONIC_MAPPING.md` §1 and §9.
 */

import type { ArticleDef } from "../../data/schema";
import { createBattleOrders, type BattleOrders } from "../actions/orders";
import type { BattleEvent, BattleOutcome } from "../events";
import { isValidId, type RegionId, type UnitId } from "../ids";
import { isOutOfAction, type Unit } from "../unit";
import { resolveHonourEvent, type HonourChangeResult, type HonourEvent } from "./honour";

/* --------------------------------------------------------------------------
 * The battlefield's legal regime
 * ------------------------------------------------------------------------ */

/**
 * The two legal regimes a region can be under, named for save files and UI.
 * `"articles"` is ordinary ground where a Provost Marshal enforces the day's
 * standing orders; `"noMansLand"` is a lawless Jagd.
 */
export const BATTLEFIELD_REGIMES = ["articles", "noMansLand"] as const;
export type BattlefieldRegime = (typeof BATTLEFIELD_REGIMES)[number];

/** Runtime guard for untrusted regime strings (saves, network). */
export function isBattlefieldRegime(value: unknown): value is BattlefieldRegime {
  return typeof value === "string" && (BATTLEFIELD_REGIMES as readonly string[]).includes(value);
}

/**
 * A battlefield's legal setting as the No-Man's Land rules see it: which region
 * it is, and whether that region is lawless. It is a plain value so it can be
 * serialised, carried by the campaign map and compared cheaply; build it with
 * {@link createNoMansLand} / {@link createArticlesField} rather than by hand.
 */
export interface Battlefield {
  /** The campaign-map region the action is fought in. */
  readonly regionId: RegionId;
  /**
   * `true` in a No-Man's Land (FFTA Jagd): no Provost, no Articles, no Honour,
   * permanent losses. `false` on ordinary ground.
   */
  readonly lawless: boolean;
}

/**
 * Build a {@link Battlefield} for an ordinary region, where a Provost Marshal
 * enforces the day's Articles. Pure sugar so callers never hand-build the
 * object shape.
 */
export function createArticlesField(regionId: RegionId): Battlefield {
  return createBattlefield(regionId, false);
}

/**
 * Build a {@link Battlefield} for a lawless **No-Man's Land** (FFTA Jagd). No
 * Provost stands here, no Articles are in force, no Honour can be earned and
 * the fallen do not get up again.
 */
export function createNoMansLand(regionId: RegionId): Battlefield {
  return createBattlefield(regionId, true);
}

/**
 * Build a {@link Battlefield} from a region and its `lawless` flag. Prefer the
 * named {@link createNoMansLand} / {@link createArticlesField} constructors;
 * this is the shared implementation and the validation boundary.
 *
 * @throws RangeError when the region id is empty or `lawless` is not a boolean.
 */
export function createBattlefield(regionId: RegionId, lawless = false): Battlefield {
  assertRegionId(regionId);
  assertLawless(lawless);
  return { regionId, lawless };
}

/**
 * Whether `region` is a No-Man's Land. The single predicate every rule below
 * derives from, so the mapping's "lawless" test has exactly one definition.
 */
export function isNoMansLand(field: Battlefield): boolean {
  return field.lawless;
}

/** The region's regime as a labelled, serialisable string. */
export function regimeOf(field: Battlefield): BattlefieldRegime {
  return isNoMansLand(field) ? "noMansLand" : "articles";
}

/* --------------------------------------------------------------------------
 * No Provost, no Articles
 * ------------------------------------------------------------------------ */

/**
 * Whether a Provost Marshal (FFTA Judge) stands on this field. A No-Man's Land
 * is exactly the place judges will not go, so there is no arbiter to issue
 * Reprimands or Court-Martials.
 */
export function hasProvost(field: Battlefield): boolean {
  return !isNoMansLand(field);
}

/**
 * Whether Articles of War are in force on this field. Ordinary ground carries
 * the day's posting; a No-Man's Land has none.
 */
export function articlesInForce(field: Battlefield): boolean {
  return !isNoMansLand(field);
}

/**
 * Build the {@link BattleOrders} for a field. In a No-Man's Land the posting is
 * **always empty** and lawless, even if a caller supplies a day's Articles —
 * the region overrides them, exactly as FFTA's Jagds ignore the Ivalice law
 * list. On ordinary ground the supplied Articles are posted unchanged.
 *
 * The returned board is the same shape {@link import("../actions/orders")}
 * already consumes, so order cards and General Orders naturally refuse to add
 * to a lawless field via their `"lawless"` reason.
 *
 * ```ts
 * createFieldOrders(createNoMansLand(region), ARTICLE_LIST).articles; // []
 * ```
 */
export function createFieldOrders(
  field: Battlefield,
  articles: readonly ArticleDef[] = [],
): BattleOrders {
  assertBattlefield(field);
  if (isNoMansLand(field)) {
    // No Provost, no Articles: drop any supplied posting outright.
    return createBattleOrders([], { lawless: true });
  }
  return createBattleOrders(articles, { lawless: false });
}

/* --------------------------------------------------------------------------
 * No Honour
 * ------------------------------------------------------------------------ */

/**
 * Whether a soldier may earn **Honour** (FFTA Judge Points) on this field. "No
 * actions are forbidden, nor can Judge Points be earned" in a Jagd, so a
 * No-Man's Land grants no Honour for legal KOs or commended acts.
 */
export function canEarnHonour(field: Battlefield): boolean {
  return !isNoMansLand(field);
}

/**
 * Resolve the Honour a single event earns on a field, applying the region's
 * gate. On ordinary ground this is exactly {@link resolveHonourEvent} (T060);
 * in a No-Man's Land it is a no-op returning the same unit and no events, so
 * the T060 award rules, cap and no-stacking behaviour are untouched.
 *
 * ```ts
 * resolveFieldHonour(actor, jagd, { legalKo: true }, tick); // no award
 * ```
 */
export function resolveFieldHonour(
  unit: Unit,
  field: Battlefield,
  event: HonourEvent,
  tick = 0,
): HonourChangeResult {
  assertBattlefield(field);
  if (!canEarnHonour(field)) {
    return { unit, amount: 0, events: [] };
  }
  return resolveHonourEvent(unit, event, tick);
}

/* --------------------------------------------------------------------------
 * Knockouts (permanent loss and the commander)
 * ------------------------------------------------------------------------ */

/**
 * Whether a knockout on this field is **permanent** — true in a No-Man's Land.
 * This is the field-level rule; whether a particular fallen soldier is actually
 * lost is settled at battle's end by {@link resolveAftermath}.
 */
export function koIsPermanent(field: Battlefield): boolean {
  return isNoMansLand(field);
}

/**
 * Whether the commander's knockout **ends the campaign** — true in a No-Man's
 * Land. FFTA: "in the case of Marche, a Game Over will occur"; the retheme's
 * company commander dying in a Jagd ends the run, not just the action.
 */
export function commanderKoEndsCampaign(field: Battlefield): boolean {
  return isNoMansLand(field);
}

/**
 * Whether `unit` is a **permanent loss** on this field: out of action in a
 * No-Man's Land. A soldier who was revived (HP `> 0`) is not a loss, matching
 * FFTA's "unless revived before the end of the battle".
 */
export function isPermanentLoss(field: Battlefield, unit: Unit): boolean {
  assertBattlefield(field);
  return isNoMansLand(field) && isOutOfAction(unit);
}

/**
 * The field as the knockout rules see it: the deployed soldiers, the Orders
 * Tempo tick to stamp events with, and — when the action has one — the company
 * commander. Following {@link import("./articles").CourtMartialContext}, this
 * is a small structural view rather than the whole `BattleState`.
 */
export interface KnockoutContext {
  /** The region's legal setting. */
  readonly field: Battlefield;
  /** Every soldier currently on the field. */
  readonly units: readonly Unit[];
  /** Orders Tempo tick the knockout resolves on; defaults to `0`. */
  readonly tick?: number;
  /**
   * The company commander's soldier id. A commander's knockout in a No-Man's
   * Land ends the campaign in defeat; omitted for a detached action with no
   * commander present.
   */
  readonly commanderId?: UnitId;
}

/** Which soldier was knocked out, and (when known) by whom. */
export interface KnockoutRequest {
  /** The soldier who has been knocked out (must be out of action). */
  readonly unitId: UnitId;
  /** Who dealt the fatal blow, when known. */
  readonly sourceId?: UnitId;
}

/** The result of resolving one knockout. */
export interface KnockoutResult {
  /**
   * The field after the knockout — unchanged, because KO'd soldiers remain on
   * the field as casualties until the battle ends. Returned so callers can fold
   * it back uniformly, mirroring {@link import("./articles").applyCourtMartial}.
   */
  readonly units: readonly Unit[];
  /** Ordered events: `outOfAction`, then `battleEnded` when the commander fell. */
  readonly events: readonly BattleEvent[];
  /** The soldier who was knocked out. */
  readonly knockedOut: Unit;
  /** `true` when the fallen soldier is the company commander. */
  readonly commander: boolean;
  /** `true` in a No-Man's Land, where the knockout will be permanent. */
  readonly permanent: boolean;
  /** `true` when the commander's knockout ends the whole campaign. */
  readonly campaignOver: boolean;
  /** `true` when the ruling concluded the action. */
  readonly finished: boolean;
  /** `companyDefeat` when the campaign ends; otherwise `null`. */
  readonly outcome: BattleOutcome | null;
}

/**
 * Resolve a knockout: announce it with `outOfAction` and, when the fallen
 * soldier is the company commander on a lawless field, end the campaign at once
 * in defeat (`battleEnded`, `companyDefeat`).
 *
 * On ordinary ground the knockout is not permanent and the campaign continues;
 * the function still records the event so a caller can route every KO through
 * one place. In a No-Man's Land a subordinate's KO is **not** resolved as lost
 * yet — that happens at battle's end via {@link resolveAftermath}, leaving time
 * to revive them.
 *
 * Pure and deterministic. Throws a `RangeError` for a malformed tick, an
 * unknown soldier, or a soldier who is not actually out of action — those are
 * stale-command/programmer faults, not in-world outcomes.
 *
 * ```ts
 * const result = resolveKnockout(
 *   { field: jagd, units, commanderId, tick },
 *   { unitId: commander.id, sourceId: gunner.id },
 * );
 * result.campaignOver; // true
 * ```
 */
export function resolveKnockout(
  context: KnockoutContext,
  request: KnockoutRequest,
): KnockoutResult {
  assertBattlefield(context.field);
  const tick = context.tick ?? 0;
  assertTick(tick);

  const knockedOut = context.units.find((unit) => unit.id === request.unitId);
  if (knockedOut === undefined) {
    throw new RangeError(`no soldier ${request.unitId} is on the field to knock out`);
  }
  if (!isOutOfAction(knockedOut)) {
    throw new RangeError(
      `soldier ${request.unitId} still has ${knockedOut.hp} HP and is not out of action`,
    );
  }
  if (request.sourceId !== undefined && !isValidId(request.sourceId)) {
    throw new RangeError("knockout sourceId must be a non-empty id when present");
  }

  const events: BattleEvent[] = [
    {
      kind: "outOfAction",
      tick,
      unitId: knockedOut.id,
      ...(request.sourceId !== undefined ? { sourceId: request.sourceId } : {}),
    },
  ];

  const commander = context.commanderId !== undefined && context.commanderId === knockedOut.id;
  const permanent = koIsPermanent(context.field);

  if (commander && commanderKoEndsCampaign(context.field)) {
    // A commander falling in a Jagd is an immediate, irrecoverable end to the
    // campaign: no revive window, no further order.
    events.push({ kind: "battleEnded", tick, outcome: "companyDefeat" });
    return {
      units: context.units,
      events,
      knockedOut,
      commander: true,
      permanent,
      campaignOver: true,
      finished: true,
      outcome: "companyDefeat",
    };
  }

  return {
    units: context.units,
    events,
    knockedOut,
    commander,
    permanent,
    campaignOver: false,
    finished: false,
    outcome: null,
  };
}

/* --------------------------------------------------------------------------
 * Aftermath (permanent losses at battle's end)
 * ------------------------------------------------------------------------ */

/** What a completed action leaves of the roster. */
export interface AftermathResult {
  /** Soldiers who fought on, including anyone revived before the end. */
  readonly survivors: readonly Unit[];
  /** Soldiers still out of action when the action ended (permanent losses). */
  readonly lost: readonly Unit[];
  /** Branded ids of {@link lost}, ready for the campaign roster (T068). */
  readonly lostIds: readonly UnitId[];
}

/**
 * Settle the fate of a roster once an action is over. On ordinary ground nobody
 * is lost — the Judges protect the fallen. In a No-Man's Land every soldier
 * still out of action is a **permanent loss**; anyone revived before the end
 * (HP `> 0`) remains with the company.
 *
 * Pure: the input roster and its units are never mutated. The campaign layer
 * (T068+) uses {@link AftermathResult.lostIds} to strike the dead from the
 * roster, exactly as FFTA removes a unit that fell in a Jagd.
 *
 * ```ts
 * const { survivors, lostIds } = resolveAftermath(jagd, battle.units);
 * ```
 */
export function resolveAftermath(field: Battlefield, units: readonly Unit[]): AftermathResult {
  assertBattlefield(field);
  if (!Array.isArray(units)) {
    throw new RangeError("aftermath units must be an array");
  }
  if (!isNoMansLand(field)) {
    return { survivors: units, lost: [], lostIds: [] };
  }

  const survivors: Unit[] = [];
  const lost: Unit[] = [];
  for (const unit of units) {
    if (isOutOfAction(unit)) lost.push(unit);
    else survivors.push(unit);
  }
  return { survivors, lost, lostIds: lost.map((unit) => unit.id) };
}

/* --------------------------------------------------------------------------
 * Validation
 * ------------------------------------------------------------------------ */

function assertBattlefield(field: Battlefield): void {
  if (field === null || typeof field !== "object") {
    throw new RangeError("battlefield must be an object");
  }
  assertRegionId(field.regionId);
  assertLawless(field.lawless);
}

function assertRegionId(regionId: RegionId): void {
  if (!isValidId(regionId)) {
    throw new RangeError("battlefield regionId must be a non-empty string");
  }
}

function assertLawless(lawless: boolean): void {
  if (typeof lawless !== "boolean") {
    throw new RangeError(`battlefield lawless must be a boolean, received ${String(lawless)}`);
  }
}

/** Orders Tempo ticks are non-negative integers (`agents.md` §2). */
function assertTick(tick: number): void {
  if (!Number.isInteger(tick) || tick < 0) {
    throw new RangeError(`knockout tick must be a non-negative integer, received ${String(tick)}`);
  }
}
