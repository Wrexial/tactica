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
  type ArticleTarget,
} from "../../src/data/schema";

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
