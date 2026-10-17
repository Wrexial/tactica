/**
 * Articles of War (T054, T093; mapping §9).
 *
 * In FFTA the **law system** rotates every day: a handful of activities are
 * forbidden (Fire, Swords, Items, "no damage to animals", ...) and the Judge
 * rewards preferred behaviour. The retheme keeps that contract and renames the
 * whole apparatus around Napoleonic **standing orders** (mapping §1, §9):
 * a Law is an **Article of War**, the Judge is the **Provost Marshal**, a
 * Yellow Card is a **Reprimand** and a Red Card is a **Court-Martial**.
 *
 * This module is the **aggregate authored pool** of Articles, assembled from the
 * disposition-split modules:
 *
 * | Module       | Contents                                                     |
 * | ------------ | ------------------------------------------------------------ |
 * | `forbid.ts`  | Forbidding standing orders (`no-*`)                          |
 * | `commend.ts` | Commended acts that grant Honour (`commend-*`)               |
 *
 * Generating the small daily list, detecting a breach at resolution time and
 * escalating the cards all live in the engine
 * (`src/engine/rules/articles.ts`, T055–T058); the data here only declares
 * *what* a standing order can forbid or commend.
 *
 * ## Forbid vs. commend
 *
 * An Article has a {@link ArticleKind} (`forbid` | `commend`) and an
 * {@link ArticleTarget} naming *what class of thing* it keys on. The seven
 * targets authored here are the classes the engine can observe at resolution
 * time (mapping §9: "forbidden action / element / weapon / order / condition",
 * plus movement and item use):
 *
 * | `target`    | `keys` name...                     | A breach is...                              |
 * | ----------- | ---------------------------------- | ------------------------------------------- |
 * | `action`    | an ability id (`volley-fire`)      | using that action                           |
 * | `element`   | an element key (`fire`)            | an action of that element                   |
 * | `weapon`    | a weapon family (`musket`, `rifle`) | an attack with that kind of kit             |
 * | `post`      | a post id (`forager`, `surgeon`)   | an action taken by a soldier of that post   |
 * | `condition` | a condition id (`poison`, `regen`) | an action that inflicts that condition      |
 * | `move`      | the `move` key                     | any movement at all                         |
 * | `item`      | an equipment id (`field-kit`)      | using that item                             |
 *
 * A `commend` Article works on the same matching rules, but grants **Honour**
 * (FFTA JP, mapping §5) instead of a card when the act resolves. For a
 * `condition` Article `forbid` bars **inflicting** the condition on anyone and
 * `commend` rewards inflicting it — which is how a beneficial state such as
 * Steadied (`regen`) becomes a recommended act.
 *
 * `keys` may be empty, meaning "any act of this target class" (e.g. an Article
 * forbidding *every* Volley or *any* Incendiary). The authored pool names a key
 * on every entry, so the empty form is exercised by the tests instead.
 *
 * ## Enforcement fields
 *
 * - `severity` is the card issued on the **first** breach; escalation to a
 *   Court-Martial on the second offence is engine policy (T057). A few grave
 *   Articles (poisoned shot, deliberate terror, pillage, assassination) open at
 *   Court-Martial.
 * - `honour` is the JP granted for a commended act. A forbidding Article
 *   carries `0`.
 * - `weight` biases the seeded daily draw (`T055`); court-martial Articles are
 *   deliberately rarer (`0.5`) than ordinary standing orders.
 * - `regionId`, when present, scopes an Article to a region (for example a
 *   lawless No-Man's Land, where the Provost is absent — T065).
 *
 * ## Ids vs. names
 *
 * As everywhere in `src/data/`, the **id stays a stable mechanical handle**
 * (`no-fire`, `commend-musket`) while the display fields carry the fiction
 * (`name`, `description`, `flavour`). No period proper noun leaks into an id;
 * the ids are built from the FFTA-shaped target keys.
 *
 * Design contracts (`agents.md` §2, §3, §9; `src/data/README.md`):
 * - **Static data, no engine import.** Content lives here; the engine imports
 *   *this*, never the reverse. Ids stay plain strings, branded only at the
 *   engine boundary (T012).
 * - **Validated at load.** Every entry is parsed with
 *   {@link ArticleDefSchema} via {@link parseArticles}.
 * - **No placeholders.** Every Article carries an authored Napoleonic `name`,
 *   `description` and `flavour` (mapping §14, D6/D8).
 */

import { COMMEND_ARTICLES } from "./commend";
import { FORBID_ARTICLES } from "./forbid";
import type { ArticleDef, ArticleKind, ArticleTarget } from "../schema";

/* --------------------------------------------------------------------------
 * The aggregate pool
 * ------------------------------------------------------------------------ */

export { COMMEND_ARTICLES } from "./commend";
export { FORBID_ARTICLES } from "./forbid";

/**
 * Every authored Article, keyed by its stable id. Forbidding orders come first
 * (in the order the pool is authored), then the commended acts. Spreading the
 * two records preserves insertion order, so {@link ARTICLE_KEYS} — and every
 * menu or draw built from it — is deterministic.
 */
export const ARTICLES = {
  ...FORBID_ARTICLES,
  ...COMMEND_ARTICLES,
} as const;

/** A known Article id (an FFTA-shaped, stable string). */
export type ArticleKey = keyof typeof ARTICLES;

/**
 * The canonical Article ids in authoring order. Typed as the literal union
 * array so iteration order is stable across builds.
 */
export const ARTICLE_KEYS = Object.keys(ARTICLES) as ArticleKey[];

/** The forbidding Article keys in authoring order (`no-*`). */
export const FORBID_ARTICLE_KEYS = Object.keys(FORBID_ARTICLES) as Array<
  keyof typeof FORBID_ARTICLES
>;

/** The commended Article keys in authoring order (`commend-*`). */
export const COMMEND_ARTICLE_KEYS = Object.keys(COMMEND_ARTICLES) as Array<
  keyof typeof COMMEND_ARTICLES
>;

/** Every Article, in canonical authoring order ({@link ARTICLE_KEYS}). */
export const ARTICLE_LIST: readonly ArticleDef[] = ARTICLE_KEYS.map((id) => ARTICLES[id]);

/** Every forbidding Article, in canonical order. */
export const FORBID_ARTICLE_LIST: readonly ArticleDef[] = FORBID_ARTICLE_KEYS.map(
  (id) => FORBID_ARTICLES[id],
);

/** Every commended Article, in canonical order. */
export const COMMEND_ARTICLE_LIST: readonly ArticleDef[] = COMMEND_ARTICLE_KEYS.map(
  (id) => COMMEND_ARTICLES[id],
);

/* --------------------------------------------------------------------------
 * Lookups
 * ------------------------------------------------------------------------ */

/** Runtime guard: `true` when `value` is a canonical Article key. */
export function isArticleKey(value: unknown): value is ArticleKey {
  return typeof value === "string" && (ARTICLE_KEYS as readonly string[]).includes(value);
}

/** Look up an Article by its canonical key. Throws on an unknown key. */
export function getArticle(id: ArticleKey): ArticleDef {
  const article = ARTICLES[id];
  if (article === undefined) {
    throw new RangeError(`unknown article: ${String(id)}`);
  }
  return article;
}

/** Every Article of a given kind (`forbid` or `commend`), in canonical order. */
export function articlesOfKind(kind: ArticleKind): readonly ArticleDef[] {
  return ARTICLE_LIST.filter((article) => article.kind === kind);
}

/** Every Article targeting a given class (`action`, `element`, `weapon`, ...). */
export function articlesForTarget(target: ArticleTarget): readonly ArticleDef[] {
  return ARTICLE_LIST.filter((article) => article.target === target);
}

/** Every Article forbidding acts of the given class, in canonical order. */
export function forbiddingArticles(target: ArticleTarget): readonly ArticleDef[] {
  return articlesForTarget(target).filter((article) => article.kind === "forbid");
}

/** Every Article commending acts of the given class, in canonical order. */
export function commendingArticles(target: ArticleTarget): readonly ArticleDef[] {
  return articlesForTarget(target).filter((article) => article.kind === "commend");
}

/* --------------------------------------------------------------------------
 * Matching (data-side helpers; the engine owns enforcement)
 * ------------------------------------------------------------------------ */

/**
 * `true` when `article.keys` names `key`, or when the Article has no `keys` at
 * all — an empty list means "any act of this target class".
 */
export function articleCoversKey(article: ArticleDef, key: string): boolean {
  return article.keys.length === 0 || article.keys.includes(key);
}

/**
 * `true` when `article` forbids the given `key` of `target` — used by the
 * violation check (`src/engine/rules/articles.ts`, T056) once the daily list is
 * active. The target must match; an empty `keys` list matches every key.
 */
export function articleForbids(article: ArticleDef, target: ArticleTarget, key: string): boolean {
  return article.kind === "forbid" && article.target === target && articleCoversKey(article, key);
}

/**
 * `true` when `article` commends the given `key` of `target` — the mirror of
 * {@link articleForbids}, backing the Honour award for recommended acts.
 */
export function articleCommends(article: ArticleDef, target: ArticleTarget, key: string): boolean {
  return article.kind === "commend" && article.target === target && articleCoversKey(article, key);
}
