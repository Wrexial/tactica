/**
 * Daily Articles of War (T055–T056) — turn the authored pool
 * (`src/data/articles.ts`, T054) into a small, *seeded* list of standing orders
 * for each campaign day (mapping §9, §10).
 *
 * FFTA rotates a fixed twenty-law list: one law is in effect early on, then two,
 * then three as the story advances, and the Judge publishes "recommended
 * actions" alongside the forbidden ones (`docs/wiki/pages/Law_system_(Tactics_
 * Advance).md`). The retheme keeps that contract: each campaign day the Provost
 * Marshal posts a handful of **Articles of War** pulled from the pool, split
 * into **forbidding** orders and **commended** acts.
 *
 * This module owns **generation** (which Articles are in force on day N?),
 * **violation detection** (T056: given the facts of a resolved action, which
 * active Articles did it break or earn commendation for?), the pure
 * **escalation policy** (T057: does a breach earn a Reprimand or a
 * Court-Martial?) and the **removal** a Red Card causes (T058: the soldier
 * leaves the field, and a commander's removal ends the action in defeat). The
 * remaining mechanics — Commissions (T059), the Honour economy (T060) and the
 * Provost unit itself (T066) — stay separate and live elsewhere in
 * `src/engine/rules/`.
 *
 * ```text
 *   buildArticlePool({ regionId }) ──► eligible forbid / commend Articles
 *                 │                          ▲
 *                 │                          │ region scope: a regionId-scoped
 *                 │                          │ Article only appears in its region
 *                 ▼
 *   frequencyForDay(day) ─────────► how many to draw (forbid + commend)
 *                 │
 *                 ▼
 *   generateDailyArticles(seed, day) ──► { articles, forbidden, commended, ids }
 *                 │
 *                 └─ per-day Rng derived from `seed + day`, so the draw is pure,
 *                    repeatable and independent of call order
 *
 *   detectArticles(active, subject) ──► { facts, broken, commended, unlawful }
 *                 │
 *                 └─ a resolved action's facts (action / element / weapon /
 *                    post / condition / move / item) tested against the day's
 *                    standing orders at resolution time
 *
 *   escalateBreach(article, record) ──► { severity, reprimands }
 *                 │
 *                 └─ FFTA's card escalation: a first, non-lethal breach draws a
 *                    Reprimand (Yellow); a second breach or one that causes a
 *                    knockout draws a Court-Martial (Red)
 *
 *   applyCourtMartial(context, request) ──► { units, events, outcome }
 *                 │
 *                 └─ a Red Card removes the soldier from the field; removing
 *                    the company commander ends the action in defeat (T058)
 * ```
 *
 * ## The frequency model
 *
 * The daily list is described by two numbers: how many **forbidding** Articles
 * and how many **commended** Articles. {@link DEFAULT_ARTICLE_FREQUENCY} is a
 * day-based schedule, authored as balance data (not scraped) but inspired by the
 * FFTA escalation from one law to three. Within a class, selection is
 * **weighted without replacement** by each Article's `weight` (T054), so a
 * value like `0.5` on the grave court-martial Articles makes them rarer than an
 * ordinary standing order.
 *
 * ## Determinism (`agents.md` §2)
 *
 * Nothing here touches `Math.random`, `Date` or the DOM. Generation derives an
 * independent {@link Rng} stream from `seed` and the campaign day, so:
 * - the same `(seed, day, options)` always yields a byte-identical list;
 * - calling day 7 before day 3 gives the same day-7 list as the reverse order
 *   (a day's orders never depend on how many other days were generated first).
 *
 * The campaign calendar (T076) will call {@link generateDailyArticles} once per
 * day and store the resulting ids, exactly as a replay would.
 *
 * Reference: `docs/wiki/pages/Law_system_(Tactics_Advance).md` (law rotation and
 * escalation), `docs/NAPOLEONIC_MAPPING.md` §9 ("Articles of War = the daily
 * law list ... recommended acts grant Honour") and §10 ("Calendar + daily
 * laws ... Laws rotate by day").
 */

import { ARTICLE_LIST, articleCommends, articleForbids } from "../../data/articles";
import type {
  ArticleDef,
  ArticleKind,
  ArticleTarget,
  ElementKey,
  WeaponType,
} from "../../data/schema";
import type { BattleEvent, BattleOutcome, CardSeverity } from "../events";
import { asArticleId, type ArticleId, type RegionId, type UnitId } from "../ids";
import { Rng, type Seed } from "../rng";
import type { Unit } from "../unit";

/* --------------------------------------------------------------------------
 * Frequency model
 * ------------------------------------------------------------------------ */

/**
 * How many Articles of each kind a single day carries. A `Record` keyed by
 * {@link ArticleKind} rather than two loose numbers so adding a kind is a
 * compile error here.
 */
export type ArticleFrequency = Readonly<Record<ArticleKind, number>>;

/**
 * One step of the day-based frequency schedule. From `fromDay` onward (until
 * the next step) a day draws `forbid` forbidding and `commend` commended
 * Articles.
 */
export interface ArticleFrequencyStep extends ArticleFrequency {
  /** First campaign day (`>= 1`, inclusive) this step applies to. */
  readonly fromDay: number;
}

/**
 * The default escalation, authored as balance data rather than scraped. The
 * FFTA law list grows from one law to two to three as the story advances
 * (`Law_system_(Tactics_Advance).md` §"Lawshifts"); here the campaign day is the
 * clock, so a young company faces one prohibition at a time and a veteran one
 * faces a strict three-Article posting plus recommended acts.
 */
export const DEFAULT_ARTICLE_FREQUENCY: readonly ArticleFrequencyStep[] = [
  { fromDay: 1, forbid: 1, commend: 1 },
  { fromDay: 8, forbid: 2, commend: 1 },
  { fromDay: 16, forbid: 2, commend: 2 },
  { fromDay: 32, forbid: 3, commend: 2 },
];

/**
 * Resolve the {@link ArticleFrequency} for a campaign day from a schedule.
 *
 * The schedule must be non-empty, sorted by `fromDay` ascending, start at day 1
 * and carry non-negative integer counts; a malformed schedule throws rather
 * than silently producing a strange posting. The last step whose `fromDay` is
 * at or before `day` wins.
 *
 * ```ts
 * frequencyForDay(1);  // { forbid: 1, commend: 1 }
 * frequencyForDay(40); // { forbid: 3, commend: 2 }
 * ```
 */
export function frequencyForDay(
  day: number,
  schedule: readonly ArticleFrequencyStep[] = DEFAULT_ARTICLE_FREQUENCY,
): ArticleFrequency {
  assertCampaignDay(day);
  assertFrequencySchedule(schedule);

  let chosen: ArticleFrequencyStep | undefined;
  for (const step of schedule) {
    if (step.fromDay <= day) chosen = step;
    else break;
  }
  // The schedule starts at day 1, so `chosen` is defined for every valid day.
  return { forbid: chosen?.forbid ?? 0, commend: chosen?.commend ?? 0 };
}

/* --------------------------------------------------------------------------
 * The eligible pool
 * ------------------------------------------------------------------------ */

/** A region-scoped generation pool, split by Article kind for the draw. */
export interface ArticlePool {
  /** Every eligible Article, in source order. */
  readonly all: readonly ArticleDef[];
  /** Eligible forbidding Articles, in source order. */
  readonly forbid: readonly ArticleDef[];
  /** Eligible commended Articles, in source order. */
  readonly commend: readonly ArticleDef[];
}

/** Options for {@link buildArticlePool}. */
export interface ArticlePoolOptions {
  /**
   * The region whose posting is being generated. A global Article
   * (`regionId === undefined`) is always eligible; a region-scoped Article is
   * eligible only when its `regionId` matches. Omitting this excludes every
   * region-scoped Article (there is nowhere for it to apply).
   */
  readonly regionId?: RegionId;
  /** Override the source pool (tests, content packs, region-specific lists). */
  readonly articles?: readonly ArticleDef[];
}

/**
 * Filter the authored Article pool down to the Articles eligible for one
 * posting, split by kind. Pure: the source (default {@link ARTICLE_LIST}) is
 * never mutated.
 */
export function buildArticlePool(options: ArticlePoolOptions = {}): ArticlePool {
  const source = options.articles ?? ARTICLE_LIST;
  const all = source.filter(
    (article) =>
      article.regionId === undefined ||
      (options.regionId !== undefined && article.regionId === options.regionId),
  );
  return {
    all,
    forbid: all.filter((article) => article.kind === "forbid"),
    commend: all.filter((article) => article.kind === "commend"),
  };
}

/* --------------------------------------------------------------------------
 * Generation
 * ------------------------------------------------------------------------ */

/**
 * A single campaign day's standing orders, ready for the Provost Marshal,
 * the UI law panel and the violation check (T056).
 */
export interface DailyArticles {
  /** Campaign day the orders belong to (`>= 1`). */
  readonly day: number;
  /** Region the posting was generated for, when any. */
  readonly regionId?: RegionId;
  /** The counts the draw used. */
  readonly frequency: ArticleFrequency;
  /**
   * The day's Articles: forbidding orders first, then commended acts. Order is
   * the draw order, which is itself deterministic.
   */
  readonly articles: readonly ArticleDef[];
  /** The forbidding subset of {@link articles}, in order. */
  readonly forbidden: readonly ArticleDef[];
  /** The commended subset of {@link articles}, in order. */
  readonly commended: readonly ArticleDef[];
  /** The ids of {@link articles}, branded for engine state and save files. */
  readonly ids: readonly ArticleId[];
}

/** Options for {@link generateDailyArticles} / {@link drawDailyArticles}. */
export interface DailyArticlesOptions {
  /** Region scope (see {@link ArticlePoolOptions.regionId}). */
  readonly regionId?: RegionId;
  /** Override the schedule used when {@link frequency} is absent. */
  readonly schedule?: readonly ArticleFrequencyStep[];
  /** Use these exact counts instead of consulting a schedule. */
  readonly frequency?: ArticleFrequency;
  /** Draw from this pool instead of the authored {@link ARTICLE_LIST}. */
  readonly pool?: readonly ArticleDef[];
  /**
   * Use this generator instead of a per-day one. Useful when a battle already
   * owns a stream; the generator **is** advanced. When provided, `seed` is
   * ignored — call {@link drawDailyArticles} directly if you prefer.
   */
  readonly rng?: Rng;
}

/**
 * Draw a day's Articles from an existing generator. The generator is advanced;
 * everything else is pure. Exposed so callers that manage their own seeded
 * stream (a battle, the campaign calendar) can keep one source of randomness.
 */
export function drawDailyArticles(
  rng: Rng,
  day: number,
  options: DailyArticlesOptions = {},
): DailyArticles {
  assertCampaignDay(day);
  const frequency = options.frequency ?? frequencyForDay(day, options.schedule);
  assertFrequency(frequency);

  const pool = buildArticlePool({ regionId: options.regionId, articles: options.pool });
  const weightOf = (article: ArticleDef): number => article.weight;
  const forbidden = drawWeighted(rng, pool.forbid, frequency.forbid, weightOf);
  const commended = drawWeighted(rng, pool.commend, frequency.commend, weightOf);
  const articles = [...forbidden, ...commended];

  return {
    day,
    ...(options.regionId !== undefined ? { regionId: options.regionId } : {}),
    frequency,
    articles,
    forbidden,
    commended,
    ids: articles.map((article) => asArticleId(article.id)),
  };
}

/**
 * Generate the standing orders for one campaign day from a campaign seed.
 *
 * The per-day generator is derived from both the seed and the day, so the same
 * `(seed, day, options)` always produces the same posting and the day's list
 * does not depend on generation order (`agents.md` §2 determinism).
 *
 * ```ts
 * const orders = generateDailyArticles(campaign.seed, 12);
 * orders.ids; // e.g. ["no-fire", "commend-musket"]
 * ```
 */
export function generateDailyArticles(
  seed: Seed,
  day: number,
  options: DailyArticlesOptions = {},
): DailyArticles {
  assertCampaignDay(day);
  const rng = options.rng ?? new Rng(articleDaySeed(seed, day));
  return drawDailyArticles(rng, day, options);
}

/* --------------------------------------------------------------------------
 * Violation detection (T056)
 * ------------------------------------------------------------------------ */

/**
 * One concrete thing a resolved action did, addressed the way an Article
 * addresses it: a {@link ArticleTarget} class plus the specific `key` within
 * that class (an ability id, an element, a weapon family, a post id, a
 * condition id, ...).
 *
 * Facts are the narrow interface between the battle (which knows what an order
 * actually did) and the standing orders (which know what is forbidden or
 * commended). Detection therefore needs no per-Article special cases: every
 * matcher is a `(target, key)` membership test.
 */
export interface ArticleFact {
  readonly target: ArticleTarget;
  readonly key: string;
}

/**
 * The facts a resolved action exposes to the Articles. Every field is optional
 * so a command supplies only what it did — a `wait` carries none, a musket shot
 * carries its weapon family, a canister round carries its element and the
 * conditions it inflicts.
 *
 * The plural fields let one action expose several facts of the same class (an
 * ability with two elemental effects; a round that both wounds and dazes).
 * Order is preserved, so a deterministic caller sees a deterministic match.
 */
export interface ArticleSubject {
  /** Active ability id used (`act`), matched against `target: "action"`. */
  readonly actionId?: string;
  /** Elements the effect carries, matched against `target: "element"`. */
  readonly elements?: readonly ElementKey[];
  /** Weapon families in use, matched against `target: "weapon"`. */
  readonly weaponTypes?: readonly WeaponType[];
  /** The acting soldier's post, matched against `target: "post"`. */
  readonly postId?: string;
  /** Conditions the action inflicts, matched against `target: "condition"`. */
  readonly inflicts?: readonly string[];
  /** `true` when the order was a move, matched against `target: "move"`. */
  readonly moved?: boolean;
  /** Kit used, matched against `target: "item"`. */
  readonly itemIds?: readonly string[];
}

/** The subset of an action effect (`AbilityEffect`, T041) that Articles key on. */
export interface ArticleEffectView {
  /** Element of the effect, if any. */
  readonly element?: ElementKey;
  /** Conditions the effect inflicts. */
  readonly inflicts?: readonly string[];
}

/**
 * A resolved action as the Articles see it — a structural subset of the
 * authored `AbilitySpec` (T041) plus the facts an ability does not carry (the
 * acting soldier's post and the weapon family in use). The rules layer depends
 * on this shape rather than on the action executor, so the battle can map its
 * abilities to it without introducing an import cycle.
 */
export interface ArticleActionView {
  /** Ability id (mapped to {@link ArticleSubject.actionId}). */
  readonly id: string;
  /** The action's own element, when authored at the top level. */
  readonly element?: ElementKey;
  /** Weapon family the action strikes with, when it is a weapon attack. */
  readonly weaponType?: WeaponType;
  /** The acting soldier's post, when known. */
  readonly postId?: string;
  /** The action's effects (mapped to elements and inflicted conditions). */
  readonly effects?: readonly ArticleEffectView[];
}

/**
 * Derive the {@link ArticleSubject} facts from a resolved action. Elements and
 * inflicted conditions are collected across the action's effects,
 * deduplicated in first-seen order, so one action never reports the same fact
 * twice.
 *
 * ```ts
 * articleSubjectOfAction({
 *   id: "canister-shot",
 *   element: "fire",
 *   weaponType: "gun",
 *   postId: "artilleryman",
 *   effects: [{ element: "lightning", inflicts: ["blind"] }],
 * });
 * ```
 */
export function articleSubjectOfAction(action: ArticleActionView): ArticleSubject {
  const elements = new Set<ElementKey>();
  if (action.element !== undefined) elements.add(action.element);
  const inflicts = new Set<string>();
  for (const effect of action.effects ?? []) {
    if (effect.element !== undefined) elements.add(effect.element);
    for (const condition of effect.inflicts ?? []) inflicts.add(condition);
  }

  return {
    actionId: action.id,
    ...(elements.size > 0 ? { elements: [...elements] } : {}),
    ...(action.weaponType === undefined ? {} : { weaponTypes: [action.weaponType] }),
    ...(action.postId === undefined ? {} : { postId: action.postId }),
    ...(inflicts.size > 0 ? { inflicts: [...inflicts] } : {}),
  };
}

/**
 * Flatten a subject into the ordered {@link ArticleFact} list the matchers
 * walk. The order follows the field order above and a fact is emitted only
 * when present. An empty `keys` list on an Article matches every fact of its
 * target class, so `moved: true` (key `"move"`) is enough for a "no
 * withdrawal" order.
 */
export function articleFactsOf(subject: ArticleSubject): readonly ArticleFact[] {
  const facts: ArticleFact[] = [];
  if (subject.actionId !== undefined) {
    facts.push({ target: "action", key: subject.actionId });
  }
  for (const element of subject.elements ?? []) {
    facts.push({ target: "element", key: element });
  }
  for (const weaponType of subject.weaponTypes ?? []) {
    facts.push({ target: "weapon", key: weaponType });
  }
  if (subject.postId !== undefined) {
    facts.push({ target: "post", key: subject.postId });
  }
  for (const condition of subject.inflicts ?? []) {
    facts.push({ target: "condition", key: condition });
  }
  if (subject.moved === true) {
    facts.push({ target: "move", key: "move" });
  }
  for (const itemId of subject.itemIds ?? []) {
    facts.push({ target: "item", key: itemId });
  }
  return facts;
}

/** A matched {@link ArticleDef} and the fact that matched it. */
export interface ArticleMatch {
  readonly article: ArticleDef;
  /** Target class of the matching fact (`action`, `element`, ...). */
  readonly target: ArticleTarget;
  /** The specific key within {@link target} that matched. */
  readonly key: string;
}

/**
 * The first fact in `facts` that this Article forbids or commends, or
 * `undefined` when the Article does not apply to the action. A forbidding
 * Article is tested with {@link articleForbids} and a commended one with
 * {@link articleCommends}; the two kinds are never mixed.
 */
export function matchArticle(
  article: ArticleDef,
  facts: readonly ArticleFact[],
): ArticleMatch | undefined {
  for (const fact of facts) {
    const matched =
      article.kind === "forbid"
        ? articleForbids(article, fact.target, fact.key)
        : articleCommends(article, fact.target, fact.key);
    if (matched) {
      return { article, target: fact.target, key: fact.key };
    }
  }
  return undefined;
}

/** The outcome of checking one resolved action against the active Articles. */
export interface ArticleDetection {
  /** The action's facts, in {@link articleFactsOf} order. */
  readonly facts: readonly ArticleFact[];
  /** Active forbidding Articles the action broke, in active order. */
  readonly broken: readonly ArticleMatch[];
  /** Active commended Articles the action earned, in active order. */
  readonly commended: readonly ArticleMatch[];
  /** `true` when at least one forbidding Article was broken. */
  readonly unlawful: boolean;
}

/**
 * Check a resolved action against the Articles currently in force.
 *
 * `active` is the day's list — typically `daily.articles` from
 * {@link generateDailyArticles}, or the Article ids stored on a battle. Every
 * active Article is tested once, in order, against the action's facts: a
 * forbidding Article that matches lands in {@link ArticleDetection.broken} and
 * a commended one in {@link ArticleDetection.commended}. One action can both
 * break an order and earn another (canister fire that violates a "no case
 * shot" order still counts as commendable fire if the day says so).
 *
 * Pure and deterministic: the inputs are read, never written, and the result
 * depends only on `(active, subject)` — so a replay detects the same breaches
 * at the same resolution.
 *
 * ```ts
 * const day = generateDailyArticles(campaign.seed, 12);
 * const action = articleSubjectOfAction({ id: "canister-shot", element: "fire" });
 * const verdict = detectArticles(day.articles, action);
 * verdict.broken.map((match) => match.article.id); // e.g. ["no-canister-shot"]
 * ```
 */
export function detectArticles(
  active: readonly ArticleDef[],
  subject: ArticleSubject,
): ArticleDetection {
  const facts = articleFactsOf(subject);
  const broken: ArticleMatch[] = [];
  const commended: ArticleMatch[] = [];

  for (const article of active) {
    const match = matchArticle(article, facts);
    if (match === undefined) continue;
    if (article.kind === "forbid") broken.push(match);
    else commended.push(match);
  }

  return { facts, broken, commended, unlawful: broken.length > 0 };
}

/**
 * The first (in active order) forbidding Article an action broke, or
 * `undefined`. Convenience for callers that only need the next card to issue
 * (T057); use {@link detectArticles} when the full verdict is required.
 */
export function firstBreach(detection: ArticleDetection): ArticleMatch | undefined {
  return detection.broken[0];
}

/* --------------------------------------------------------------------------
 * Card escalation (T057)
 * ------------------------------------------------------------------------ */

/**
 * A soldier's record when a breach is judged: how many **Reprimands** (FFTA
 * Yellow Cards) they already carry, and whether the action that broke the
 * Article knocked a soldier out of action.
 *
 * The record is the only per-soldier state escalation needs. It stays a plain
 * number so it is trivially serialisable into the battle (and the campaign
 * roster) and so a replay reproduces the same cards.
 */
export interface ArticleRecord {
  /** Reprimands already on the soldier's record (`>= 0`). */
  readonly reprimands: number;
  /**
   * `true` when the breach also caused a knockout — FFTA's "illegal KO", which
   * draws a Court-Martial on the spot regardless of the soldier's record
   * (`docs/wiki/pages/Law_system_(Tactics_Advance).md` §"Forbidden actions").
   */
  readonly illegalKo?: boolean;
}

/** The Provost Marshal's ruling on one breach. */
export interface CardDecision {
  /** Card issued: a **Reprimand** (Yellow) or a **Court-Martial** (Red). */
  readonly severity: CardSeverity;
  /**
   * Reprimands on the soldier's record **after** the ruling. A Reprimand adds
   * one to the record; a Court-Martial leaves it where it was, because the
   * soldier is being removed rather than warned.
   */
  readonly reprimands: number;
}

/**
 * Map an Article's authored opening `severity` (`"reprimand"` |
 * `"court-martial"`) onto the enforcement card the events layer uses
 * ({@link CardSeverity}: `"reprimand"` | `"courtMartial"`). Most Articles open
 * at a Reprimand; a few grave ones (poisoned shot, deliberate terror) open at a
 * Court-Martial even on a clean record.
 */
export function cardForArticleSeverity(severity: ArticleDef["severity"]): CardSeverity {
  return severity === "court-martial" ? "courtMartial" : "reprimand";
}

/**
 * Decide the card a breach earns — the FFTA escalation, kept pure and
 * data-driven (mapping §9).
 *
 * A **first**, non-lethal breach of an ordinary Article draws a **Reprimand**
 * (Yellow Card). The soldier is Court-Martialled (Red Card) when any of these
 * is true:
 *
 * 1. the Article is authored `severity: "court-martial"` (a grave order), or
 * 2. the breach caused a knockout (`record.illegalKo`), or
 * 3. the soldier already carries a Reprimand (`record.reprimands >= 1`) — the
 *    second offence, regardless of which Article it breaks.
 *
 * Reference: `docs/wiki/pages/Law_system_(Tactics_Advance).md` — "By breaking
 * the law the first time, and as long as it does not result in a KO, the Judge
 * will ... issue a Yellow Card ... By breaking the law, and scoring a KO in the
 * process, the Judge will issue a Red Card ... Breaking the law twice in one
 * battle ... will have the Judge issuing a Yellow and Red Card, one after
 * another."
 *
 * Pure and deterministic: the inputs are read, never written, and the ruling
 * depends only on `(article, record)`. Only a **forbidding** Article can be
 * breached, so passing a `commend` Article (or a negative `reprimands`) is a
 * programmer error and throws.
 *
 * ```ts
 * escalateBreach(noFire, { reprimands: 0 });                 // Reprimand
 * escalateBreach(noFire, { reprimands: 1 });                 // Court-Martial
 * escalateBreach(noFire, { reprimands: 0, illegalKo: true }); // Court-Martial
 * escalateBreach(noPoison, { reprimands: 0 });               // Court-Martial (grave)
 * ```
 */
export function escalateBreach(article: ArticleDef, record: ArticleRecord): CardDecision {
  assertBreachable(article, record);

  const grave = article.severity === "court-martial";
  const illegalKo = record.illegalKo === true;
  const repeatOffence = record.reprimands >= 1;

  // A Reprimand records one more warning; a Court-Martial removes the soldier
  // rather than warning them, so it banks no new Reprimand (T058 handles the
  // removal, T059 lets a Commission ignore the Red Card).
  if (grave || illegalKo || repeatOffence) {
    return { severity: "courtMartial", reprimands: record.reprimands };
  }
  return { severity: "reprimand", reprimands: record.reprimands + 1 };
}

/* --------------------------------------------------------------------------
 * Court-martial removal (T058)
 * ------------------------------------------------------------------------ */

/**
 * The field as the Provost Marshal sees it when a Red Card is enforced: the
 * deployed soldiers, the Orders Tempo tick to stamp events with, and — when the
 * action has one — the company commander.
 *
 * Following {@link import("./shove").ShoveContext}, this is a small structural
 * view rather than the whole `BattleState`, so the rules layer stays free of the
 * state machine (`agents.md` §7) and the battle layer folds the returned roster
 * and events back into its own state.
 */
export interface CourtMartialContext {
  /** Every soldier currently on the field. */
  readonly units: readonly Unit[];
  /** Orders Tempo tick the removal resolves on; defaults to `0`. */
  readonly tick?: number;
  /**
   * The company commander's soldier id. A Court-Martial that removes this
   * soldier ends the action in **defeat** (`companyDefeat`), mirroring FFTA's
   * "clan leader Red Card = Game Over"
   * (`docs/wiki/pages/Law_system_(Tactics_Advance).md`). Omit it for a detached
   * skirmish with no commander on the field.
   */
  readonly commanderId?: UnitId;
}

/** What the Provost Marshal orders: remove this soldier for this Article. */
export interface CourtMartialRequest {
  /** The soldier found guilty of the breach. */
  readonly unitId: UnitId;
  /** The Article of War the Court-Martial is issued for. */
  readonly articleId: ArticleId;
}

/** The result of enforcing one Court-Martial (a Red Card). */
export interface CourtMartialResult {
  /**
   * The field after the soldier left it: a new array in the original order with
   * the convicted soldier omitted. The input roster is never mutated.
   */
  readonly units: readonly Unit[];
  /**
   * Ordered events: `courtMartialIssued`, then `unitRemoved`, followed by a
   * closing `battleEnded` **only** when the commander was removed.
   */
  readonly events: readonly BattleEvent[];
  /** The soldier who left the field. */
  readonly removed: Unit;
  /** `true` when the removed soldier was the company commander. */
  readonly commander: boolean;
  /** `companyDefeat` when the commander was removed; otherwise `null`. */
  readonly outcome: BattleOutcome | null;
  /** `true` when the ruling concluded the action. */
  readonly finished: boolean;
}

/**
 * Enforce a **Court-Martial** (FFTA's Red Card, mapping §9): the convicted
 * soldier is removed from the field, emitting `courtMartialIssued` and
 * `unitRemoved`. When the soldier is the company commander the action ends at
 * once in defeat (`companyDefeat`), exactly as a clan leader's Red Card is
 * instant Game Over in FFTA
 * (`docs/wiki/pages/Law_system_(Tactics_Advance).md`).
 *
 * Pure and deterministic: the context and request are read, never written; a
 * new roster and event list are returned (structural sharing is fine). Throws a
 * `RangeError` when the tick is malformed or the named soldier is not on the
 * field — those are stale-command/programmer faults, not in-world outcomes,
 * matching `resolveShove` (T044).
 *
 * ```ts
 * const ruling = escalateBreach(noFire, { reprimands: 0 });
 * if (ruling.severity === "courtMartial") {
 *   const { units, events, outcome } = applyCourtMartial(
 *     { units: battle.units, commanderId, tick: battle.tempo.tick },
 *     { unitId: offender.id, articleId: noFire.id },
 *   );
 * }
 * ```
 */
export function applyCourtMartial(
  context: CourtMartialContext,
  request: CourtMartialRequest,
): CourtMartialResult {
  const tick = context.tick ?? 0;
  assertTick(tick);

  const removed = context.units.find((unit) => unit.id === request.unitId);
  if (removed === undefined) {
    throw new RangeError(`no soldier ${request.unitId} is on the field to court-martial`);
  }

  const units = context.units.filter((unit) => unit.id !== request.unitId);
  const commander = context.commanderId !== undefined && context.commanderId === request.unitId;

  const events: BattleEvent[] = [
    { kind: "courtMartialIssued", tick, unitId: removed.id, articleId: request.articleId },
    { kind: "unitRemoved", tick, unitId: removed.id, reason: "courtMartial" },
  ];

  if (!commander) {
    return { units, events, removed, commander: false, outcome: null, finished: false };
  }

  // A commander's Red Card is an immediate, irrecoverable defeat: no further
  // order can be given, so the closing `battleEnded` travels with the removal.
  events.push({ kind: "battleEnded", tick, outcome: "companyDefeat" });
  return {
    units,
    events,
    removed,
    commander: true,
    outcome: "companyDefeat",
    finished: true,
  };
}

/* --------------------------------------------------------------------------
 * Internals
 * ------------------------------------------------------------------------ */

/**
 * Derive the per-day seed string from a campaign seed and day. The `n:` / `s:`
 * tag matches {@link Rng}'s seed expansion so numeric seed `12` and string seed
 * `"12"` cannot collide.
 */
function articleDaySeed(seed: Seed, day: number): Seed {
  const tag = typeof seed === "number" ? "n" : "s";
  return `articles:${tag}:${String(seed)}#${day}`;
}

/**
 * Draw `count` distinct items from `items`, each chance proportional to its
 * positive weight, without replacement. Items with weight `<= 0` are never
 * drawn while any positive weight remains; if every remaining weight is zero
 * the draw falls back to a uniform pick (an authoring error, not a crash).
 *
 * The selection is a plain weighted roll over the source order, so the result
 * is deterministic for a given generator stream.
 */
function drawWeighted<T>(
  rng: Rng,
  items: readonly T[],
  count: number,
  weightOf: (item: T) => number,
): T[] {
  const remaining = items.slice();
  const drawn: T[] = [];
  const target = Math.max(0, Math.min(count, remaining.length));

  for (let i = 0; i < target; i++) {
    const total = remaining.reduce((sum, item) => sum + positiveWeight(weightOf(item)), 0);
    let index: number;
    if (total <= 0) {
      index = rng.nextInt(remaining.length);
    } else {
      let roll = rng.next() * total;
      index = remaining.length - 1;
      for (let j = 0; j < remaining.length; j++) {
        roll -= positiveWeight(weightOf(remaining[j] as T));
        if (roll < 0) {
          index = j;
          break;
        }
      }
    }
    drawn.push(remaining[index] as T);
    remaining.splice(index, 1);
  }

  return drawn;
}

/** Clamp a weight read from data into the `>= 0` range. */
function positiveWeight(weight: number): number {
  return Number.isFinite(weight) && weight > 0 ? weight : 0;
}

/* --------------------------------------------------------------------------
 * Validation
 * ------------------------------------------------------------------------ */

/** Campaign days are 1-based, matching the FFTA calendar. */
function assertBreachable(article: ArticleDef, record: ArticleRecord): void {
  if (article.kind !== "forbid") {
    throw new RangeError(
      `only forbidding Articles can be breached, but "${article.id}" is ${article.kind}`,
    );
  }
  if (!Number.isInteger(record.reprimands) || record.reprimands < 0) {
    throw new RangeError(
      `article record reprimands must be a non-negative integer, received ${String(record.reprimands)}`,
    );
  }
}

function assertCampaignDay(day: number): void {
  if (!Number.isInteger(day) || day < 1) {
    throw new RangeError(`campaign day must be a positive integer, received ${String(day)}`);
  }
}

/** Orders Tempo ticks are non-negative integers (`agents.md` §2). */
function assertTick(tick: number): void {
  if (!Number.isInteger(tick) || tick < 0) {
    throw new RangeError(
      `court-martial tick must be a non-negative integer, received ${String(tick)}`,
    );
  }
}

function assertFrequency(frequency: ArticleFrequency): void {
  for (const kind of ["forbid", "commend"] as const) {
    const value = frequency[kind];
    if (!Number.isInteger(value) || value < 0) {
      throw new RangeError(
        `article frequency "${kind}" must be a non-negative integer, received ${String(value)}`,
      );
    }
  }
}

function assertFrequencySchedule(schedule: readonly ArticleFrequencyStep[]): void {
  if (schedule.length === 0) {
    throw new RangeError("article frequency schedule must not be empty");
  }
  if (schedule[0]?.fromDay !== 1) {
    throw new RangeError("article frequency schedule must start at day 1");
  }
  let previousDay = 0;
  for (const step of schedule) {
    if (!Number.isInteger(step.fromDay) || step.fromDay < 1) {
      throw new RangeError(
        `article frequency step fromDay must be a positive integer, received ${String(step.fromDay)}`,
      );
    }
    if (step.fromDay <= previousDay) {
      throw new RangeError("article frequency schedule must be sorted by ascending fromDay");
    }
    previousDay = step.fromDay;
    assertFrequency(step);
  }
}
