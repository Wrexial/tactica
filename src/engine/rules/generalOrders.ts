/**
 * General Orders (T064) — FFTA's **Advanced Law**, rethemed as a **company
 * privilege** that waives one standing order (mapping §1, §9).
 *
 * The reference reserves its strongest law cards for the **Judgemaster**: an
 * Advanced Law can neutralise a law outright, and the story uses one to strip a
 * rival's "Fortune" protection (`docs/wiki/pages/Advanced_Law.md`). The retheme
 * does not put a Judgemaster on the field. Instead it makes the Advanced Law a
 * **company privilege** — a Regimental Honour the free company has earned — that
 * the company may invoke to strike **one active Article of War** from the day's
 * posting (mapping §9):
 *
 * > **General Orders** = Advanced Law (company privilege nullifies one Article).
 *
 * ## How a General Order differs from a Counter-Order (T063)
 *
 * {@link import("../actions/orders").CounterOrderCard} is a card a soldier
 * spends a turn to play, and it nullifies one named Article. A **General Order**
 * is the company's privilege: it is held by the company, not carried by a
 * soldier, and it draws on a small pool of **uses per battle** (default
 * {@link DEFAULT_GENERAL_ORDER_USES}) rather than on the soldier's action. Its
 * effect is exactly the Counter-Order's — nullify one active Article — so this
 * module **composes** the tested T063 executor
 * ({@link import("../actions/orders").applyCounterOrder}) instead of
 * re-implementing the removal. That keeps one definition of "what nullifying an
 * Article means", and it means a General Order inherits the posting's ordering,
 * the active-Article bookkeeping and the No-Man's Land refusal unchanged.
 *
 * ## Why not the "almighty" Anti-Law?
 *
 * FFTA also has R# Anti-Law cards (nullify every law of one rank) and an
 * Almighty Anti-Law (nullify every law for the battle)
 * (`docs/wiki/pages/Law_system_(Tactics_Advance).md` §"Law Cards"). The mapping
 * deliberately fixes the General Order at **one** Article, so those wider forms
 * are left as future variants; the module is typed so adding one is a visible
 * change here rather than a hunt through the engine.
 *
 * ## Contracts (`agents.md` §2, §7, §9)
 *
 * - **Pure & deterministic** — no DOM, no I/O, no `Math.random`, no `Date`. The
 *   same board, privilege and target always nullify the same Article, so a
 *   replay that invokes the same General Order sees the same posting.
 * - **State in, state out** — neither the {@link GeneralOrders} board nor the
 *   {@link import("../actions/orders").BattleOrders} posting is mutated; an
 *   invocation returns new values (structural sharing is fine).
 * - **Data-driven** — no privilege id, post, power or Article is special-cased.
 *   Privileges arrive by value (a `src/data/` collection can be added later,
 *   exactly as T062 split `src/data/guards.ts` from its engine executor); the
 *   only tunable is {@link DEFAULT_GENERAL_ORDER_USES}.
 * - **Integer only** — use counts and Article counts are whole numbers, so
 *   nothing drifts on floating point.
 *
 * Reference: `docs/wiki/pages/Advanced_Law.md` (the Judgemaster's Advanced Law)
 * and `docs/wiki/pages/Law_system_(Tactics_Advance).md` (Law / Anti-Law cards,
 * the lawless Jagd). Fiction: `docs/NAPOLEONIC_MAPPING.md` §1 and §9.
 */

import type { ArticleDef } from "../../data/schema";
import {
  activeArticleIds,
  applyCounterOrder,
  hasActiveArticle,
  type BattleOrders,
} from "../actions/orders";
import { isValidId, type ArticleId, type GeneralOrderId } from "../ids";

/* --------------------------------------------------------------------------
 * Tunables (Phase 13 owns the final balance pass)
 * ------------------------------------------------------------------------ */

/**
 * How many Articles one company privilege may nullify in a single battle. A
 * General Order is a meaningful but finite privilege, so it defaults to a
 * single waiver; a content pack may author a privilege with more uses. This is
 * re-authored balance data (mapping §3, §14), not a scraped number.
 */
export const DEFAULT_GENERAL_ORDER_USES = 1;

/* --------------------------------------------------------------------------
 * The privilege
 * ------------------------------------------------------------------------ */

/**
 * A **company privilege** (FFTA Advanced Law): an earned Regimental Honour the
 * free company may invoke to waive standing orders. It is a small authored
 * value so content can be passed by value (or, later, exported from a
 * `src/data/generalOrders.ts` collection) without the engine importing a
 * content table.
 */
export interface GeneralOrder {
  /** Stable, FFTA-shaped id (`royal-warrant`, `colonels-discretion`, ...). */
  readonly id: GeneralOrderId;
  /** Player-facing Napoleonic label (mapping §14, D6). */
  readonly name: string;
  /** Mechanical rules text. */
  readonly description: string;
  /** In-world prose. */
  readonly flavour: string;
  /**
   * How many Articles this privilege may waive in one battle. Defaults to
   * {@link DEFAULT_GENERAL_ORDER_USES} and must be a positive integer.
   */
  readonly uses?: number;
}

/** A held privilege and how many waivers it still has this battle. */
export interface GeneralOrderHolding {
  readonly order: GeneralOrder;
  /** Uses left in this battle (`>= 0`). */
  readonly remaining: number;
}

/**
 * The company privileges available in one battle, with their remaining uses.
 * This is the value the executor reads and returns; the battle layer holds it
 * beside the {@link import("../actions/orders").BattleOrders} (it is JSON-safe
 * by construction).
 */
export interface GeneralOrders {
  /** The held privileges, in grant order. */
  readonly holdings: readonly GeneralOrderHolding[];
}

/* --------------------------------------------------------------------------
 * Building the board
 * ------------------------------------------------------------------------ */

/**
 * Build a battle's {@link GeneralOrders} from the privileges the company holds.
 * Each privilege starts with its full {@link GeneralOrder.uses}.
 *
 * Throws a `RangeError` for a malformed board: a non-array, a privilege without
 * a non-empty id, a duplicate id, or a non-positive/integer `uses`. Those are
 * authoring faults, not in-world outcomes, matching
 * `createBattleOrders` (T063).
 *
 * ```ts
 * const board = createGeneralOrders([ROYAL_WARRANT]);
 * remainingUses(board, ROYAL_WARRANT.id); // 1
 * ```
 */
export function createGeneralOrders(
  orders: readonly GeneralOrder[] = [],
): GeneralOrders {
  if (!Array.isArray(orders)) {
    throw new RangeError("general orders must be an array");
  }

  const seen = new Set<string>();
  const holdings: GeneralOrderHolding[] = [];
  for (const order of orders) {
    assertGeneralOrder(order);
    if (seen.has(order.id)) {
      throw new RangeError(`duplicate general order: ${order.id}`);
    }
    seen.add(order.id);
    holdings.push({ order, remaining: usesOf(order) });
  }
  return { holdings };
}

/**
 * Add a privilege to an existing board with its full uses. Pure: a new board is
 * returned. Throws a `RangeError` when the privilege is malformed or when the
 * company already holds that id (a privilege is granted once).
 */
export function grantGeneralOrder(
  board: GeneralOrders,
  order: GeneralOrder,
): GeneralOrders {
  assertGeneralOrder(order);
  if (board.holdings.some((holding) => holding.order.id === order.id)) {
    throw new RangeError(`general order already held: ${order.id}`);
  }
  return { holdings: [...board.holdings, { order, remaining: usesOf(order) }] };
}

/* --------------------------------------------------------------------------
 * Queries
 * ------------------------------------------------------------------------ */

/** The held privilege with `id`, or `undefined` when it is not held. */
export function findGeneralOrder(
  board: GeneralOrders,
  id: GeneralOrderId,
): GeneralOrderHolding | undefined {
  return board.holdings.find((holding) => holding.order.id === id);
}

/** Whether the company holds the named privilege at all. */
export function hasGeneralOrder(board: GeneralOrders, id: GeneralOrderId): boolean {
  return findGeneralOrder(board, id) !== undefined;
}

/**
 * Uses remaining on the named privilege this battle, or `0` when it is not
 * held. Returning `0` rather than throwing lets a UI grey out an unavailable
 * privilege without first checking membership.
 */
export function remainingUses(board: GeneralOrders, id: GeneralOrderId): number {
  return findGeneralOrder(board, id)?.remaining ?? 0;
}

/* --------------------------------------------------------------------------
 * Invocation
 * ------------------------------------------------------------------------ */

/** Why a General Order was refused. A closed set so AI/UI can branch on it. */
export const GENERAL_ORDER_FAIL_REASONS = [
  "lawless",
  "unknown-order",
  "exhausted",
  "no-target",
  "not-active",
] as const;
export type GeneralOrderFailReason = (typeof GENERAL_ORDER_FAIL_REASONS)[number];

/** Runtime guard for untrusted failure reasons (replays, logs). */
export function isGeneralOrderFailReason(value: unknown): value is GeneralOrderFailReason {
  return (
    typeof value === "string" &&
    (GENERAL_ORDER_FAIL_REASONS as readonly string[]).includes(value)
  );
}

/** What a successfully invoked privilege changed. */
export interface GeneralOrderChange {
  /** The privilege that was invoked. */
  readonly orderId: GeneralOrderId;
  /** A General Order always nullifies; the field is explicit for readers. */
  readonly action: "nullified";
  /** The Article that left the posting. */
  readonly article: ArticleDef;
  /** The nullified Article's id, branded. */
  readonly articleId: ArticleId;
  /** The number of Articles in force **after** the waiver. */
  readonly activeCount: number;
  /** Uses left on this privilege after the waiver. */
  readonly remainingUses: number;
}

/** The result of one {@link invokeGeneralOrder} call. */
export interface GeneralOrderResult {
  /** `false` when the privilege was refused (nothing changed). */
  readonly ok: boolean;
  /** The posting after the waiver, or the input posting on refusal. */
  readonly orders: BattleOrders;
  /** The board after the waiver, or the input board on refusal. */
  readonly generalOrders: GeneralOrders;
  /** The privilege that was invoked. */
  readonly orderId: GeneralOrderId;
  /** What changed; present only when {@link ok} is `true`. */
  readonly change?: GeneralOrderChange;
  /** Why it was refused; present only when {@link ok} is `false`. */
  readonly reason?: GeneralOrderFailReason;
}

/**
 * Whether the named privilege may be invoked against `orders`, returning `null`
 * when it may or the {@link GeneralOrderFailReason} otherwise. Pure: neither
 * board is written, so a UI can grey out an unavailable privilege without
 * touching the posting.
 *
 * The checks, in order:
 * 1. `"lawless"` — a No-Man's Land has no Provost and no Articles, so a General
 *    Order has nothing to waive (T065 drives this).
 * 2. `"unknown-order"` — the company does not hold that privilege (or its id is
 *    empty).
 * 3. `"exhausted"` — the privilege's uses for this battle are spent.
 * 4. `"no-target"` — no Article is currently in force.
 * 5. `"not-active"` — a named Article is not in force.
 *
 * When `articleId` is omitted the **first** active Article (posting order) is
 * the target, so the choice is deterministic.
 */
export function canInvokeGeneralOrder(
  board: GeneralOrders,
  orders: BattleOrders,
  id: GeneralOrderId,
  articleId?: ArticleId,
): GeneralOrderFailReason | null {
  if (orders.lawless) return "lawless";
  if (!isValidId(id)) return "unknown-order";

  const holding = findGeneralOrder(board, id);
  if (holding === undefined) return "unknown-order";
  if (holding.remaining <= 0) return "exhausted";

  const target = articleId ?? activeArticleIds(orders)[0];
  if (target === undefined) return "no-target";
  if (!hasActiveArticle(orders, target)) return "not-active";
  return null;
}

/**
 * Invoke a company privilege (FFTA Advanced Law) to **nullify one active
 * Article** of War (mapping §9).
 *
 * An accepted invocation removes the target Article from the posting through the
 * T063 Counter-Order executor, spends one use of the privilege and returns
 * `ok: true` with the new {@link GeneralOrderResult.orders} and
 * {@link GeneralOrderResult.generalOrders}. A refused invocation returns
 * `ok: false`, the **same** board and posting objects and the
 * {@link GeneralOrderResult.reason}; nothing is mutated either way.
 *
 * When `articleId` is omitted the first active Article (posting order) is
 * waived. Turn ownership is not checked here — the battle layer owns whose
 * Orders Tempo turn it is (T066 will drive the Provost's side of it).
 *
 * Purity means a replay that invokes the same privilege at the same point
 * always sees the same posting (`agents.md` §2).
 *
 * ```ts
 * const result = invokeGeneralOrder(board, orders, ROYAL_WARRANT.id);
 * if (result.ok) {
 *   orders = result.orders;
 *   board = result.generalOrders;
 * }
 * ```
 */
export function invokeGeneralOrder(
  board: GeneralOrders,
  orders: BattleOrders,
  id: GeneralOrderId,
  articleId?: ArticleId,
): GeneralOrderResult {
  const reason = canInvokeGeneralOrder(board, orders, id, articleId);
  if (reason !== null) {
    return { ok: false, orders, generalOrders: board, orderId: id, reason };
  }

  // `canInvokeGeneralOrder` guarantees an active target exists. When the caller
  // named none, take the first active Article so the choice stays deterministic.
  const target = articleId ?? (activeArticleIds(orders)[0] as ArticleId);
  const applied = applyCounterOrder(orders, target);
  // `applied` cannot fail: the target was verified active above.
  const article = applied.change?.article as ArticleDef;
  const spent = spendUse(board, id);

  return {
    ok: true,
    orders: applied.orders,
    generalOrders: spent,
    orderId: id,
    change: {
      orderId: id,
      action: "nullified",
      article,
      articleId: target,
      activeCount: applied.orders.articles.length,
      remainingUses: remainingUses(spent, id),
    },
  };
}

/* --------------------------------------------------------------------------
 * Internals
 * ------------------------------------------------------------------------ */

/** The authored use count, defaulted and clamped to a positive integer. */
function usesOf(order: GeneralOrder): number {
  return order.uses ?? DEFAULT_GENERAL_ORDER_USES;
}

/** Spend one use of `id`, returning a new board (structural sharing of the rest). */
function spendUse(board: GeneralOrders, id: GeneralOrderId): GeneralOrders {
  return {
    holdings: board.holdings.map((holding) =>
      holding.order.id === id
        ? { order: holding.order, remaining: holding.remaining - 1 }
        : holding,
    ),
  };
}

/** Fail fast on a malformed privilege (authoring fault, not in-world outcome). */
function assertGeneralOrder(order: GeneralOrder): void {
  if (order === null || typeof order !== "object") {
    throw new RangeError("every general order must be an object");
  }
  if (!isValidId(order.id)) {
    throw new RangeError("every general order must carry a non-empty id");
  }
  if (order.uses !== undefined && (!Number.isInteger(order.uses) || order.uses < 1)) {
    throw new RangeError(
      `general order uses must be a positive integer, received ${String(order.uses)}`,
    );
  }
}
