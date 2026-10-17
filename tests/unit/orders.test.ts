import { describe, expect, it } from "vitest";

import { ARTICLES } from "../../src/data/articles";
import type { ArticleDef } from "../../src/data/schema";
import {
  MAX_ACTIVE_ARTICLES,
  ORDER_CARD_KINDS,
  ORDER_FAIL_REASONS,
  activeArticleIds,
  applyCounterOrder,
  applyStandingOrder,
  canPlayOrderCard,
  counterOrderCard,
  createBattleOrders,
  findActiveArticle,
  hasActiveArticle,
  isOrderCardKind,
  isOrderFailReason,
  playOrderCard,
  standingOrderCard,
  type BattleOrders,
  type OrderCard,
} from "../../src/engine/actions/orders";
import { asArticleId } from "../../src/engine/ids";

/* --------------------------------------------------------------------------
 * T063 — Standing / Counter-Orders
 *
 * Pins the task's "done when": **cards add or nullify an Article mid-battle;
 * max Articles enforced.** A Standing Order is FFTA's Law Card (adds a law) and
 * a Counter-Order its Anti-Law Card (nullifies a law)
 * (`docs/wiki/pages/Law_system_(Tactics_Advance).md` §"Law Cards"). The
 * executor lives in `src/engine/actions/orders.ts` and stays pure and
 * deterministic (`agents.md` §2): the input board is never mutated, and the cap
 * is the tunable `MAX_ACTIVE_ARTICLES`.
 * ------------------------------------------------------------------------ */

const NO_FIRE = ARTICLES["no-fire"];
const NO_RIFLE = ARTICLES["no-rifle"];
const NO_SABRE = ARTICLES["no-sabre"];
const COMMEND_MUSKET = ARTICLES["commend-musket"];

/* --------------------------------------------------------------------------
 * Cards
 * ------------------------------------------------------------------------ */

describe("order cards", () => {
  it("declares the two FFTA card kinds", () => {
    expect(ORDER_CARD_KINDS).toEqual(["standingOrder", "counterOrder"]);
    for (const kind of ORDER_CARD_KINDS) expect(isOrderCardKind(kind)).toBe(true);
    expect(isOrderCardKind("almighty")).toBe(false);
    expect(isOrderCardKind(3)).toBe(false);
  });

  it("builds a standing-order card carrying its Article by value", () => {
    const card = standingOrderCard(NO_FIRE);
    expect(card).toEqual({ kind: "standingOrder", article: NO_FIRE });
    expect(card.article).toBe(NO_FIRE);
  });

  it("builds a counter-order card naming its Article by id", () => {
    const card = counterOrderCard(asArticleId("no-fire"));
    expect(card).toEqual({ kind: "counterOrder", articleId: asArticleId("no-fire") });
  });

  it("exposes the refusal reasons and their runtime guard", () => {
    expect(ORDER_FAIL_REASONS).toEqual([
      "lawless",
      "malformed",
      "at-capacity",
      "already-active",
      "not-active",
    ]);
    for (const reason of ORDER_FAIL_REASONS) expect(isOrderFailReason(reason)).toBe(true);
    expect(isOrderFailReason("unknown")).toBe(false);
  });
});

/* --------------------------------------------------------------------------
 * The board
 * ------------------------------------------------------------------------ */

describe("createBattleOrders", () => {
  it("defaults to an empty, non-lawless posting at the default cap", () => {
    const orders = createBattleOrders();
    expect(orders.articles).toEqual([]);
    expect(orders.maxArticles).toBe(MAX_ACTIVE_ARTICLES);
    expect(orders.lawless).toBe(false);
    expect(Number.isInteger(MAX_ACTIVE_ARTICLES)).toBe(true);
    expect(MAX_ACTIVE_ARTICLES).toBeGreaterThan(0);
  });

  it("copies the input Articles so the posting cannot alias its source", () => {
    const source = [NO_FIRE, NO_RIFLE];
    const orders = createBattleOrders(source);
    expect(orders.articles).toEqual([NO_FIRE, NO_RIFLE]);
    expect(orders.articles).not.toBe(source);
    source.pop();
    expect(orders.articles).toHaveLength(2);
  });

  it("accepts a custom cap and a lawless flag", () => {
    const orders = createBattleOrders([NO_FIRE], { maxArticles: 2, lawless: true });
    expect(orders.maxArticles).toBe(2);
    expect(orders.lawless).toBe(true);
  });

  it("rejects a malformed posting at the boundary", () => {
    expect(() => createBattleOrders([NO_FIRE, NO_FIRE])).toThrow(/duplicate/);
    expect(() => createBattleOrders([{ id: "" } as unknown as ArticleDef])).toThrow(RangeError);
    expect(() => createBattleOrders([], { maxArticles: -1 })).toThrow(RangeError);
    expect(() => createBattleOrders([], { maxArticles: 1.5 })).toThrow(RangeError);
    expect(() => createBattleOrders([NO_FIRE, NO_RIFLE], { maxArticles: 1 })).toThrow(/exceeds/);
  });
});

describe("active-Article queries", () => {
  const orders = createBattleOrders([NO_FIRE, COMMEND_MUSKET]);

  it("reads membership", () => {
    expect(hasActiveArticle(orders, asArticleId("no-fire"))).toBe(true);
    expect(hasActiveArticle(orders, asArticleId("no-rifle"))).toBe(false);
  });

  it("finds an active Article by id", () => {
    expect(findActiveArticle(orders, asArticleId("commend-musket"))).toBe(COMMEND_MUSKET);
    expect(findActiveArticle(orders, asArticleId("no-sabre"))).toBeUndefined();
  });

  it("lists the active ids in posting order, branded", () => {
    expect(activeArticleIds(orders)).toEqual([
      asArticleId("no-fire"),
      asArticleId("commend-musket"),
    ]);
  });
});

/* --------------------------------------------------------------------------
 * Standing Orders — add an Article
 * ------------------------------------------------------------------------ */

describe("standing orders", () => {
  it("adds an Article to the end of the posting", () => {
    const orders = createBattleOrders([NO_FIRE]);
    const result = playOrderCard(orders, standingOrderCard(NO_RIFLE));

    expect(result.ok).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(result.orders.articles).toEqual([NO_FIRE, NO_RIFLE]);
    expect(result.change).toEqual({
      card: "standingOrder",
      action: "added",
      article: NO_RIFLE,
      articleId: asArticleId("no-rifle"),
      activeCount: 2,
    });
  });

  it("works through the applyStandingOrder convenience", () => {
    const result = applyStandingOrder(createBattleOrders(), NO_SABRE);
    expect(result.ok).toBe(true);
    expect(result.orders.articles).toEqual([NO_SABRE]);
  });

  it("refuses an Article already in force", () => {
    const orders = createBattleOrders([NO_FIRE]);
    const result = playOrderCard(orders, standingOrderCard(NO_FIRE));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("already-active");
    expect(result.orders).toBe(orders);
    expect(result.change).toBeUndefined();
  });

  it("refuses an Article without a usable id", () => {
    const orders = createBattleOrders();
    const broken = { id: "" } as unknown as ArticleDef;
    expect(canPlayOrderCard(orders, standingOrderCard(broken))).toBe("malformed");
  });
});

/* --------------------------------------------------------------------------
 * Counter-Orders — nullify an Article
 * ------------------------------------------------------------------------ */

describe("counter orders", () => {
  it("nullifies an active Article, preserving the rest", () => {
    const orders = createBattleOrders([NO_FIRE, NO_RIFLE, NO_SABRE]);
    const result = playOrderCard(orders, counterOrderCard(asArticleId("no-rifle")));

    expect(result.ok).toBe(true);
    expect(result.orders.articles).toEqual([NO_FIRE, NO_SABRE]);
    expect(result.change).toEqual({
      card: "counterOrder",
      action: "nullified",
      article: NO_RIFLE,
      articleId: asArticleId("no-rifle"),
      activeCount: 2,
    });
  });

  it("works through the applyCounterOrder convenience", () => {
    const result = applyCounterOrder(createBattleOrders([NO_FIRE]), asArticleId("no-fire"));
    expect(result.ok).toBe(true);
    expect(result.orders.articles).toEqual([]);
  });

  it("refuses an Article that is not in force", () => {
    const orders = createBattleOrders([NO_FIRE]);
    const result = playOrderCard(orders, counterOrderCard(asArticleId("no-rifle")));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("not-active");
    expect(result.orders).toBe(orders);
  });

  it("refuses a counter-order with no id", () => {
    const orders = createBattleOrders([NO_FIRE]);
    const result = applyCounterOrder(orders, asArticleId(""));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("malformed");
  });

  it("frees a slot so a new standing order can be played", () => {
    const orders = createBattleOrders([NO_FIRE, NO_RIFLE], { maxArticles: 2 });
    const full = applyStandingOrder(orders, NO_SABRE);
    expect(full.reason).toBe("at-capacity");

    const freed = applyCounterOrder(orders, asArticleId("no-fire"));
    expect(freed.ok).toBe(true);

    const added = applyStandingOrder(freed.orders, NO_SABRE);
    expect(added.ok).toBe(true);
    expect(added.orders.articles).toEqual([NO_RIFLE, NO_SABRE]);
  });
});

/* --------------------------------------------------------------------------
 * The cap
 * ------------------------------------------------------------------------ */

describe("Article cap enforcement", () => {
  it("blocks a standing order once the posting is at capacity", () => {
    const orders = createBattleOrders([NO_FIRE], { maxArticles: 1 });
    const result = applyStandingOrder(orders, NO_RIFLE);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("at-capacity");
    expect(result.orders.articles).toEqual([NO_FIRE]);
  });

  it("fills the posting exactly to the cap", () => {
    let orders: BattleOrders = createBattleOrders([], { maxArticles: 3 });
    for (const article of [NO_FIRE, NO_RIFLE, NO_SABRE]) {
      const result = applyStandingOrder(orders, article);
      expect(result.ok).toBe(true);
      orders = result.orders;
    }
    expect(orders.articles).toHaveLength(3);
    expect(applyStandingOrder(orders, COMMEND_MUSKET).reason).toBe("at-capacity");
  });

  it("leaves headroom above the strictest default posting", () => {
    // The default schedule peaks at three forbidding + two commended Articles.
    expect(MAX_ACTIVE_ARTICLES).toBeGreaterThan(5);
  });
});

/* --------------------------------------------------------------------------
 * Lawless fields (No-Man's Land seam, T065)
 * ------------------------------------------------------------------------ */

describe("lawless fields", () => {
  it("refuses every card in a No-Man's Land", () => {
    const orders = createBattleOrders([NO_FIRE], { lawless: true });
    expect(canPlayOrderCard(orders, standingOrderCard(NO_RIFLE))).toBe("lawless");
    expect(canPlayOrderCard(orders, counterOrderCard(asArticleId("no-fire")))).toBe("lawless");

    const standing = applyStandingOrder(orders, NO_RIFLE);
    const counter = applyCounterOrder(orders, asArticleId("no-fire"));
    expect(standing.ok).toBe(false);
    expect(counter.ok).toBe(false);
    expect(standing.orders).toBe(orders);
    expect(counter.orders).toBe(orders);
  });
});

/* --------------------------------------------------------------------------
 * canPlayOrderCard — a pure preview
 * ------------------------------------------------------------------------ */

describe("canPlayOrderCard", () => {
  it("returns null for a legal card and a reason otherwise", () => {
    const orders = createBattleOrders([NO_FIRE], { maxArticles: 2 });
    expect(canPlayOrderCard(orders, standingOrderCard(NO_RIFLE))).toBeNull();
    expect(canPlayOrderCard(orders, standingOrderCard(NO_FIRE))).toBe("already-active");
    expect(canPlayOrderCard(orders, counterOrderCard(asArticleId("no-fire")))).toBeNull();
    expect(canPlayOrderCard(orders, counterOrderCard(asArticleId("no-rifle")))).toBe("not-active");
  });

  it("rejects a malformed card object", () => {
    const orders = createBattleOrders();
    const notACard = { kind: "almighty" } as unknown as OrderCard;
    expect(canPlayOrderCard(orders, notACard)).toBe("malformed");
    expect(canPlayOrderCard(orders, null as unknown as OrderCard)).toBe("malformed");
  });

  it("does not change the board while previewing", () => {
    const orders = createBattleOrders([NO_FIRE]);
    canPlayOrderCard(orders, standingOrderCard(NO_RIFLE));
    expect(orders.articles).toEqual([NO_FIRE]);
  });
});

/* --------------------------------------------------------------------------
 * Purity & determinism
 * ------------------------------------------------------------------------ */

describe("purity and determinism", () => {
  it("never mutates the input posting array", () => {
    const source = [NO_FIRE, NO_RIFLE];
    const orders = createBattleOrders(source);
    playOrderCard(orders, standingOrderCard(NO_SABRE));
    applyCounterOrder(orders, asArticleId("no-fire"));

    expect(source).toEqual([NO_FIRE, NO_RIFLE]);
    expect(orders.articles).toEqual([NO_FIRE, NO_RIFLE]);
  });

  it("returns equal results for the same board and card", () => {
    const orders = createBattleOrders([NO_FIRE, NO_RIFLE]);
    const first = playOrderCard(orders, standingOrderCard(NO_SABRE));
    const second = playOrderCard(orders, standingOrderCard(NO_SABRE));
    expect(first).toEqual(second);
    expect(first.orders.articles).toEqual(second.orders.articles);
    // A rejected play returns the very same board object (no structural copy).
    const rejected = playOrderCard(orders, standingOrderCard(NO_FIRE));
    expect(rejected.orders).toBe(orders);
  });

  it("chains add and nullify deterministically", () => {
    const start = createBattleOrders([NO_FIRE], { maxArticles: 3 });
    const added = applyStandingOrder(start, NO_RIFLE).orders;
    const addedAgain = applyStandingOrder(added, NO_SABRE).orders;
    const removed = applyCounterOrder(addedAgain, asArticleId("no-rifle")).orders;
    expect(activeArticleIds(removed)).toEqual([asArticleId("no-fire"), asArticleId("no-sabre")]);
  });
});

/* --------------------------------------------------------------------------
 * Authored content
 * ------------------------------------------------------------------------ */

describe("authored Articles", () => {
  it("plays a real forbidding Article as a standing order", () => {
    const orders = createBattleOrders([NO_FIRE]);
    const result = applyStandingOrder(orders, NO_RIFLE);
    expect(result.ok).toBe(true);
    expect(findActiveArticle(result.orders, asArticleId("no-rifle"))).toBe(NO_RIFLE);
  });

  it("nullifies a real commended Article with a counter-order", () => {
    const orders = createBattleOrders([NO_FIRE, COMMEND_MUSKET]);
    const result = applyCounterOrder(orders, asArticleId("commend-musket"));
    expect(result.ok).toBe(true);
    expect(result.change?.card).toBe("counterOrder");
    expect(result.change?.article).toBe(COMMEND_MUSKET);
    expect(result.orders.articles).toEqual([NO_FIRE]);
  });
});
