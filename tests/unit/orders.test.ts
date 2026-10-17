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
import { asArticleId, asGeneralOrderId } from "../../src/engine/ids";
import {
  DEFAULT_GENERAL_ORDER_USES,
  GENERAL_ORDER_FAIL_REASONS,
  canInvokeGeneralOrder,
  createGeneralOrders,
  findGeneralOrder,
  grantGeneralOrder,
  hasGeneralOrder,
  invokeGeneralOrder,
  isGeneralOrderFailReason,
  remainingUses,
  type GeneralOrder,
} from "../../src/engine/rules/generalOrders";

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

/* --------------------------------------------------------------------------
 * T064 — General Orders (company privileges)
 *
 * Pins the task's "done when": **company privilege nullifies one active
 * Article.** A General Order is FFTA's Advanced Law, rethemed as an earned
 * Regimental Honour the company may invoke to waive one standing order
 * (mapping §9). The executor lives in `src/engine/rules/generalOrders.ts` and
 * composes the T063 counter-order mechanic, so nullification keeps its one
 * definition. It stays pure and deterministic (`agents.md` §2).
 * ------------------------------------------------------------------------ */

const ROYAL_WARRANT: GeneralOrder = {
  id: asGeneralOrderId("royal-warrant"),
  name: "Royal Warrant",
  description: "The company's charter waives one standing order.",
  flavour: "The colonel's seal carries more weight than the provost's ledger.",
};

const COLONELS_DISCRETION: GeneralOrder = {
  id: asGeneralOrderId("colonels-discretion"),
  name: "Colonel's Discretion",
  description: "A trusted colonel may waive two standing orders in an action.",
  flavour: "A good colonel knows which orders win the day and which lose it.",
  uses: 2,
};

describe("general order board", () => {
  it("starts empty", () => {
    const board = createGeneralOrders();
    expect(board.holdings).toEqual([]);
    expect(DEFAULT_GENERAL_ORDER_USES).toBe(1);
  });

  it("grants each privilege its full uses, defaulting to one", () => {
    const board = createGeneralOrders([ROYAL_WARRANT, COLONELS_DISCRETION]);
    expect(remainingUses(board, ROYAL_WARRANT.id)).toBe(1);
    expect(remainingUses(board, COLONELS_DISCRETION.id)).toBe(2);
    expect(hasGeneralOrder(board, ROYAL_WARRANT.id)).toBe(true);
    expect(findGeneralOrder(board, ROYAL_WARRANT.id)?.order).toBe(ROYAL_WARRANT);
  });

  it("reports an unheld privilege as zero uses", () => {
    const board = createGeneralOrders();
    expect(hasGeneralOrder(board, ROYAL_WARRANT.id)).toBe(false);
    expect(remainingUses(board, ROYAL_WARRANT.id)).toBe(0);
    expect(findGeneralOrder(board, ROYAL_WARRANT.id)).toBeUndefined();
  });

  it("rejects malformed privileges at the boundary", () => {
    expect(() =>
      createGeneralOrders([{ id: "" } as unknown as GeneralOrder]),
    ).toThrow(/non-empty id/);
    expect(() =>
      createGeneralOrders([{ ...ROYAL_WARRANT, uses: 1.5 }]),
    ).toThrow(/positive integer/);
    expect(() =>
      createGeneralOrders([{ ...ROYAL_WARRANT, uses: 0 }]),
    ).toThrow(/positive integer/);
    expect(() => createGeneralOrders([ROYAL_WARRANT, ROYAL_WARRANT])).toThrow(/duplicate/);
  });

  it("grants a further privilege to an existing board without mutation", () => {
    const board = createGeneralOrders([ROYAL_WARRANT]);
    const withSecond = grantGeneralOrder(board, COLONELS_DISCRETION);
    expect(board.holdings).toHaveLength(1);
    expect(withSecond.holdings).toHaveLength(2);
    expect(() => grantGeneralOrder(withSecond, ROYAL_WARRANT)).toThrow(/already held/);
  });
});

describe("general order invocation", () => {
  it("nullifies one active Article via a company privilege", () => {
    const orders = createBattleOrders([NO_FIRE, NO_RIFLE]);
    const board = createGeneralOrders([ROYAL_WARRANT]);
    const result = invokeGeneralOrder(board, orders, ROYAL_WARRANT.id);

    expect(result.ok).toBe(true);
    expect(result.orders.articles).toEqual([NO_RIFLE]);
    expect(result.change).toEqual({
      orderId: ROYAL_WARRANT.id,
      action: "nullified",
      article: NO_FIRE,
      articleId: asArticleId("no-fire"),
      activeCount: 1,
      remainingUses: 0,
    });
    expect(remainingUses(result.generalOrders, ROYAL_WARRANT.id)).toBe(0);
  });

  it("waives the first Article when no target is named", () => {
    const orders = createBattleOrders([NO_FIRE, NO_RIFLE, NO_SABRE]);
    const board = createGeneralOrders([ROYAL_WARRANT]);
    const result = invokeGeneralOrder(board, orders, ROYAL_WARRANT.id);
    expect(result.change?.articleId).toBe(asArticleId("no-fire"));
    expect(result.orders.articles).toEqual([NO_RIFLE, NO_SABRE]);
  });

  it("waives a named Article, preserving the rest", () => {
    const orders = createBattleOrders([NO_FIRE, NO_RIFLE, NO_SABRE]);
    const board = createGeneralOrders([ROYAL_WARRANT]);
    const result = invokeGeneralOrder(
      board,
      orders,
      ROYAL_WARRANT.id,
      asArticleId("no-rifle"),
    );
    expect(result.ok).toBe(true);
    expect(result.change?.article).toBe(NO_RIFLE);
    expect(result.orders.articles).toEqual([NO_FIRE, NO_SABRE]);
  });

  it("spends one use per invocation and honors a larger pool", () => {
    let orders = createBattleOrders([NO_FIRE, NO_RIFLE], { maxArticles: 3 });
    let board = createGeneralOrders([COLONELS_DISCRETION]);

    const first = invokeGeneralOrder(board, orders, COLONELS_DISCRETION.id);
    expect(first.ok).toBe(true);
    expect(remainingUses(first.generalOrders, COLONELS_DISCRETION.id)).toBe(1);
    orders = first.orders;
    board = first.generalOrders;

    const second = invokeGeneralOrder(board, orders, COLONELS_DISCRETION.id);
    expect(second.ok).toBe(true);
    expect(second.orders.articles).toEqual([]);
    expect(remainingUses(second.generalOrders, COLONELS_DISCRETION.id)).toBe(0);
  });

  it("refuses once the privilege is exhausted", () => {
    const orders = createBattleOrders([NO_FIRE, NO_RIFLE]);
    const board = createGeneralOrders([ROYAL_WARRANT]);
    const first = invokeGeneralOrder(board, orders, ROYAL_WARRANT.id);
    const second = invokeGeneralOrder(first.generalOrders, first.orders, ROYAL_WARRANT.id);
    expect(second.ok).toBe(false);
    expect(second.reason).toBe("exhausted");
    expect(second.orders).toBe(first.orders);
    expect(second.generalOrders).toBe(first.generalOrders);
  });

  it("refuses a privilege the company does not hold", () => {
    const orders = createBattleOrders([NO_FIRE]);
    const board = createGeneralOrders();
    expect(canInvokeGeneralOrder(board, orders, ROYAL_WARRANT.id)).toBe("unknown-order");
    const result = invokeGeneralOrder(board, orders, ROYAL_WARRANT.id);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("unknown-order");
  });

  it("refuses when no Article is in force", () => {
    const orders = createBattleOrders();
    const board = createGeneralOrders([ROYAL_WARRANT]);
    expect(canInvokeGeneralOrder(board, orders, ROYAL_WARRANT.id)).toBe("no-target");
  });

  it("refuses a named Article that is not active", () => {
    const orders = createBattleOrders([NO_FIRE]);
    const board = createGeneralOrders([ROYAL_WARRANT]);
    const reason = canInvokeGeneralOrder(
      board,
      orders,
      ROYAL_WARRANT.id,
      asArticleId("no-rifle"),
    );
    expect(reason).toBe("not-active");
  });

  it("refuses in a lawless No-Man's Land", () => {
    const orders = createBattleOrders([NO_FIRE], { lawless: true });
    const board = createGeneralOrders([ROYAL_WARRANT]);
    expect(canInvokeGeneralOrder(board, orders, ROYAL_WARRANT.id)).toBe("lawless");
    const result = invokeGeneralOrder(board, orders, ROYAL_WARRANT.id);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("lawless");
    expect(result.orders).toBe(orders);
  });

  it("exposes the failure reasons and their runtime guard", () => {
    expect(GENERAL_ORDER_FAIL_REASONS).toEqual([
      "lawless",
      "unknown-order",
      "exhausted",
      "no-target",
      "not-active",
    ]);
    for (const reason of GENERAL_ORDER_FAIL_REASONS) {
      expect(isGeneralOrderFailReason(reason)).toBe(true);
    }
    expect(isGeneralOrderFailReason("at-capacity")).toBe(false);
  });
});

describe("general order purity and determinism", () => {
  it("never mutates the board or the posting", () => {
    const source = [NO_FIRE, NO_RIFLE];
    const orders = createBattleOrders(source);
    const board = createGeneralOrders([ROYAL_WARRANT]);
    invokeGeneralOrder(board, orders, ROYAL_WARRANT.id);

    expect(source).toEqual([NO_FIRE, NO_RIFLE]);
    expect(orders.articles).toEqual([NO_FIRE, NO_RIFLE]);
    expect(board.holdings[0]?.remaining).toBe(1);
  });

  it("returns equal results for the same input", () => {
    const orders = createBattleOrders([NO_FIRE, NO_RIFLE]);
    const board = createGeneralOrders([ROYAL_WARRANT]);
    const first = invokeGeneralOrder(board, orders, ROYAL_WARRANT.id);
    const second = invokeGeneralOrder(board, orders, ROYAL_WARRANT.id);
    expect(first).toEqual(second);
    expect(first.orders.articles).toEqual(second.orders.articles);
  });

  it("does not change state while previewing", () => {
    const orders = createBattleOrders([NO_FIRE, NO_RIFLE]);
    const board = createGeneralOrders([ROYAL_WARRANT]);
    expect(canInvokeGeneralOrder(board, orders, ROYAL_WARRANT.id)).toBeNull();
    expect(orders.articles).toEqual([NO_FIRE, NO_RIFLE]);
    expect(remainingUses(board, ROYAL_WARRANT.id)).toBe(1);
  });
});
