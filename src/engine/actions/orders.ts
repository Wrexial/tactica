/**
 * Standing / Counter-Orders (T063) — FFTA's **Law Cards** and **Anti-Law
 * Cards**, rethemed as orders an **Adjutant** posts or revokes mid-battle
 * (mapping §9, §10).
 *
 * The reference lets a soldier spend a turn to influence the law mid-battle
 * (`docs/wiki/pages/Law_system_(Tactics_Advance).md` §"Law Cards"):
 *
 * > - Law Cards: Add a law.
 * > - Anti-Law Cards: Nullify a law.
 * > - R# Anti-Law Cards: Nullify all laws that are the same rank as the card.
 * > - Almighty Anti-Law: Nullify all laws for the battle.
 *
 * Tactica keeps the first two verbatim: a **Standing Order** adds one Article
 * of War to the day's posting, and a **Counter-Order** nullifies one. The
 * retheme's fiction is an **Adjutant** (the Ezel-analogue staff officer,
 * mapping §9) reading a new order to the line, or striking one from the
 * standing list. The rank-scoped and "almighty" cards are left as future
 * variants (the `ArticleDef` schema has no `rank` yet), and the module is built
 * as a discriminated union so adding them is a compile error everywhere the
 * two live kinds are handled.
 *
 * ## What this module owns
 *
 * This is the **executor** for a played order card: given the battle's current
 * {@link BattleOrders} (its active Articles plus the cap) and a card, it decides
 * whether the card may be played, applies it and reports what changed. It
 * deliberately does *not* own:
 *
 * - **Generation** — which Articles a day carries ({@link
 *   import("../rules/articles").generateDailyArticles}, T055).
 * - **Enforcement** — turning a breach into a Reprimand or Court-Martial
 *   ({@link import("../rules/articles").detectArticles}, T056–T058).
 * - **Turn timing** — a card is played on a soldier's Orders Tempo turn; the
 *   battle layer (and the Provost unit, T066) own whose turn it is and when the
 *   call is legal.
 *
 * ## The Article cap
 *
 * FFTA's daily posting grows from one law to three as the story advances
 * (`Law_system_(Tactics_Advance).md` §"Lawshifts"), and a posting can also
 * carry **recommended acts** alongside the forbidden ones. This module caps the
 * total number of active Articles so a card cannot pile orders onto a posting
 * without limit, but leaves one slot of headroom above the strictest default
 * schedule: {@link DEFAULT_ARTICLE_FREQUENCY} peaks at three forbidding and two
 * commended Articles (five total), while {@link MAX_ACTIVE_ARTICLES} is six, so
 * a Standing Order can always find room for one further Article even on the
 * strictest day. The cap is a re-authored balance number (mapping §3, §14), not
 * a scraped one.
 *
 * ## Lawless fields
 *
 * A **No-Man's Land** (FFTA Jagd, mapping §9) has no Provost and no Articles,
 * so its battles carry `lawless: true` and refuse **every** order card —
 * Standing or Counter alike — with the `"lawless"` reason. This is the seam the
 * No-Man's Land rules (T065) and the Provost entity (T066) will drive.
 *
 * ## Contracts (`agents.md` §2, §7, §9)
 *
 * - **Pure & deterministic** — no DOM, no I/O, no `Math.random`, no `Date`.
 *   The same board and card always produce the same result, so a replay that
 *   plays the same card sees the same posting.
 * - **State in, state out** — the input board and its `articles` array are
 *   never mutated; an applied card returns a new board with a new array
 *   (structural sharing of the `ArticleDef`s is fine).
 * - **Data-driven** — no Article, target or post id is special-cased. The cap is
 *   the tunable {@link MAX_ACTIVE_ARTICLES}; the Articles themselves arrive
 *   from `src/data/articles.ts` (T054).
 * - **Integer only** — counts are whole numbers, so nothing drifts on floating
 *   point.
 *
 * Reference: `docs/wiki/pages/Law_system_(Tactics_Advance).md` (Law/Anti-Law
 * cards, the lawless Jagd) and `docs/NAPOLEONIC_MAPPING.md` §9 ("Standing
 * Orders / Counter-Orders = Law/Antilaw cards") and §10.
 */

import type { ArticleDef } from "../../data/schema";
import { asArticleId, isValidId, type ArticleId } from "../ids";

/* --------------------------------------------------------------------------
 * Tunables (Phase 13 owns the final balance pass)
 * ------------------------------------------------------------------------ */

/**
 * The largest number of Articles that may be in force at once. Re-authored
 * balance data (mapping §3, §14), inspired by the reference's law rotation —
 * which peaks at three forbidden laws plus its recommended acts. One above the
 * strictest default posting (three forbidding + two commended, see
 * {@link import("../rules/articles").DEFAULT_ARTICLE_FREQUENCY}), so a Standing
 * Order can always add one further Article even on the strictest campaign day.
 */
export const MAX_ACTIVE_ARTICLES = 6;

/* --------------------------------------------------------------------------
 * Cards
 * ------------------------------------------------------------------------ */

/** The two card kinds this executor understands (FFTA Law / Anti-Law). */
export const ORDER_CARD_KINDS = ["standingOrder", "counterOrder"] as const;
export type OrderCardKind = (typeof ORDER_CARD_KINDS)[number];

/** Runtime guard for untrusted card-kind strings (replays, save files). */
export function isOrderCardKind(value: unknown): value is OrderCardKind {
  return typeof value === "string" && (ORDER_CARD_KINDS as readonly string[]).includes(value);
}

/**
 * A **Standing Order** card (FFTA Law Card): post one more {@link ArticleDef}
 * for the duration of the battle. The Article itself is carried by value so the
 * card can be played without consulting the authored catalogue again.
 */
export interface StandingOrderCard {
  readonly kind: "standingOrder";
  /** The Article to add to the posting. */
  readonly article: ArticleDef;
}

/**
 * A **Counter-Order** card (FFTA Anti-Law Card): nullify one Article already in
 * force. The card names the Article by id, exactly as a save file or a menu
 * selection would.
 */
export interface CounterOrderCard {
  readonly kind: "counterOrder";
  /** Id of the active Article to strike from the posting. */
  readonly articleId: ArticleId;
}

/**
 * The card union. Narrow on `kind` to read the payload; adding a card variant
 * (such as the rank-scoped or "almighty" Anti-Law) is a compile error wherever
 * the two live kinds are handled.
 */
export type OrderCard = StandingOrderCard | CounterOrderCard;

/** Build a {@link StandingOrderCard}. Pure sugar so callers never hand-build one. */
export function standingOrderCard(article: ArticleDef): StandingOrderCard {
  return { kind: "standingOrder", article };
}

/** Build a {@link CounterOrderCard}. */
export function counterOrderCard(articleId: ArticleId): CounterOrderCard {
  return { kind: "counterOrder", articleId };
}

/* --------------------------------------------------------------------------
 * The board of active Articles
 * ------------------------------------------------------------------------ */

/**
 * The Articles of War currently in force in a battle, plus the posting's cap
 * and whether the field is lawless. This is the value the order-card executor
 * reads and returns; the battle layer will hold it alongside the
 * {@link import("../battle").BattleState} (it is JSON-safe by construction).
 *
 * Not to be confused with the Orders **Tempo** scheduler
 * ({@link import("../turn").OrdersTempo}), which drives whose turn it is.
 */
export interface BattleOrders {
  /**
   * The active Articles, in posting order (forbidding orders first, then
   * commended acts, matching {@link import("../rules/articles").DailyArticles}).
   */
  readonly articles: readonly ArticleDef[];
  /** The largest number of Articles this battle permits ({@link MAX_ACTIVE_ARTICLES}). */
  readonly maxArticles: number;
  /** `true` in a lawless No-Man's Land, where no card may be played (T065). */
  readonly lawless: boolean;
}

/** Options for {@link createBattleOrders}. */
export interface BattleOrdersOptions {
  /** Override the cap; must be a non-negative integer. Defaults to {@link MAX_ACTIVE_ARTICLES}. */
  readonly maxArticles?: number;
  /** Mark the field lawless (No-Man's Land). Defaults to `false`. */
  readonly lawless?: boolean;
}

/**
 * Build a battle's {@link BattleOrders} from the Articles already in force
 * (typically a day's `DailyArticles.articles`). The input array is copied, so
 * later changes to it cannot alias back into the board.
 *
 * Throws a `RangeError` for a malformed posting: a non-array, an Article
 * without a non-empty id, a duplicate id, an invalid `maxArticles`, or an
 * initial posting that already exceeds the cap. Those are authoring faults
 * (a bad daily draw or scenario), not in-world outcomes, matching the
 * fail-fast boundary in `src/engine/rules/articles.ts`.
 *
 * ```ts
 * const orders = createBattleOrders(daily.articles);
 * orders.articles.length; // e.g. 2
 * ```
 */
export function createBattleOrders(
  articles: readonly ArticleDef[] = [],
  options: BattleOrdersOptions = {},
): BattleOrders {
  const maxArticles = options.maxArticles ?? MAX_ACTIVE_ARTICLES;
  assertMaxArticles(maxArticles);
  if (!Array.isArray(articles)) {
    throw new RangeError("battle orders articles must be an array");
  }

  const seen = new Set<string>();
  for (const article of articles) {
    if (article === null || typeof article !== "object" || !isValidId(article.id)) {
      throw new RangeError("every active Article must carry a non-empty id");
    }
    if (seen.has(article.id)) {
      throw new RangeError(`duplicate active Article: ${article.id}`);
    }
    seen.add(article.id);
  }
  if (articles.length > maxArticles) {
    throw new RangeError(
      `a posting of ${articles.length} Articles exceeds its cap of ${maxArticles}`,
    );
  }

  return { articles: articles.slice(), maxArticles, lawless: options.lawless ?? false };
}

/* --------------------------------------------------------------------------
 * Queries
 * ------------------------------------------------------------------------ */

/** Whether `orders` currently has the named Article in force. */
export function hasActiveArticle(orders: BattleOrders, articleId: ArticleId): boolean {
  return orders.articles.some((article) => article.id === articleId);
}

/** The active {@link ArticleDef} with `articleId`, or `undefined` when not in force. */
export function findActiveArticle(
  orders: BattleOrders,
  articleId: ArticleId,
): ArticleDef | undefined {
  return orders.articles.find((article) => article.id === articleId);
}

/** The active Article ids, in posting order, branded for state and menus. */
export function activeArticleIds(orders: BattleOrders): readonly ArticleId[] {
  return orders.articles.map((article) => asArticleId(article.id));
}

/* --------------------------------------------------------------------------
 * Play
 * ------------------------------------------------------------------------ */

/** Why an order card was refused. A closed set so AI/UI can branch on it. */
export const ORDER_FAIL_REASONS = [
  "lawless",
  "malformed",
  "at-capacity",
  "already-active",
  "not-active",
] as const;
export type OrderFailReason = (typeof ORDER_FAIL_REASONS)[number];

/** Runtime guard for untrusted failure reasons (replays, logs). */
export function isOrderFailReason(value: unknown): value is OrderFailReason {
  return typeof value === "string" && (ORDER_FAIL_REASONS as readonly string[]).includes(value);
}

/** What a successfully played card changed. */
export interface OrderChange {
  /** Which kind of card was played. */
  readonly card: OrderCardKind;
  /** Whether an Article entered or left the posting. */
  readonly action: "added" | "nullified";
  /** The Article added (standing) or removed (counter). */
  readonly article: ArticleDef;
  /** The changed Article's id, branded. */
  readonly articleId: ArticleId;
  /** The number of Articles in force **after** the change. */
  readonly activeCount: number;
}

/** The result of one {@link playOrderCard} call. */
export interface OrderCardResult {
  /** `false` when the card was refused (nothing changed). */
  readonly ok: boolean;
  /** The board after the play, or the input board, unchanged, on rejection. */
  readonly orders: BattleOrders;
  /** The card that was played. */
  readonly card: OrderCard;
  /** What changed; present only when {@link ok} is `true`. */
  readonly change?: OrderChange;
  /** Why the card was refused; present only when {@link ok} is `false`. */
  readonly reason?: OrderFailReason;
}

/**
 * Whether `card` may be played against `orders`, returning `null` when it may
 * or the {@link OrderFailReason} otherwise. Pure: `orders` is read, never
 * written, so the UI can grey out an unusable card without touching the board.
 *
 * The checks, in order:
 * 1. `"lawless"` — a No-Man's Land refuses every card.
 * 2. `"malformed"` — an unknown card kind, a bad id, or a Standing Order whose
 *    Article is malformed.
 * 3. `"already-active"` — a Standing Order for an Article already in force.
 * 4. `"at-capacity"` — a Standing Order when the posting is already at its cap.
 * 5. `"not-active"` — a Counter-Order for an Article not in force.
 */
export function canPlayOrderCard(orders: BattleOrders, card: OrderCard): OrderFailReason | null {
  if (orders.lawless) return "lawless";
  if (card === null || typeof card !== "object" || !isOrderCardKind(card.kind)) {
    return "malformed";
  }

  if (card.kind === "standingOrder") {
    if (!isValidArticle(card.article)) return "malformed";
    if (hasActiveArticle(orders, asArticleId(card.article.id))) return "already-active";
    if (orders.articles.length >= orders.maxArticles) return "at-capacity";
    return null;
  }

  if (!isValidId(card.articleId)) return "malformed";
  if (!hasActiveArticle(orders, card.articleId)) return "not-active";
  return null;
}

/**
 * Play an order card against `orders`.
 *
 * An accepted card returns `ok: true`, the new {@link BattleOrders} and an
 * {@link OrderChange} describing it: a Standing Order appends its Article to the
 * posting; a Counter-Order removes the named one, preserving the order of the
 * rest. A refused card returns `ok: false`, the **same** board object and the
 * {@link OrderCardResult.reason}; nothing is mutated either way.
 *
 * Purity means a replay that plays the same card at the same point always sees
 * the same posting (`agents.md` §2). Turn ownership is not checked here — the
 * battle layer owns whose Orders Tempo turn it is.
 *
 * ```ts
 * const played = playOrderCard(orders, standingOrderCard(ARTICLES["no-fire"]));
 * if (played.ok) orders = played.orders;
 * ```
 */
export function playOrderCard(orders: BattleOrders, card: OrderCard): OrderCardResult {
  const reason = canPlayOrderCard(orders, card);
  if (reason !== null) {
    return { ok: false, orders, card, reason };
  }

  if (card.kind === "standingOrder") {
    const articles = [...orders.articles, card.article];
    return {
      ok: true,
      orders: { ...orders, articles },
      card,
      change: {
        card: "standingOrder",
        action: "added",
        article: card.article,
        articleId: asArticleId(card.article.id),
        activeCount: articles.length,
      },
    };
  }

  // `canPlayOrderCard` guarantees the Article is active, so `removed` is defined.
  const removed = findActiveArticle(orders, card.articleId) as ArticleDef;
  const articles = orders.articles.filter((article) => article.id !== card.articleId);
  return {
    ok: true,
    orders: { ...orders, articles },
    card,
    change: {
      card: "counterOrder",
      action: "nullified",
      article: removed,
      articleId: card.articleId,
      activeCount: articles.length,
    },
  };
}

/**
 * Convenience wrapper: play a **Standing Order** card that adds `article`.
 * Equivalent to `playOrderCard(orders, standingOrderCard(article))`.
 */
export function applyStandingOrder(orders: BattleOrders, article: ArticleDef): OrderCardResult {
  return playOrderCard(orders, standingOrderCard(article));
}

/**
 * Convenience wrapper: play a **Counter-Order** card that nullifies
 * `articleId`. Equivalent to `playOrderCard(orders, counterOrderCard(articleId))`.
 */
export function applyCounterOrder(orders: BattleOrders, articleId: ArticleId): OrderCardResult {
  return playOrderCard(orders, counterOrderCard(articleId));
}

/* --------------------------------------------------------------------------
 * Internals
 * ------------------------------------------------------------------------ */

/**
 * A light structural check for an Article carried by a Standing Order card.
 * The full field-by-field validation is the data layer's job
 * (`ArticleDefSchema`, T054); here we only need the fields the executor reads,
 * so a card built from an authored Article always passes.
 */
function isValidArticle(article: ArticleDef): boolean {
  return (
    article !== null &&
    typeof article === "object" &&
    isValidId(article.id) &&
    (article.kind === "forbid" || article.kind === "commend")
  );
}

/** The cap must be a non-negative whole number (fail fast on malformed content). */
function assertMaxArticles(maxArticles: number): void {
  if (!Number.isInteger(maxArticles) || maxArticles < 0) {
    throw new RangeError(
      `battle orders maxArticles must be a non-negative integer, received ${String(maxArticles)}`,
    );
  }
}
