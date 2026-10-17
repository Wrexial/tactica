/**
 * Daily Articles of War (T055) — turn the authored pool
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
 * This module owns only *generation*. It answers "which Articles are in force
 * on day N?" deterministically; checking an action against them (T056), issuing
 * Reprimands / Courts-Martial (T057–T058) and the Provost itself (T066) are
 * separate tasks and live elsewhere in `src/engine/rules/`.
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

import { ARTICLE_LIST } from "../../data/articles";
import type { ArticleDef, ArticleKind } from "../../data/schema";
import { asArticleId, type ArticleId, type RegionId } from "../ids";
import { Rng, type Seed } from "../rng";

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
function assertCampaignDay(day: number): void {
  if (!Number.isInteger(day) || day < 1) {
    throw new RangeError(`campaign day must be a positive integer, received ${String(day)}`);
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
