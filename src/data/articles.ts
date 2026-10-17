/**
 * Articles of War (T054, mapping §9).
 *
 * In FFTA the **law system** rotates every day: a handful of activities are
 * forbidden (Fire, Swords, Items, "no damage to animals", ...) and the Judge
 * rewards preferred behaviour. The retheme keeps that contract and renames the
 * whole apparatus around Napoleonic **standing orders** (mapping §1, §9):
 * a Law is an **Article of War**, the Judge is the **Provost Marshal**, a
 * Yellow Card is a **Reprimand** and a Red Card is a **Court-Martial**.
 *
 * This module is the **authored pool** of Articles. Generating the small daily
 * list, detecting a breach at resolution time and escalating the cards all
 * live in the engine (`src/engine/rules/articles.ts`, T055–T058); the data here
 * only declares *what* a standing order can forbid or commend.
 *
 * ## Forbid vs. commend
 *
 * An Article has a {@link ArticleKind} (`forbid` | `commend`) and an
 * {@link ArticleTarget} naming *what class of thing* it keys on. The five
 * targets authored here are the five FFTA laws care about
 * (mapping §9: "forbidden action / element / weapon / order / condition"):
 *
 * | `target`    | `keys` name...                     | A breach is...                              |
 * | ----------- | ---------------------------------- | ------------------------------------------- |
 * | `action`    | an ability id (`volley-fire`)      | using that action                           |
 * | `element`   | an element key (`fire`)            | an action of that element                   |
 * | `weapon`    | a weapon family (`musket`, `rifle`) | an attack with that kind of kit             |
 * | `post`      | a post id (`forager`, `surgeon`)   | an action taken by a soldier of that post   |
 * | `condition` | a condition id (`poison`, `regen`) | an action that inflicts that condition      |
 *
 * A `commend` Article works on the same matching rules, but grants **Honour**
 * (FFTA JP, mapping §5) instead of a card when the act resolves. For a
 * `condition` Article `forbid` bars **inflicting** the condition on anyone and
 * `commend` rewards inflicting it — which is how a beneficial state such as
 * Steadied (`regen`) becomes a recommended act.
 *
 * `keys` may be empty, meaning "any act of this target class" (e.g. an Article
 * forbidding *every* Volley or *any* Incendiary). None of the authored pool
 * uses that form yet, so the check is exercised by the tests instead.
 *
 * ## Enforcement fields
 *
 * - `severity` is the card issued on the **first** breach; escalation to a
 *   Court-Martial on the second offence is engine policy (T057). A few grave
 *   Articles (poisoned shot, deliberate terror) open at Court-Martial.
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
 *   {@link ArticleDefSchema}, so a mistyped target, kind or severity fails
 *   loudly at module load rather than skewing a battle.
 * - **No placeholders.** Every Article carries an authored Napoleonic `name`,
 *   `description` and `flavour` (mapping §14, D6/D8).
 */

import type { z } from "zod";

import {
  ArticleDefSchema,
  type ArticleDef,
  type ArticleKind,
  type ArticleTarget,
} from "./schema";

/* --------------------------------------------------------------------------
 * The table
 * ------------------------------------------------------------------------ */

/**
 * The canonical Article ids in authoring order — forbidding orders first, then
 * the recommended acts. Typed as a tuple so the compiler rejects a missing key
 * in {@link ARTICLE_DATA} and every menu or draw can iterate a stable order.
 */
export const ARTICLE_KEYS = [
  // Forbidding standing orders
  "no-canister-shot",
  "no-couched-charge",
  "no-fire",
  "no-dark",
  "no-rifle",
  "no-sabre",
  "no-gun",
  "no-forager",
  "no-poison",
  "no-blind",
  // Commended acts (grant Honour)
  "commend-volley-fire",
  "commend-parry",
  "commend-colours",
  "commend-musket",
  "commend-surgeon",
  "commend-steadied",
] as const;

/** The stable, FFTA-shaped id of every authored Article. */
export type ArticleKey = (typeof ARTICLE_KEYS)[number];

/** The schema's *input* type: defaulted fields may be omitted when authoring. */
type ArticleInput = z.input<typeof ArticleDefSchema>;

/** A single Article as authored, before {@link ArticleDefSchema} stamps its id on. */
export type ArticleData = Omit<ArticleInput, "id">;

/**
 * Unparsed Article data, keyed by the stable id. `satisfies` enforces that
 * every {@link ArticleKey} is authored; only fields that differ from the
 * schema defaults need to appear.
 */
const ARTICLE_DATA = {
  /* ----- Forbidding standing orders ------------------------------------- */

  "no-canister-shot": {
    name: "No Case Shot",
    description:
      "Case and canister are forbidden today; firing case shot is a breach of the standing order.",
    flavour: "At close quarters the tin case is indiscriminate, and the colours always hear of it.",
    kind: "forbid",
    target: "action",
    keys: ["canister-shot"],
    weight: 0.75,
  },
  "no-couched-charge": {
    name: "No Couched Charge",
    description:
      "Lances are to be carried, not couched; charging home with the lance breaks the order.",
    flavour: "A couched lance is a fine thing on an open field and a scandal in a village street.",
    kind: "forbid",
    target: "action",
    keys: ["couched-charge"],
  },
  "no-fire": {
    name: "No Incendiary",
    description:
      "Burning shells and combustibles are forbidden; an Incendiary-typed action is a breach.",
    flavour: "The order is to take the town, not to leave it in ashes.",
    kind: "forbid",
    target: "element",
    keys: ["fire"],
  },
  "no-dark": {
    name: "No Terror",
    description:
      "Atrocity and deliberate terror are forbidden; a Terror-typed action invites a court-martial.",
    flavour: "We do not win by what the enemy fears we might become.",
    kind: "forbid",
    target: "element",
    keys: ["dark"],
    severity: "court-martial",
    weight: 0.5,
  },
  "no-rifle": {
    name: "No Rifle Fire",
    description: "The rifle is stood down today; an attack made with a rifle is a breach.",
    flavour: "The rifles load too slowly for the line that must hold the road today.",
    kind: "forbid",
    target: "weapon",
    keys: ["rifle"],
  },
  "no-sabre": {
    name: "No Sabre",
    description: "Cold steel is forbidden; an attack made with a sabre breaks the standing order.",
    flavour: "Today the matter is to be settled at range, not at the point.",
    kind: "forbid",
    target: "weapon",
    keys: ["sabre"],
  },
  "no-gun": {
    name: "No Artillery",
    description: "The guns stay limbered; an attack with an artillery piece breaks the order.",
    flavour: "The battery is needed at the crossroads, not in this affair.",
    kind: "forbid",
    target: "weapon",
    keys: ["gun"],
    weight: 0.75,
  },
  "no-forager": {
    name: "No Foraging",
    description: "Foraging is suspended; an action taken by a Forager breaks the standing order.",
    flavour: "Hungry horses and angry farmers lose more campaigns than any battery.",
    kind: "forbid",
    target: "post",
    keys: ["forager"],
  },
  "no-poison": {
    name: "No Poisoned Shot",
    description:
      "Poisoned or ragged shot is an outrage; an action that inflicts Bleeding is a court-martial offence.",
    flavour: "A ball is a soldier's death; a festering wound is a butcher's.",
    kind: "forbid",
    target: "condition",
    keys: ["poison"],
    severity: "court-martial",
    weight: 0.5,
  },
  "no-blind": {
    name: "No Blinding",
    description: "Deliberately blinding the enemy is forbidden; inflicting Dazed is a breach.",
    flavour: "A blinded man is no longer an enemy, only a burden.",
    kind: "forbid",
    target: "condition",
    keys: ["blind"],
  },

  /* ----- Commended acts (grant Honour, mapping §5/§9) -------------------- */

  "commend-volley-fire": {
    name: "Commended: Volley Fire",
    description: "Massed fire is the order of the day; the Volley Fire action earns Honour.",
    flavour: "Three ranks, one crash: the old way, and still the best.",
    kind: "commend",
    target: "action",
    keys: ["volley-fire"],
    honour: 2,
    weight: 2,
  },
  "commend-parry": {
    name: "Commended: Parry",
    description: "Discipline in the press is rewarded; a successful Parry earns Honour.",
    flavour: "A cool head and a raised guard save more men than a charge.",
    kind: "commend",
    target: "action",
    keys: ["parry"],
    honour: 1,
  },
  "commend-colours": {
    name: "Commended: Colours",
    description:
      "Actions that rally the line are rewarded; a Colours-typed action earns Honour.",
    flavour: "While the standard flies, the line holds.",
    kind: "commend",
    target: "element",
    keys: ["holy"],
    honour: 3,
    weight: 0.75,
  },
  "commend-musket": {
    name: "Commended: Musket",
    description: "The musket line is favoured today; an attack made with a musket earns Honour.",
    flavour: "The smoothbore is the army's true voice.",
    kind: "commend",
    target: "weapon",
    keys: ["musket"],
    honour: 1,
    weight: 2,
  },
  "commend-surgeon": {
    name: "Commended: Surgery",
    description: "Mercy is the order; an action taken by a Surgeon earns Honour.",
    flavour: "Every man saved is a man who will fight again.",
    kind: "commend",
    target: "post",
    keys: ["surgeon"],
    honour: 2,
  },
  "commend-steadied": {
    name: "Commended: Steady",
    description:
      "Keeping the line on its feet is rewarded; an action that grants Steadied earns Honour.",
    flavour: "A steady file is worth a fresh regiment.",
    kind: "commend",
    target: "condition",
    keys: ["regen"],
    honour: 1,
  },
} satisfies Record<ArticleKey, ArticleData>;

/**
 * Every Article, keyed by the stable id and validated at module load. Read this
 * instead of branching on Article ids anywhere in the engine; the daily draw
 * (T055) and the violation check (T056) both consume the parsed
 * {@link ArticleDef}.
 */
export const ARTICLES: Record<ArticleKey, ArticleDef> = Object.fromEntries(
  Object.entries(ARTICLE_DATA).map(([id, def]) => [id, ArticleDefSchema.parse({ id, ...def })]),
) as Record<ArticleKey, ArticleDef>;

/**
 * The Articles in their canonical authoring order ({@link ARTICLE_KEYS}).
 * Handy for menus, the seeded pool and tests that need a stable order.
 */
export const ARTICLE_LIST: readonly ArticleDef[] = ARTICLE_KEYS.map((id) => ARTICLES[id]);

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
