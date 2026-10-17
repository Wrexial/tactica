import { describe, expect, it } from "vitest";

import {
  ARTICLE_KEYS,
  ARTICLE_LIST,
  ARTICLES,
  articleCommends,
  articleCoversKey,
  articleForbids,
  articlesForTarget,
  articlesOfKind,
  commendingArticles,
  forbiddingArticles,
  getArticle,
  isArticleKey,
  type ArticleKey,
} from "../../src/data/articles";
import { CONDITION_KEYS } from "../../src/data/conditions";
import { EQUIPMENT_LIST } from "../../src/data/equipment";
import { POST_KEYS } from "../../src/data/posts";
import {
  ARTICLE_KINDS,
  ARTICLE_TARGETS,
  ArticleDefSchema,
  ELEMENT_KEYS,
  WEAPON_TYPES,
  type ArticleDef,
  type ArticleTarget,
} from "../../src/data/schema";
import { asRegionId } from "../../src/engine/ids";
import { Rng } from "../../src/engine/rng";
import {
  DEFAULT_ARTICLE_FREQUENCY,
  articleFactsOf,
  articleSubjectOfAction,
  buildArticlePool,
  detectArticles,
  drawDailyArticles,
  firstBreach,
  frequencyForDay,
  generateDailyArticles,
  matchArticle,
  type ArticleFrequencyStep,
} from "../../src/engine/rules/articles";

/* --------------------------------------------------------------------------
 * T054 — Article definition
 *
 * Pins the task's "done when": `ArticleDef` can **forbid or commend actions,
 * elements, weapon types, posts and conditions** (mapping §9). The data lives
 * in `src/data/articles.ts`; the daily draw and enforcement arrive in T055/T056.
 * The tests also guard the important content invariant — every key an Article
 * names must be a real authored id of its target class, so a typo fails here
 * rather than silently disarming a standing order.
 * ------------------------------------------------------------------------ */

/** The five target classes the task requires the pool to cover. */
const REQUIRED_TARGETS = ["action", "element", "weapon", "post", "condition"] as const;

/** The known-valid ids each target's `keys` may reference. */
const TARGET_KEY_SETS: Record<ArticleTarget, ReadonlySet<string>> = {
  // Actions are ability ids. The ability collection lands in Phase 8 (T089);
  // until then the ids taught by authored kit (T050) are the known set.
  action: new Set(EQUIPMENT_LIST.flatMap((item) => item.teaches.map((teach) => teach.abilityId))),
  element: new Set(ELEMENT_KEYS),
  weapon: new Set(WEAPON_TYPES),
  post: new Set(POST_KEYS),
  condition: new Set(CONDITION_KEYS),
  move: new Set<string>(),
  item: new Set<string>(),
};

const PLACEHOLDER_RE = /\b(TBD|TBC|TODO|FIXME|XXX|placeholder)\b/i;

/* --------------------------------------------------------------------------
 * The authored pool
 * ------------------------------------------------------------------------ */

describe("authored Articles (data/articles.ts)", () => {
  it("authors exactly the declared keys, with no duplicates", () => {
    expect(ARTICLE_LIST).toHaveLength(ARTICLE_KEYS.length);
    expect(Object.keys(ARTICLES)).toHaveLength(ARTICLE_KEYS.length);
    expect(new Set(ARTICLE_KEYS).size).toBe(ARTICLE_KEYS.length);
    expect(ARTICLE_LIST.map((article) => article.id)).toEqual([...ARTICLE_KEYS]);
  });

  it("round-trips every Article through the schema", () => {
    for (const id of ARTICLE_KEYS) {
      const article = ARTICLES[id];
      expect(article.id).toBe(id);
      expect(ArticleDefSchema.parse(article)).toEqual(article);
    }
  });

  it("carries authored Napoleonic prose with no placeholders", () => {
    for (const article of ARTICLE_LIST) {
      for (const field of ["name", "description", "flavour"] as const) {
        const text = article[field];
        expect(text.trim(), `${article.id}.${field}`).not.toBe("");
        expect(PLACEHOLDER_RE.test(text), `${article.id}.${field}`).toBe(false);
      }
      // The id is a mechanical handle, never the display name.
      expect(article.name.toLowerCase()).not.toBe(article.id.toLowerCase());
    }
  });

  it("keeps the FFTA-shaped id but the Napoleonic display name", () => {
    expect(ARTICLES["no-fire"].id).toBe("no-fire");
    expect(ARTICLES["no-fire"].name).toBe("No Incendiary");
    expect(ARTICLES["commend-colours"].name).toBe("Commended: Colours");
  });
});

/* --------------------------------------------------------------------------
 * Target & key coverage
 * ------------------------------------------------------------------------ */

describe("Article targets & keys", () => {
  it("covers every required target with both a forbid and a commend Article", () => {
    for (const target of REQUIRED_TARGETS) {
      expect(forbiddingArticles(target).length, `forbid ${target}`).toBeGreaterThan(0);
      expect(commendingArticles(target).length, `commend ${target}`).toBeGreaterThan(0);
    }
  });

  it("only names real authored ids of the Article's target class", () => {
    for (const article of ARTICLE_LIST) {
      const valid = TARGET_KEY_SETS[article.target];
      expect(article.keys.length, `${article.id} names no key`).toBeGreaterThan(0);
      for (const key of article.keys) {
        expect(valid.has(key), `${article.id} names unknown ${article.target} "${key}"`).toBe(true);
      }
    }
  });

  it("targets and kinds are all schema members", () => {
    for (const article of ARTICLE_LIST) {
      expect(ARTICLE_TARGETS).toContain(article.target);
      expect(ARTICLE_KINDS).toContain(article.kind);
    }
  });
});

/* --------------------------------------------------------------------------
 * Enforcement fields
 * ------------------------------------------------------------------------ */

describe("Article enforcement fields", () => {
  it("grants Honour only on commend Articles", () => {
    for (const article of ARTICLE_LIST) {
      if (article.kind === "forbid") {
        expect(article.honour, article.id).toBe(0);
      } else {
        expect(article.honour, article.id).toBeGreaterThan(0);
      }
    }
  });

  it("uses a valid severity and only opens grave Articles at court-martial", () => {
    const courtMartial = ARTICLE_LIST.filter((a) => a.severity === "court-martial");
    expect(courtMartial.map((a) => a.id).sort()).toEqual(["no-dark", "no-poison"]);
  });

  it("gives every Article a positive draw weight", () => {
    for (const article of ARTICLE_LIST) {
      expect(article.weight, article.id).toBeGreaterThan(0);
    }
  });
});

/* --------------------------------------------------------------------------
 * Lookups
 * ------------------------------------------------------------------------ */

describe("Article lookups", () => {
  it("guards known keys", () => {
    expect(isArticleKey("no-fire")).toBe(true);
    expect(isArticleKey("commend-colours")).toBe(true);
    for (const value of ["fire", "", 1, null, undefined, {}]) {
      expect(isArticleKey(value)).toBe(false);
    }
  });

  it("looks up by key and throws on an unknown id", () => {
    expect(getArticle("no-rifle")).toEqual(ARTICLES["no-rifle"]);
    expect(() => getArticle("no-such-order" as ArticleKey)).toThrow(RangeError);
  });

  it("filters by kind", () => {
    expect(articlesOfKind("forbid").every((a) => a.kind === "forbid")).toBe(true);
    expect(articlesOfKind("commend").every((a) => a.kind === "commend")).toBe(true);
    expect(articlesOfKind("forbid").length + articlesOfKind("commend").length).toBe(
      ARTICLE_LIST.length,
    );
  });

  it("filters by target and kind", () => {
    expect(articlesForTarget("weapon").map((a) => a.id)).toEqual([
      "no-rifle",
      "no-sabre",
      "no-gun",
      "commend-musket",
    ]);
    expect(forbiddingArticles("weapon").map((a) => a.id)).toEqual([
      "no-rifle",
      "no-sabre",
      "no-gun",
    ]);
    expect(commendingArticles("weapon").map((a) => a.id)).toEqual(["commend-musket"]);
    expect(articlesForTarget("item")).toEqual([]);
  });
});

/* --------------------------------------------------------------------------
 * Matching helpers
 * ------------------------------------------------------------------------ */

describe("Article matching", () => {
  it("matches a named key under the right target and kind", () => {
    const noFire = ARTICLES["no-fire"];
    expect(articleCoversKey(noFire, "fire")).toBe(true);
    expect(articleCoversKey(noFire, "ice")).toBe(false);
    expect(articleForbids(noFire, "element", "fire")).toBe(true);
    expect(articleForbids(noFire, "element", "ice")).toBe(false);
    // Wrong target never matches, even with the right key.
    expect(articleForbids(noFire, "action", "fire")).toBe(false);
    // A forbid Article never reads as a commend.
    expect(articleCommends(noFire, "element", "fire")).toBe(false);
  });

  it("matches a commended key", () => {
    const colours = ARTICLES["commend-colours"];
    expect(articleCommends(colours, "element", "holy")).toBe(true);
    expect(articleCommends(colours, "element", "dark")).toBe(false);
    expect(articleForbids(colours, "element", "holy")).toBe(false);
  });

  it("treats an empty key list as 'any act of this target class'", () => {
    const anyMove = ArticleDefSchema.parse({
      id: "no-withdrawal",
      name: "No Withdrawal",
      description: "Falling back is forbidden today.",
      flavour: "The line holds where it stands.",
      kind: "forbid",
      target: "move",
    });
    expect(anyMove.keys).toEqual([]);
    expect(articleCoversKey(anyMove, "move")).toBe(true);
    expect(articleCoversKey(anyMove, "sabre")).toBe(true);
    expect(articleForbids(anyMove, "move", "anything")).toBe(true);
    expect(articleForbids(anyMove, "action", "anything")).toBe(false);
  });
});

/* --------------------------------------------------------------------------
 * T055 — Daily orders generation
 *
 * Pins the task's "done when": **seeded daily Articles per campaign day, with
 * a pool and frequency model**. The generation lives in
 * `src/engine/rules/articles.ts`; it consumes the T054 pool above and stays
 * pure/deterministic (`agents.md` §2). The tests cover determinism, the
 * day-based frequency schedule, weighted selection, region scoping and the
 * validation boundary.
 * ------------------------------------------------------------------------ */

/** Minimal, valid Article factory for pool/weight/region edge cases. */
function makeArticle(
  overrides: Partial<ArticleDef> & Pick<ArticleDef, "id" | "kind" | "target">,
): ArticleDef {
  return ArticleDefSchema.parse({
    name: `Order ${overrides.id}`,
    description: "A standing order.",
    flavour: "The Provost has spoken.",
    ...overrides,
  });
}

describe("daily Article generation (T055)", () => {
  it("is deterministic for the same seed and campaign day", () => {
    const a = generateDailyArticles("waterloo-1815", 12);
    const b = generateDailyArticles("waterloo-1815", 12);
    expect(a).toEqual(b);
    expect(a.ids).toEqual(b.ids);
  });

  it("derives each day independently of generation order", () => {
    const day3First = generateDailyArticles(42, 3);
    generateDailyArticles(42, 7);
    const day7Later = generateDailyArticles(42, 7);
    const day7First = generateDailyArticles(42, 7);
    generateDailyArticles(42, 3);
    const day3Later = generateDailyArticles(42, 3);
    expect(day3Later).toEqual(day3First);
    expect(day7Later).toEqual(day7First);
  });

  it("varies the posting across days", () => {
    const postings = new Set(
      Array.from({ length: 12 }, (_, i) => generateDailyArticles("campaign", i + 1).ids.join(",")),
    );
    expect(postings.size).toBeGreaterThan(1);
  });

  it("varies the posting across campaign seeds", () => {
    const differs = Array.from({ length: 40 }, (_, i) => i + 1).some(
      (day) =>
        generateDailyArticles("alpha", day).ids.join(",") !==
        generateDailyArticles("bravo", day).ids.join(","),
    );
    expect(differs).toBe(true);
  });

  it("draws exactly the frequency's forbid and commend counts", () => {
    const orders = generateDailyArticles("seed", 12);
    expect(orders.day).toBe(12);
    expect(orders.frequency).toEqual(frequencyForDay(12));
    expect(orders.forbidden).toHaveLength(orders.frequency.forbid);
    expect(orders.commended).toHaveLength(orders.frequency.commend);
    expect(orders.articles).toHaveLength(orders.frequency.forbid + orders.frequency.commend);
    expect(orders.forbidden.every((a) => a.kind === "forbid")).toBe(true);
    expect(orders.commended.every((a) => a.kind === "commend")).toBe(true);
  });

  it("returns articles and their branded ids in the same order", () => {
    const orders = generateDailyArticles("seed", 5);
    expect(orders.ids).toEqual(orders.articles.map((a) => a.id));
    expect(orders.articles).toEqual([...orders.forbidden, ...orders.commended]);
  });

  it("caps a draw at the eligible pool size", () => {
    const orders = generateDailyArticles("seed", 1, { frequency: { forbid: 999, commend: 999 } });
    expect(orders.forbidden).toHaveLength(10); // authored forbidding Articles
    expect(orders.commended).toHaveLength(6); // authored commended Articles
  });

  it("draws the requested counts from a tiny custom pool", () => {
    const pool: ArticleDef[] = [
      makeArticle({ id: "no-a", kind: "forbid", target: "action" }),
      makeArticle({ id: "no-b", kind: "forbid", target: "weapon" }),
      makeArticle({ id: "commend-a", kind: "commend", target: "action", honour: 1 }),
    ];
    const orders = generateDailyArticles("seed", 1, {
      pool,
      frequency: { forbid: 1, commend: 1 },
    });
    expect(orders.forbidden).toHaveLength(1);
    expect(orders.commended).toHaveLength(1);
    expect(orders.articles.every((a) => pool.includes(a))).toBe(true);
  });

  it("rejects invalid campaign days and malformed frequencies", () => {
    expect(() => generateDailyArticles("seed", 0)).toThrow(RangeError);
    expect(() => generateDailyArticles("seed", -3)).toThrow(RangeError);
    expect(() => generateDailyArticles("seed", 1.5)).toThrow(RangeError);
    expect(() =>
      generateDailyArticles("seed", 1, { frequency: { forbid: -1, commend: 0 } }),
    ).toThrow(RangeError);
    expect(() =>
      generateDailyArticles("seed", 1, { frequency: { forbid: 0, commend: 1.5 } }),
    ).toThrow(RangeError);
  });
});

describe("daily Article frequency model (T055)", () => {
  it("escalates the counts over the campaign by default", () => {
    expect(frequencyForDay(1)).toEqual({ forbid: 1, commend: 1 });
    expect(frequencyForDay(7)).toEqual({ forbid: 1, commend: 1 });
    expect(frequencyForDay(8)).toEqual({ forbid: 2, commend: 1 });
    expect(frequencyForDay(16)).toEqual({ forbid: 2, commend: 2 });
    expect(frequencyForDay(32)).toEqual({ forbid: 3, commend: 2 });
    expect(frequencyForDay(999)).toEqual({ forbid: 3, commend: 2 });
  });

  it("never decreases a count as the campaign advances", () => {
    let previous = { forbid: 0, commend: 0 };
    for (let day = 1; day <= 64; day++) {
      const current = frequencyForDay(day);
      expect(current.forbid).toBeGreaterThanOrEqual(previous.forbid);
      expect(current.commend).toBeGreaterThanOrEqual(previous.commend);
      previous = current;
    }
  });

  it("starts the default schedule at day 1", () => {
    expect(DEFAULT_ARTICLE_FREQUENCY[0]?.fromDay).toBe(1);
  });

  it("accepts a custom schedule and ignores steps not yet reached", () => {
    const schedule: readonly ArticleFrequencyStep[] = [
      { fromDay: 1, forbid: 0, commend: 3 },
      { fromDay: 10, forbid: 1, commend: 3 },
    ];
    expect(frequencyForDay(1, schedule)).toEqual({ forbid: 0, commend: 3 });
    expect(frequencyForDay(9, schedule)).toEqual({ forbid: 0, commend: 3 });
    expect(frequencyForDay(10, schedule)).toEqual({ forbid: 1, commend: 3 });
  });

  it("rejects an empty, unsorted or malformed schedule", () => {
    expect(() => frequencyForDay(1, [])).toThrow(RangeError);
    expect(() =>
      frequencyForDay(1, [
        { fromDay: 5, forbid: 1, commend: 0 },
        { fromDay: 3, forbid: 1, commend: 0 },
      ]),
    ).toThrow(RangeError);
    expect(() => frequencyForDay(1, [{ fromDay: 0, forbid: 1, commend: 0 }])).toThrow(RangeError);
    expect(() => frequencyForDay(1, [{ fromDay: 5, forbid: 1, commend: 0 }])).toThrow(RangeError);
    expect(() => frequencyForDay(1, [{ fromDay: 1, forbid: -1, commend: 0 }])).toThrow(RangeError);
  });
});

describe("Article pool & weighting (T055)", () => {
  it("scopes region Articles to their region and keeps global ones", () => {
    const global = makeArticle({ id: "no-global", kind: "forbid", target: "action" });
    const peninsula = makeArticle({
      id: "no-peninsula",
      kind: "forbid",
      target: "weapon",
      regionId: "peninsula",
    });
    const steppe = makeArticle({
      id: "no-steppe",
      kind: "forbid",
      target: "element",
      regionId: "steppe",
    });
    const source = [global, peninsula, steppe];

    expect(buildArticlePool({ articles: source }).all).toEqual([global]);
    expect(buildArticlePool({ articles: source, regionId: asRegionId("peninsula") }).all).toEqual([
      global,
      peninsula,
    ]);
    expect(buildArticlePool({ articles: source, regionId: asRegionId("steppe") }).all).toEqual([
      global,
      steppe,
    ]);
  });

  it("splits the pool by kind", () => {
    const pool = buildArticlePool();
    expect(pool.all).toEqual(ARTICLE_LIST);
    expect(pool.forbid).toEqual(ARTICLE_LIST.filter((a) => a.kind === "forbid"));
    expect(pool.commend).toEqual(ARTICLE_LIST.filter((a) => a.kind === "commend"));
  });

  it("never draws a zero-weight Article while weighted ones remain", () => {
    const pool: ArticleDef[] = [
      makeArticle({ id: "no-never", kind: "forbid", target: "action", weight: 0 }),
      makeArticle({ id: "no-always", kind: "forbid", target: "weapon", weight: 1 }),
    ];
    for (let day = 1; day <= 50; day++) {
      const orders = generateDailyArticles("weighted", day, {
        pool,
        frequency: { forbid: 1, commend: 0 },
      });
      expect(orders.ids).toEqual(["no-always"]);
    }
  });

  it("uses the supplied generator and advances it", () => {
    const rng = new Rng("external");
    const before = rng.calls;
    const orders = drawDailyArticles(rng, 4);
    expect(rng.calls).toBeGreaterThan(before);
    expect(orders.day).toBe(4);
    expect(orders.ids.length).toBeGreaterThan(0);
  });
});

/* --------------------------------------------------------------------------
 * T056 — Violation detection
 *
 * Pins the task's "done when": **actions are checked against the active
 * Articles at resolution time**. Detection lives in
 * `src/engine/rules/articles.ts` and consumes the T054 pool plus the facts of a
 * resolved action, staying pure and deterministic (`agents.md` §2). The tests
 * cover every target class, the empty-key "any act" form, the split between
 * broken and commended orders, and the fact-derivation helper the action
 * executor (T041) will hand its data to.
 * ------------------------------------------------------------------------ */

describe("Article violation detection (T056)", () => {
  it("detects a forbidden action by its ability id", () => {
    const verdict = detectArticles([ARTICLES["no-canister-shot"]], {
      actionId: "canister-shot",
    });
    expect(verdict.broken.map((match) => match.article.id)).toEqual(["no-canister-shot"]);
    expect(verdict.broken[0]?.target).toBe("action");
    expect(verdict.broken[0]?.key).toBe("canister-shot");
    expect(verdict.commended).toEqual([]);
    expect(verdict.unlawful).toBe(true);
  });

  it("detects each of the five authored target classes", () => {
    expect(
      detectArticles([ARTICLES["no-fire"]], { elements: ["fire"] }).broken.map((m) => m.article.id),
    ).toEqual(["no-fire"]);
    expect(
      detectArticles([ARTICLES["no-rifle"]], { weaponTypes: ["rifle"] }).broken.map(
        (m) => m.article.id,
      ),
    ).toEqual(["no-rifle"]);
    expect(
      detectArticles([ARTICLES["no-forager"]], { postId: "forager" }).broken.map(
        (m) => m.article.id,
      ),
    ).toEqual(["no-forager"]);
    expect(
      detectArticles([ARTICLES["no-poison"]], { inflicts: ["poison"] }).broken.map(
        (m) => m.article.id,
      ),
    ).toEqual(["no-poison"]);
  });

  it("does not match the wrong target class or an unrelated key", () => {
    expect(detectArticles([ARTICLES["no-fire"]], { elements: ["ice"] }).broken).toEqual([]);
    expect(detectArticles([ARTICLES["no-fire"]], { actionId: "volley-fire" }).broken).toEqual([]);
    expect(detectArticles([ARTICLES["no-rifle"]], { weaponTypes: ["musket"] }).broken).toEqual([]);
  });

  it("treats an empty key list as 'any act of this target class'", () => {
    const noWithdrawal = makeArticle({ id: "no-withdrawal", kind: "forbid", target: "move" });
    expect(detectArticles([noWithdrawal], { moved: true }).broken.map((m) => m.article.id)).toEqual(
      ["no-withdrawal"],
    );
    expect(detectArticles([noWithdrawal], { moved: false }).broken).toEqual([]);
    expect(detectArticles([noWithdrawal], { actionId: "volley-fire" }).broken).toEqual([]);
  });

  it("detects item breaches by item id", () => {
    const noLooting = makeArticle({
      id: "no-looting",
      kind: "forbid",
      target: "item",
      keys: ["loot-chest"],
    });
    expect(detectArticles([noLooting], { itemIds: ["loot-chest"] }).broken).toHaveLength(1);
    expect(detectArticles([noLooting], { itemIds: ["field-dressing"] }).broken).toEqual([]);
  });

  it("separates broken orders from commended acts", () => {
    const active = [ARTICLES["no-fire"], ARTICLES["commend-colours"]];
    const verdict = detectArticles(active, { elements: ["fire", "holy"] });
    expect(verdict.broken.map((m) => m.article.id)).toEqual(["no-fire"]);
    expect(verdict.commended.map((m) => m.article.id)).toEqual(["commend-colours"]);
    expect(verdict.unlawful).toBe(true);
  });

  it("can both break one order and earn another", () => {
    const active = [ARTICLES["no-canister-shot"], ARTICLES["commend-volley-fire"]];
    const verdict = detectArticles(active, { actionId: "canister-shot" });
    expect(verdict.broken.map((m) => m.article.id)).toEqual(["no-canister-shot"]);
    expect(verdict.commended).toEqual([]);

    // A single action that matches both kinds is reported on both sides.
    const both = makeArticle({
      id: "commend-canister",
      kind: "commend",
      target: "action",
      keys: ["canister-shot"],
      honour: 1,
    });
    const combined = detectArticles([ARTICLES["no-canister-shot"], both], {
      actionId: "canister-shot",
    });
    expect(combined.broken.map((m) => m.article.id)).toEqual(["no-canister-shot"]);
    expect(combined.commended.map((m) => m.article.id)).toEqual(["commend-canister"]);
  });

  it("only considers the active Articles, not the whole pool", () => {
    // `no-fire` is authored forbidden, but it is not in force today.
    const verdict = detectArticles([ARTICLES["no-rifle"]], {
      elements: ["fire"],
      weaponTypes: ["rifle"],
    });
    expect(verdict.broken.map((m) => m.article.id)).toEqual(["no-rifle"]);
  });

  it("reports every matching Article in active order", () => {
    const verdict = detectArticles(
      [ARTICLES["no-dark"], ARTICLES["no-fire"], ARTICLES["no-rifle"]],
      { elements: ["fire", "dark"], weaponTypes: ["rifle"] },
    );
    expect(verdict.broken.map((m) => m.article.id)).toEqual(["no-dark", "no-fire", "no-rifle"]);
  });

  it("exposes the first breach and its severity for the next card", () => {
    const verdict = detectArticles([ARTICLES["no-poison"], ARTICLES["no-rifle"]], {
      inflicts: ["poison"],
    });
    const breach = firstBreach(verdict);
    expect(breach?.article.id).toBe("no-poison");
    expect(breach?.article.severity).toBe("court-martial");
    expect(firstBreach(detectArticles([], {}))).toBeUndefined();
  });

  it("flattens a subject into ordered facts", () => {
    expect(
      articleFactsOf({
        actionId: "canister-shot",
        elements: ["fire", "dark"],
        weaponTypes: ["gun"],
        postId: "artilleryman",
        inflicts: ["blind"],
        moved: true,
        itemIds: ["six-pounder"],
      }),
    ).toEqual([
      { target: "action", key: "canister-shot" },
      { target: "element", key: "fire" },
      { target: "element", key: "dark" },
      { target: "weapon", key: "gun" },
      { target: "post", key: "artilleryman" },
      { target: "condition", key: "blind" },
      { target: "move", key: "move" },
      { target: "item", key: "six-pounder" },
    ]);
    expect(articleFactsOf({})).toEqual([]);
  });

  it("derives a subject from a resolved action", () => {
    const subject = articleSubjectOfAction({
      id: "canister-shot",
      element: "fire",
      weaponType: "gun",
      postId: "artilleryman",
      effects: [
        { element: "lightning", inflicts: ["blind"] },
        { element: "fire", inflicts: ["blind", "poison"] },
      ],
    });
    expect(subject).toEqual({
      actionId: "canister-shot",
      elements: ["fire", "lightning"],
      weaponTypes: ["gun"],
      postId: "artilleryman",
      inflicts: ["blind", "poison"],
    });
    expect(articleSubjectOfAction({ id: "wait" })).toEqual({ actionId: "wait" });
  });

  it("matches a single Article against facts and ignores the wrong kind", () => {
    const noFire = ARTICLES["no-fire"];
    expect(matchArticle(noFire, [{ target: "element", key: "fire" }])).toEqual({
      article: noFire,
      target: "element",
      key: "fire",
    });
    expect(matchArticle(noFire, [{ target: "element", key: "ice" }])).toBeUndefined();

    const colours = ARTICLES["commend-colours"];
    expect(matchArticle(colours, [{ target: "element", key: "holy" }])).toBeDefined();
    // A commended Article is never reported as a breach.
    expect(matchArticle(colours, [{ target: "element", key: "dark" }])).toBeUndefined();
  });

  it("is pure and does not mutate its inputs", () => {
    const active = [ARTICLES["no-fire"], ARTICLES["commend-colours"]];
    const subject = { elements: ["fire", "holy"] as const };
    const first = detectArticles(active, subject);
    const second = detectArticles(active, subject);
    expect(first).toEqual(second);
    expect(active.map((a) => a.id)).toEqual(["no-fire", "commend-colours"]);
    expect(subject.elements).toEqual(["fire", "holy"]);
  });

  it("checks a day's posting against an action", () => {
    const orders = generateDailyArticles("waterloo-1815", 12);
    const verdict = detectArticles(orders.articles, { actionId: "canister-shot" });
    // Every reported breach really is one of the day's forbidding Articles.
    for (const match of verdict.broken) {
      expect(orders.forbidden.map((article) => article.id)).toContain(match.article.id);
      expect(match.article.kind).toBe("forbid");
    }
    for (const match of verdict.commended) {
      expect(orders.commended.map((article) => article.id)).toContain(match.article.id);
      expect(match.article.kind).toBe("commend");
    }
  });
});
