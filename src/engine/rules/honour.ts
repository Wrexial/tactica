/**
 * Honour economy (T060) — the **Judge Point** resource rethemed (mapping §5,
 * §9): where it comes from, how it is capped and how it is spent.
 *
 * FFTA's **Judge Points** (JP) are awarded by the Judge for behaving well:
 * "Judge Points are received by either successfully and legally KOing an
 * opponent, or performing a recommended action during battle as stated by the
 * Law of the day" (`docs/wiki/pages/Judge_Points.md`). The same page fixes the
 * two rules this module owns:
 *
 * - **Cap 10.** "A Totema summon requires ten JP, which is also the maximum a
 *   character can carry."
 * - **No stacking.** "Judge Points cannot be stacked. For example, using Last
 *   Breath to KO an opponent with the Holy law in effect will not grant two
 *   Judge Points, one for the KO and one for the 'Dark' action." One resolved
 *   event yields **at most one** award, no matter how many awards it qualifies
 *   for.
 *
 * The retheme (`docs/NAPOLEONIC_MAPPING.md` §5) renames JP to **Honour**: it is
 * earned from **legal KOs** and **commended acts** (the recommended half of the
 * daily Articles, T056) and spent on **Volleys** (T061) and **Guard Sorties**
 * (T062). The unit field keeps the FFTA-shaped name, `judgePoints`, so formulas
 * and serialisation map 1:1; `withJudgePoints` (T017) already clamps it to
 * `[0, HONOUR_MAX]`.
 *
 * ```text
 *   resolved action ──► detectArticles() ──► { commended, unlawful }
 *        │                                        │
 *        │ ko = victim out of action              │
 *        ▼                                        ▼
 *   honourEventFor(detection, ko) ──► { legalKo, commended[] }
 *        │
 *        ▼
 *   honourAwardForEvent(event) ──► { amount, reason }   // one award only
 *        │
 *        ▼
 *   resolveHonourEvent(unit, event, tick)
 *        │  clamps at HONOUR_MAX, emits honourChanged (+ commended)
 *        ▼
 *   awardLegalKo / awardCommended ── direct one-shot entry points
 *
 *   spendHonour(unit, cost, "volley" | "guardSortie", tick)  // T061/T062
 * ```
 *
 * ## Why an "event" and not an action
 *
 * The no-stacking rule is about a *resolved event*, not a command: a single
 * ability can both knock a soldier out and match a commended Article, and that
 * is still one award. {@link HonourEvent} therefore states the two facts that
 * matter after resolution — "was this a legal KO?" and "which commended
 * Articles did it earn?" — and {@link honourAwardForEvent} folds them into a
 * single award. When the event qualifies for both, the larger of the legal-KO
 * point and the best commendation is granted (a tie goes to the commendation,
 * the more specific recognition), and never their sum. Several commendations on
 * one event likewise collapse to the single best one.
 *
 * ## Contract (`agents.md` §2, §7, §9)
 *
 * - **Pure & deterministic** — no DOM, no I/O, no `Math.random`, no `Date`.
 *   Time is the integer Orders Tempo tick; the same inputs always yield a
 *   byte-identical unit and ordered event list.
 * - **State in, state out** — inputs are never mutated; every helper returns a
 *   new unit plus the ordered {@link BattleEvent}s describing the change.
 * - **Data-driven** — the legal-KO award and the Guard-Sortie cost live here as
 *   named constants; a commendation's value is the authored `ArticleDef.honour`
 *   (`src/data/articles.ts`, T054), never a number buried in logic.
 * - **Integer in, integer out** — malformed amounts, costs and ticks are
 *   rejected at the boundary rather than silently rounded.
 *
 * Reference: `docs/wiki/pages/Judge_Points.md` (award sources, cap 10, no
 * stacking) and `docs/NAPOLEONIC_MAPPING.md` §5 / §9.
 */

import type { ArticleDef } from "../../data/schema";
import type { BattleEvent } from "../events";
import { HONOUR_MAX, withJudgePoints, type Unit } from "../unit";
import type { ArticleDetection } from "./articles";

/* --------------------------------------------------------------------------
 * Tunables (Phase 13 owns the final balance pass)
 * ------------------------------------------------------------------------ */

/**
 * Honour granted for **successfully and legally KOing an opponent** — FFTA's
 * one Judge Point per legal knockout (`docs/wiki/pages/Judge_Points.md`).
 * Authored balance data re-authored from the reference; the Hunting skill's
 * ten-point kill, for instance, is a future ability effect layered on top of
 * this base award.
 */
export const HONOUR_LEGAL_KO = 1;

/**
 * Honour a **Guard Sortie** (FFTA Totema, mapping §4, T062) costs. FFTA sets
 * the Totema cost at ten JP, which is also the maximum a soldier may carry, so
 * calling a Guard Sortie always empties the pool. Kept here with the rest of
 * the economy, ready for T062 to import.
 */
export const GUARD_SORTIE_COST = 10;

/* --------------------------------------------------------------------------
 * Reasons
 * ------------------------------------------------------------------------ */

/** The two ways an event can **earn** Honour. */
export const HONOUR_AWARD_REASONS = ["legalKo", "commended"] as const;
export type HonourAwardReason = (typeof HONOUR_AWARD_REASONS)[number];

/** The reasons Honour **leaves** a soldier's pool (T060 awards; T061/T062 spend). */
export const HONOUR_SPEND_REASONS = ["volley", "guardSortie", "penalty"] as const;
export type HonourSpendReason = (typeof HONOUR_SPEND_REASONS)[number];

/** Runtime guard for untrusted award reasons (replays, network). */
export function isHonourAwardReason(value: unknown): value is HonourAwardReason {
  return typeof value === "string" && (HONOUR_AWARD_REASONS as readonly string[]).includes(value);
}

/** Runtime guard for untrusted spend reasons (replays, network). */
export function isHonourSpendReason(value: unknown): value is HonourSpendReason {
  return typeof value === "string" && (HONOUR_SPEND_REASONS as readonly string[]).includes(value);
}

/* --------------------------------------------------------------------------
 * Result shapes
 * ------------------------------------------------------------------------ */

/** The result of one Honour change (award or spend). */
export interface HonourChangeResult {
  readonly unit: Unit;
  /** The amount actually gained/lost (`>= 0`) after clamping. */
  readonly amount: number;
  /** Ordered events describing the change; empty for a no-op. */
  readonly events: readonly BattleEvent[];
}

/** The single award one resolved event earns, or `null` when it earns none. */
export interface HonourAward {
  /** Honour to grant before clamping (`>= 1` when {@link reason} is set). */
  readonly amount: number;
  /** Which rule the award came from; `null` when there is no award. */
  readonly reason: HonourAwardReason | null;
}

/* --------------------------------------------------------------------------
 * Event-level resolution (the no-stacking rule)
 * ------------------------------------------------------------------------ */

/**
 * The two Honour-relevant facts a resolved action exposes.
 *
 * - `legalKo` — the action knocked an opponent out of action **and broke no
 *   Article**. An unlawful KO is an illegal KO: it earns no Honour (T057 turns
 *   it into a Court-Martial instead).
 * - `commended` — the commended Articles the action matched. Normally this is
 *   `detection.commended.map((match) => match.article)`; build it with
 *   {@link honourEventFor} rather than by hand.
 */
export interface HonourEvent {
  /** `true` when the action legally knocked an opponent out of action. */
  readonly legalKo?: boolean;
  /** Commended Articles the action earned, in detection order. */
  readonly commended?: readonly ArticleDef[];
}

/**
 * Derive an {@link HonourEvent} from the Article verdict of a resolved action.
 *
 * `ko` says whether the action knocked an opponent out of action; a knockout is
 * only **legal** when the action broke no Article (`detection.unlawful` is
 * false), so an unlawful KO yields `legalKo: false` and no award. The commended
 * Articles come straight from {@link ArticleDetection.commended}.
 *
 * ```ts
 * const detection = detectArticles(day.articles, subject);
 * const event = honourEventFor(detection, target.hp <= 0);
 * // { legalKo: true, commended: [ARTICLES["commend-volley-fire"]] }
 * ```
 */
export function honourEventFor(
  detection: Pick<ArticleDetection, "commended" | "unlawful">,
  ko = false,
): HonourEvent {
  const articles = detection.commended.map((match) => match.article);
  return {
    legalKo: ko && !detection.unlawful,
    ...(articles.length > 0 ? { commended: articles } : {}),
  };
}

/**
 * Fold an {@link HonourEvent} into the single award it earns — the mechanical
 * heart of FFTA's "Judge Points cannot be stacked"
 * (`docs/wiki/pages/Judge_Points.md`).
 *
 * - A legal KO alone earns {@link HONOUR_LEGAL_KO}.
 * - A commended act earns the best matching Article's `honour`.
 * - When the event is **both**, only one award is granted: the larger of the
 *   two (a tie goes to the commendation, the more specific recognition). The
 *   awards are never summed.
 * - Several commended Articles on one event likewise collapse to the single
 *   best one.
 *
 * Pure: it reads the event and returns a plain value, so a caller can preview
 * the award (UI, AI) without touching the unit.
 *
 * ```ts
 * honourAwardForEvent({ legalKo: true });                       // { amount: 1, reason: "legalKo" }
 * honourAwardForEvent({ commended: [commendVolleyFire] });      // { amount: 2, reason: "commended" }
 * honourAwardForEvent({ legalKo: true, commended: [twoHonour] }); // { amount: 2, reason: "commended" } — no stack
 * ```
 */
export function honourAwardForEvent(event: HonourEvent): HonourAward {
  const koHonour = event.legalKo === true ? HONOUR_LEGAL_KO : 0;
  const commendedHonour = bestCommendation(event.commended);

  if (commendedHonour <= 0 && koHonour <= 0) {
    return { amount: 0, reason: null };
  }
  // One event, one award: grant the larger, breaking ties toward the
  // commendation (FFTA recognises the recommended act rather than double-count).
  if (commendedHonour >= koHonour) {
    return { amount: commendedHonour, reason: "commended" };
  }
  return { amount: koHonour, reason: "legalKo" };
}

/**
 * Resolve the Honour a single event earns and apply it to `unit`, clamped at
 * {@link HONOUR_MAX}. This is the one-stop entry point the battle layer (T067)
 * uses after it has resolved an action and detected its Articles.
 *
 * A no-op — the same unit and no events — when the event earns nothing, when
 * the soldier is already at the cap, or when there is no Honour left to grant.
 *
 * ```ts
 * const detection = detectArticles(day.articles, subject);
 * const { unit: actor2, events } = resolveHonourEvent(
 *   actor,
 *   honourEventFor(detection, victim.hp <= 0),
 *   battle.tempo.tick,
 * );
 * ```
 */
export function resolveHonourEvent(unit: Unit, event: HonourEvent, tick = 0): HonourChangeResult {
  const award = honourAwardForEvent(event);
  if (award.reason === null) return { unit, amount: 0, events: [] };
  return awardHonour(unit, award.amount, award.reason, tick);
}

/* --------------------------------------------------------------------------
 * Direct awards
 * ------------------------------------------------------------------------ */

/**
 * Grant `amount` Honour for `reason`, clamped at {@link HONOUR_MAX}. Emits
 * `honourChanged` (and, for a commended award, a `commended` event) only when
 * points actually enter the pool; an award at the cap is a no-op returning the
 * same unit and no events.
 *
 * Most callers should use {@link resolveHonourEvent} (which enforces the
 * no-stacking rule) or the {@link awardLegalKo} / {@link awardCommended}
 * shorthands. This function is the shared implementation and the escape hatch
 * for content that needs a bespoke award.
 *
 * ```ts
 * const { unit, amount, events } = awardHonour(actor, 2, "commended", tick);
 * ```
 *
 * @throws RangeError when `amount` is not a non-negative integer, `reason` is
 * not an award reason, or `tick` is not a non-negative integer.
 */
export function awardHonour(
  unit: Unit,
  amount: number,
  reason: HonourAwardReason,
  tick = 0,
): HonourChangeResult {
  assertAmount(amount, "honour.amount");
  assertAwardReason(reason);
  assertTick(tick);

  const gained = Math.min(amount, honourRoom(unit));
  if (gained <= 0) return { unit, amount: 0, events: [] };

  const updated = withJudgePoints(unit, unit.judgePoints + gained);
  const events: BattleEvent[] = [
    {
      kind: "honourChanged",
      tick,
      unitId: unit.id,
      delta: gained,
      honourAfter: updated.judgePoints,
      reason,
    },
  ];
  // A commended act is also a recognition event the UI narrates; a legal KO is
  // captured well enough by the resource change alone. `honour` reports the
  // amount actually banked, so a near-full pool never over-reports.
  if (reason === "commended") {
    events.unshift({ kind: "commended", tick, unitId: unit.id, honour: gained });
  }
  return { unit: updated, amount: gained, events };
}

/** Grant the {@link HONOUR_LEGAL_KO} for a legal knockout. */
export function awardLegalKo(unit: Unit, tick = 0): HonourChangeResult {
  return awardHonour(unit, HONOUR_LEGAL_KO, "legalKo", tick);
}

/**
 * Grant the `honour` a commended Article awards (its authored `ArticleDef.honour`).
 * A zero-value commendation is a no-op.
 */
export function awardCommended(unit: Unit, honour: number, tick = 0): HonourChangeResult {
  return awardHonour(unit, honour, "commended", tick);
}

/* --------------------------------------------------------------------------
 * Spending (Volleys T061 / Guard Sorties T062)
 * ------------------------------------------------------------------------ */

/**
 * Pay `cost` Honour for `reason`, clamping at zero and reporting what was
 * actually spent. Emits `honourChanged` when any Honour leaves the pool; a zero
 * cost, an empty pool or an unaffordable cost is a no-op returning the same
 * unit and no events.
 *
 * Command validation (T061/T062) refuses an action the actor cannot afford;
 * clamping keeps the pool inside `[0, HONOUR_MAX]` regardless, so a forced or
 * scripted drain can never underflow. Note that FFTA spends the whole initiating
 * pool on a Volley, not a fixed cost — the battle layer chooses the amount.
 *
 * ```ts
 * const { unit, amount, events } = spendHonour(actor, GUARD_SORTIE_COST, "guardSortie", tick);
 * ```
 *
 * @throws RangeError when `cost` is not a non-negative integer, `reason` is not
 * a spend reason, or `tick` is not a non-negative integer.
 */
export function spendHonour(
  unit: Unit,
  cost: number,
  reason: HonourSpendReason,
  tick = 0,
): HonourChangeResult {
  assertAmount(cost, "honour.cost");
  assertSpendReason(reason);
  assertTick(tick);

  const spent = Math.min(cost, unit.judgePoints);
  if (spent <= 0) return { unit, amount: 0, events: [] };

  const updated = withJudgePoints(unit, unit.judgePoints - spent);
  return {
    unit: updated,
    amount: spent,
    events: [
      {
        kind: "honourChanged",
        tick,
        unitId: unit.id,
        delta: -spent,
        honourAfter: updated.judgePoints,
        reason,
      },
    ],
  };
}

/* --------------------------------------------------------------------------
 * Queries
 * ------------------------------------------------------------------------ */

/** Whether `unit` holds at least `cost` Honour. */
export function canAffordHonour(unit: Unit, cost: number): boolean {
  assertAmount(cost, "honour.cost");
  return unit.judgePoints >= cost;
}

/** How much Honour `unit` can still gain before it reaches {@link HONOUR_MAX}. */
export function honourRoom(unit: Unit): number {
  return HONOUR_MAX - unit.judgePoints;
}

/** Whether `unit` is at the Honour cap and can gain no more. */
export function isHonourMaxed(unit: Unit): boolean {
  return unit.judgePoints >= HONOUR_MAX;
}

/* --------------------------------------------------------------------------
 * Internals
 * ------------------------------------------------------------------------ */

/**
 * The best `honour` among the commended Articles in an event, or `0` when there
 * is none. Only `commend` Articles count (a forbid Article's default `honour`
 * of `0` never awards), and the awards are **not** summed, honouring the
 * no-stacking rule.
 */
function bestCommendation(articles: readonly ArticleDef[] | undefined): number {
  let best = 0;
  for (const article of articles ?? []) {
    if (article.kind !== "commend") continue;
    if (article.honour > best) best = article.honour;
  }
  return best;
}

/* --------------------------------------------------------------------------
 * Validation helpers
 * ------------------------------------------------------------------------ */

function assertTick(tick: number): void {
  if (!Number.isInteger(tick) || tick < 0) {
    throw new RangeError(`honour.tick must be a non-negative integer, received ${String(tick)}`);
  }
}

function assertAmount(amount: number, label: string): void {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new RangeError(`${label} must be a non-negative integer, received ${String(amount)}`);
  }
}

function assertAwardReason(reason: unknown): asserts reason is HonourAwardReason {
  if (!isHonourAwardReason(reason)) {
    throw new RangeError(
      `honour award reason must be one of ${HONOUR_AWARD_REASONS.join(", ")}, received ${String(reason)}`,
    );
  }
}

function assertSpendReason(reason: unknown): asserts reason is HonourSpendReason {
  if (!isHonourSpendReason(reason)) {
    throw new RangeError(
      `honour spend reason must be one of ${HONOUR_SPEND_REASONS.join(", ")}, received ${String(reason)}`,
    );
  }
}
