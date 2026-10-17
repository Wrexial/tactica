/**
 * Campaign Calendar & daily orders (T076) — the campaign **clock**, the daily
 * rotation of **Articles of War**, and the **dispatch timers** for soldiers
 * sent away on Detachment contracts (mapping §9, §10).
 *
 * In FFTA every mission costs a day on the **calendar**, and each new day the
 * Judge posts a fresh list of **laws** plus the recommended acts of the day.
 * Dispatch missions send clan members away for a fixed number of days and
 * return them when the clock has advanced that far. The retheme keeps that
 * contract and renames the pieces (mapping §1, §9, §10):
 *
 * | FFTA                    | Tactica                                |
 * | ----------------------- | -------------------------------------- |
 * | calendar day            | {@link CampaignCalendar.day}           |
 * | daily law list          | {@link articlesForDay} (T055)          |
 * | dispatch mission timer  | {@link Dispatch} / {@link scheduleDispatch} |
 *
 * ```
 *   CampaignCalendar
 *   ├─ seed        ── per-day Article draw (deterministic from seed + day)
 *   ├─ day         ── the campaign clock, integer, starts at day 1
 *   ├─ regionId    ── where the company stands (scopes region Articles)
 *   └─ dispatches[] ── Dispatch { id, contractId, unitIds, duration, returnDay }
 *
 *   articlesForDay(calendar) ──► generateDailyArticles(seed, day, { regionId })
 *                 │
 *                 └─ the day's forbidding + commended Articles; the same
 *                    (seed, day) always yields a byte-identical posting
 *
 *   scheduleDispatch(calendar, { id, contractId, unitIds, duration })
 *                 │
 *                 └─ returnDay = day + duration; the party is now "away"
 *
 *   advanceDays(calendar, n) ──► { calendar', completed[] }
 *                 │
 *                 └─ the day advances `n`; every dispatch whose returnDay has
 *                    been reached is removed from the active list and
 *                    returned as `completed` for the caller to resolve (T072)
 * ```
 *
 * ## Why a separate clock
 *
 * `docs/NAPOLEONIC_MAPPING.md` §10 makes the campaign sandbox day-driven: laws
 * rotate, dispatches tick and story beats unlock on the calendar. Keeping the
 * clock here — rather than on a battle — means the same `(seed, day, region)`
 * always produces the same standing orders, and a save plus an ordered list of
 * campaign commands replays exactly (`agents.md` §2). The Company's
 * `theatre.day` is a **projection** of this clock; {@link syncCompany} (used by
 * {@link advanceCampaign}) writes it back so the two never drift.
 *
 * ## Contract (`agents.md` §2, §3, §7, §9)
 *
 * - **Engine purity & determinism** — framework-free, DOM-free TypeScript with
 *   no `Math.random` and no `Date`. Time is the integer
 *   {@link CampaignCalendar.day}; Articles come from the seeded
 *   `generateDailyArticles` (T055).
 * - **State in, state out** — every transition returns a **new** calendar;
 *   inputs are never mutated. Structural sharing is fine.
 * - **Trust boundary** — {@link createCalendar} and {@link createDispatch}
 *   validate every field, so a corrupt save or a bad fixture fails loudly.
 * - **Data-driven** — the Article pool is authored content (`src/data/`); only
 *   the rotation policy lives in the engine.
 *
 * Reference: mapping §9 ("Articles of War = the daily law list ... recommended
 * acts grant Honour"), §10 ("Calendar + daily laws ... Laws rotate by day",
 * "Dispatch missions ... Send units away for N days") and
 * `docs/wiki/pages/Law_system_(Tactics_Advance).md`. This is original fiction
 * inspired by the Napoleonic Wars, not a port of FFTA's calendar.
 */

import { withTheatre, type Company } from "./company";
import { assertId, type ContractId, type DispatchId, type RegionId, type UnitId } from "./ids";
import type { Seed } from "./rng";
import {
  generateDailyArticles,
  type DailyArticles,
  type DailyArticlesOptions,
} from "./rules/articles";

/* --------------------------------------------------------------------------
 * Tunables (Phase 13 owns the final balance pass)
 * ------------------------------------------------------------------------ */

/** The campaign opens on Day 1, exactly like the {@link Company} clock. */
export const CALENDAR_DAY_MIN = 1;

/**
 * Longest a single Detachment may be away. A campaign-day cap keeps a dispatch
 * from outliving the theatre; the authored contracts stay well below it.
 */
export const DISPATCH_DURATION_MAX = 365;

/* --------------------------------------------------------------------------
 * Dispatch timers (mapping §10 — FFTA "dispatch missions")
 * ------------------------------------------------------------------------ */

/**
 * A **Detachment** in the field (FFTA "dispatch mission"): a party of soldiers
 * sent away for a fixed number of campaign days. The timer is kept as two
 * integers — when it left and how long it is gone — and the derived
 * {@link returnDay} the calendar ticks against.
 */
export interface Dispatch {
  /** Stable handle for this dispatch (so it can be cancelled or resolved once). */
  readonly id: DispatchId;
  /** The Detachment contract the party was sent on (T070). */
  readonly contractId: ContractId;
  /** The soldiers who are away; their ids stay on the roster while they march. */
  readonly unitIds: readonly UnitId[];
  /** Campaign day the party left. */
  readonly dispatchedOnDay: number;
  /** Days the party is away; a positive integer. */
  readonly duration: number;
  /** Campaign day the party returns (`dispatchedOnDay + duration`). */
  readonly returnDay: number;
}

/** Authoring input for {@link createDispatch}; `dispatchedOnDay` defaults to the calendar day. */
export interface DispatchInit {
  readonly id: DispatchId;
  readonly contractId: ContractId;
  readonly unitIds: readonly UnitId[];
  /** Campaign day the party leaves; defaults to the calendar's current day. */
  readonly dispatchedOnDay?: number;
  /** Days the party is away; a positive integer. */
  readonly duration: number;
}

/** Why a dispatch cannot be scheduled (empty ⇒ it can). */
export type DispatchBlocker = "duplicate-dispatch" | "unit-already-dispatched" | "empty-party";

/* --------------------------------------------------------------------------
 * The calendar
 * ------------------------------------------------------------------------ */

/**
 * The campaign **clock** and its scheduled work. Treat as immutable: use the
 * helpers below rather than mutating fields.
 */
export interface CampaignCalendar {
  /** Seed the per-day Article draw is derived from (T055). */
  readonly seed: Seed;
  /** The campaign day, starting at {@link CALENDAR_DAY_MIN}. */
  readonly day: number;
  /**
   * The region the company occupies, or `null` between postings. Region-scoped
   * Articles only appear when they match this (T054/T055). Kept in sync with
   * `Company.theatre.regionId` by {@link syncCompany}.
   */
  readonly regionId: RegionId | null;
  /** Active dispatches, in scheduling order (deterministic). */
  readonly dispatches: readonly Dispatch[];
}

/** Authoring/creation input for {@link createCalendar}; every field is optional but `seed`. */
export interface CampaignCalendarInit {
  readonly seed: Seed;
  readonly day?: number;
  readonly regionId?: RegionId | null;
  readonly dispatches?: readonly DispatchInit[];
}

/** The result of advancing the clock: the new calendar and the parties that came home. */
export interface DispatchTick {
  /** The calendar after ticking (completed dispatches removed). */
  readonly calendar: CampaignCalendar;
  /** Dispatches whose {@link Dispatch.returnDay} has been reached, in schedule order. */
  readonly completed: readonly Dispatch[];
}

/** The result of {@link advanceCampaign}: the company, calendar, returns and the day's Articles. */
export interface CampaignAdvance {
  /** The company with `theatre.day` and `theatre.regionId` synced to the calendar. */
  readonly company: Company;
  /** The advanced calendar. */
  readonly calendar: CampaignCalendar;
  /** Parties that returned on the advance, in schedule order. */
  readonly completed: readonly Dispatch[];
  /** The standing orders for the new day. */
  readonly articles: DailyArticles;
}

/* --------------------------------------------------------------------------
 * Validation internals
 * ------------------------------------------------------------------------ */

function assertCampaignDay(day: number, label: string): void {
  if (!Number.isInteger(day) || day < CALENDAR_DAY_MIN) {
    throw new RangeError(
      `${label} must be an integer >= ${CALENDAR_DAY_MIN}, received ${String(day)}`,
    );
  }
}

function assertPositiveDays(days: number, label: string): void {
  if (!Number.isInteger(days) || days < 1) {
    throw new RangeError(`${label} must be a positive integer, received ${String(days)}`);
  }
}

function assertSeed(seed: Seed): void {
  if (typeof seed === "number") {
    if (!Number.isFinite(seed)) {
      throw new RangeError(`calendar.seed must be a finite number, received ${String(seed)}`);
    }
    return;
  }
  if (typeof seed !== "string" || seed.trim().length === 0) {
    throw new RangeError("calendar.seed must be a non-empty string or a finite number");
  }
}

function assertDuration(duration: number, label: string): void {
  if (!Number.isInteger(duration) || duration < 1 || duration > DISPATCH_DURATION_MAX) {
    throw new RangeError(
      `${label} must be an integer in [1, ${DISPATCH_DURATION_MAX}], received ${String(duration)}`,
    );
  }
}

/**
 * Validate and normalise one dispatch. The party must be non-empty and free of
 * duplicate soldiers, and the derived `returnDay` is always recomputed so a
 * tampered save cannot make a timer lie.
 *
 * @throws RangeError on a malformed id/contract/day/duration or a bad party.
 */
export function createDispatch(
  init: DispatchInit,
  defaultDay: number = CALENDAR_DAY_MIN,
): Dispatch {
  assertId(init.id, "dispatch.id");
  assertId(init.contractId, "dispatch.contractId");

  const dispatchedOnDay = init.dispatchedOnDay ?? defaultDay;
  assertCampaignDay(dispatchedOnDay, "dispatch.dispatchedOnDay");
  assertDuration(init.duration, "dispatch.duration");

  if (init.unitIds.length === 0) {
    throw new RangeError(`dispatch ${init.id} must send at least one soldier`);
  }
  const seen = new Set<string>();
  const unitIds: UnitId[] = [];
  for (let index = 0; index < init.unitIds.length; index++) {
    const unitId = init.unitIds[index] as UnitId;
    assertId(unitId, `dispatch.unitIds[${index}]`);
    if (seen.has(unitId)) {
      throw new RangeError(`dispatch ${init.id} lists soldier ${unitId} twice`);
    }
    seen.add(unitId);
    unitIds.push(unitId);
  }

  return {
    id: init.id,
    contractId: init.contractId,
    unitIds,
    dispatchedOnDay,
    duration: init.duration,
    returnDay: dispatchedOnDay + init.duration,
  };
}

/** Normalise a full dispatch list, rejecting duplicate ids and double-booked soldiers. */
function normalizeDispatches(
  dispatches: readonly DispatchInit[],
  defaultDay: number,
): readonly Dispatch[] {
  const normalized: Dispatch[] = [];
  const ids = new Set<string>();
  const away = new Set<string>();
  for (let index = 0; index < dispatches.length; index++) {
    const dispatch = createDispatch(dispatches[index] as DispatchInit, defaultDay);
    if (ids.has(dispatch.id)) {
      throw new RangeError(`calendar.dispatches[${index}] duplicates dispatch id ${dispatch.id}`);
    }
    ids.add(dispatch.id);
    for (const unitId of dispatch.unitIds) {
      if (away.has(unitId)) {
        throw new RangeError(
          `calendar.dispatches[${index}] sends soldier ${unitId} away while already dispatched`,
        );
      }
      away.add(unitId);
    }
    normalized.push(dispatch);
  }
  return normalized;
}

/* --------------------------------------------------------------------------
 * Creation
 * ------------------------------------------------------------------------ */

/**
 * Build and validate a {@link CampaignCalendar}. A fresh campaign is simply:
 *
 * ```ts
 * createCalendar({ seed: "waterloo-1815" });
 * // { seed, day: 1, regionId: null, dispatches: [] }
 * ```
 *
 * @throws RangeError on a bad seed/day/region, or a malformed or duplicated
 *   dispatch.
 */
export function createCalendar(init: CampaignCalendarInit): CampaignCalendar {
  assertSeed(init.seed);

  const day = init.day ?? CALENDAR_DAY_MIN;
  assertCampaignDay(day, "calendar.day");

  const regionId = init.regionId ?? null;
  if (regionId !== null) assertId(regionId, "calendar.regionId");

  return {
    seed: init.seed,
    day,
    regionId,
    dispatches: normalizeDispatches(init.dispatches ?? [], day),
  };
}

/**
 * Open a calendar on the company's current day and region. The company clock is
 * a projection of the calendar ({@link syncCompany}), so this is the bridge used
 * when a campaign is loaded from a save.
 */
export function calendarForCompany(company: Company, seed: Seed): CampaignCalendar {
  return createCalendar({
    seed,
    day: company.theatre.day,
    regionId: company.theatre.regionId,
  });
}

/* --------------------------------------------------------------------------
 * Daily Articles of War (mapping §9)
 * ------------------------------------------------------------------------ */

/**
 * Generate the standing orders in force on the calendar's current day.
 *
 * Delegates to `generateDailyArticles` (T055), which derives an independent
 * generator from `(seed, day)` — so the same `(seed, day, region)` always
 * produces a byte-identical posting, and generating day 7 before day 3 gives
 * the same day-7 list as the reverse order (`agents.md` §2 determinism). The
 * calendar's `regionId` scopes region-only Articles unless `options.regionId`
 * overrides it.
 *
 * ```ts
 * const day = createCalendar({ seed: 12, day: 8 });
 * articlesForDay(day).ids; // e.g. ["no-rifle", "commend-musket"]
 * ```
 */
export function articlesForDay(
  calendar: CampaignCalendar,
  options: DailyArticlesOptions = {},
): DailyArticles {
  const regionId = options.regionId ?? calendar.regionId ?? undefined;
  return generateDailyArticles(calendar.seed, calendar.day, {
    ...options,
    ...(regionId !== undefined ? { regionId } : {}),
  });
}

/* --------------------------------------------------------------------------
 * Dispatch queries
 * ------------------------------------------------------------------------ */

/** The dispatch with `dispatchId`, or `undefined` when it is not running. */
export function dispatchById(
  calendar: CampaignCalendar,
  dispatchId: DispatchId,
): Dispatch | undefined {
  return calendar.dispatches.find((dispatch) => dispatch.id === dispatchId);
}

/** Campaign days until `dispatch` returns, floored at `0` once it is due. */
export function dispatchDaysRemaining(dispatch: Dispatch, day: number): number {
  assertCampaignDay(day, "day");
  return Math.max(0, dispatch.returnDay - day);
}

/** `true` when `dispatch` has returned by `day` (`returnDay <= day`). */
export function isDispatchDue(dispatch: Dispatch, day: number): boolean {
  assertCampaignDay(day, "day");
  return dispatch.returnDay <= day;
}

/** `true` while `unitId` is away on any dispatch in the calendar. */
export function isUnitDispatched(calendar: CampaignCalendar, unitId: UnitId): boolean {
  return calendar.dispatches.some((dispatch) => dispatch.unitIds.includes(unitId));
}

/** The dispatch holding `unitId` away, or `undefined` when the soldier is present. */
export function dispatchForUnit(
  calendar: CampaignCalendar,
  unitId: UnitId,
): Dispatch | undefined {
  return calendar.dispatches.find((dispatch) => dispatch.unitIds.includes(unitId));
}

/** Dispatches still in the field on the calendar's current day, in schedule order. */
export function activeDispatches(calendar: CampaignCalendar): readonly Dispatch[] {
  return calendar.dispatches.filter((dispatch) => dispatch.returnDay > calendar.day);
}

/**
 * Dispatches whose return day has been reached but which have not yet been
 * ticked away, in schedule order. Normally empty (the clock ticks on every
 * advance); non-empty when a calendar is built with a future `day` or inspected
 * before {@link tickDispatches}.
 */
export function dueDispatches(calendar: CampaignCalendar): readonly Dispatch[] {
  return calendar.dispatches.filter((dispatch) => dispatch.returnDay <= calendar.day);
}

/* --------------------------------------------------------------------------
 * Scheduling dispatches
 * ------------------------------------------------------------------------ */

/**
 * Every reason `init` cannot be scheduled against `calendar`, in a stable
 * order. An empty array means {@link scheduleDispatch} will succeed.
 *
 * | Blocker                    | Rule                                            |
 * | -------------------------- | ----------------------------------------------- |
 * | `duplicate-dispatch`       | that dispatch id is already running             |
 * | `unit-already-dispatched`  | one of the soldiers is already away             |
 * | `empty-party`              | no soldiers were named                          |
 */
export function dispatchBlockers(
  calendar: CampaignCalendar,
  init: DispatchInit,
): readonly DispatchBlocker[] {
  const blockers: DispatchBlocker[] = [];
  if (init.unitIds.length === 0) blockers.push("empty-party");
  if (dispatchById(calendar, init.id) !== undefined) blockers.push("duplicate-dispatch");
  if (init.unitIds.some((unitId) => isUnitDispatched(calendar, unitId))) {
    blockers.push("unit-already-dispatched");
  }
  return blockers;
}

/** `true` when {@link scheduleDispatch} would accept `init`. */
export function canScheduleDispatch(calendar: CampaignCalendar, init: DispatchInit): boolean {
  return dispatchBlockers(calendar, init).length === 0;
}

/**
 * Send a party away: validate the timer, refuse a double-booked soldier and
 * return a new calendar holding the new {@link Dispatch}. The party leaves on
 * the calendar's current day and returns `duration` days later.
 *
 * ```ts
 * const away = scheduleDispatch(calendar, {
 *   id: asDispatchId("dispatch-1"),
 *   contractId: asContractId("forage-the-valley"),
 *   unitIds: [asUnitId("unit-3"), asUnitId("unit-4")],
 *   duration: 4,
 * });
 * ```
 *
 * @throws RangeError when any {@link DispatchBlocker} applies or the timer is
 *   malformed.
 */
export function scheduleDispatch(
  calendar: CampaignCalendar,
  init: DispatchInit,
): CampaignCalendar {
  const blockers = dispatchBlockers(calendar, init);
  if (blockers.length > 0) {
    throw new RangeError(`cannot schedule dispatch ${init.id}: ${blockers.join(", ")}`);
  }
  const dispatch = createDispatch(init, calendar.day);
  return { ...calendar, dispatches: [...calendar.dispatches, dispatch] };
}

/**
 * Cancel a running dispatch without resolving it (the party is recalled).
 * Returns the same calendar unchanged when the dispatch is not running, in the
 * spirit of `removeMember` (T068).
 */
export function cancelDispatch(
  calendar: CampaignCalendar,
  dispatchId: DispatchId,
): CampaignCalendar {
  assertId(dispatchId, "dispatchId");
  const dispatches = calendar.dispatches.filter((dispatch) => dispatch.id !== dispatchId);
  if (dispatches.length === calendar.dispatches.length) return calendar;
  return { ...calendar, dispatches };
}

/* --------------------------------------------------------------------------
 * Advancing the clock
 * ------------------------------------------------------------------------ */

/**
 * Tick the dispatches against the calendar's current day: every dispatch whose
 * {@link Dispatch.returnDay} has been reached is removed from the active list
 * and returned as `completed` for the caller to resolve (T072). Pure; the input
 * calendar is never mutated.
 */
export function tickDispatches(calendar: CampaignCalendar): DispatchTick {
  const completed: Dispatch[] = [];
  const remaining: Dispatch[] = [];
  for (const dispatch of calendar.dispatches) {
    if (dispatch.returnDay <= calendar.day) completed.push(dispatch);
    else remaining.push(dispatch);
  }
  return { calendar: { ...calendar, dispatches: remaining }, completed };
}

/**
 * Advance the campaign clock by `days` (default `1`) and tick the dispatch
 * timers against the new day. Returns the new calendar and the parties that
 * came home, in schedule order.
 *
 * ```ts
 * const { calendar, completed } = advanceDays(calendar, 4);
 * completed.map((dispatch) => dispatch.id); // parties due on or before the new day
 * ```
 *
 * @throws RangeError when `days` is not a positive integer.
 */
export function advanceDays(calendar: CampaignCalendar, days = 1): DispatchTick {
  assertPositiveDays(days, "days");
  return tickDispatches({ ...calendar, day: calendar.day + days });
}

/** Move the calendar to `regionId` (or `null`) so region Articles rotate with the company. */
export function withRegion(calendar: CampaignCalendar, regionId: RegionId | null): CampaignCalendar {
  if (regionId !== null) assertId(regionId, "regionId");
  return { ...calendar, regionId };
}

/* --------------------------------------------------------------------------
 * Company bridge
 * ------------------------------------------------------------------------ */

/**
 * Write the calendar's day and region back onto a company's theatre state,
 * charting a newly reached region. This keeps `Company.theatre` a faithful
 * projection of the campaign clock (`agents.md` §2).
 */
export function syncCompany(company: Company, calendar: CampaignCalendar): Company {
  return withTheatre(company, {
    day: calendar.day,
    regionId: calendar.regionId,
    knownRegionIds: company.theatre.knownRegionIds,
  });
}

/**
 * Advance the whole campaign in one step: move the calendar, sync the company's
 * theatre to it, collect the parties that returned, and generate the new day's
 * **Articles of War**.
 *
 * This is the single transition a campaign controller (or the campaign tests,
 * T079) calls to spend time — it guarantees the company clock, the dispatch
 * timers and the standing orders never disagree.
 *
 * ```ts
 * const { company, calendar, completed, articles } = advanceCampaign(
 *   company,
 *   calendar,
 *   4,
 * );
 * ```
 *
 * @throws RangeError when `days` is not a positive integer.
 */
export function advanceCampaign(
  company: Company,
  calendar: CampaignCalendar,
  days = 1,
): CampaignAdvance {
  const tick = advanceDays(calendar, days);
  return {
    company: syncCompany(company, tick.calendar),
    calendar: tick.calendar,
    completed: tick.completed,
    articles: articlesForDay(tick.calendar),
  };
}
