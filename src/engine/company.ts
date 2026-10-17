/**
 * The Company model (T068) — the player's **free company** (FFTA "clan",
 * mapping §1): the persistent campaign record that every later Phase 6 system
 * reads and writes.
 *
 * A battle is a *detachment action* inside a larger war (mapping §0, D0). The
 * thing the player actually owns between those actions is the **Company**: the
 * multinational corps they recruit, pay, promote and march around the
 * **Theatre** (mapping §1, §10). This module is that record and nothing more —
 * the economy, the recruiting policy, the calendar and the campaign map all
 * build on the plain, serialisable value defined here.
 *
 * ```
 *   ┌────────────────────────── Company ──────────────────────────┐
 *   │ id, name                                                    │
 *   │ crowns        ── the war chest (FFTA gil, mapping §5)       │
 *   │ honours       ── Regimental Honours (FFTA clan titles, §1)  │
 *   │ roster[]      ── RosterMember { unit, assignment, day }     │
 *   │ theatre       ── TheatreState { day, region, known regions }│
 *   └─────────────────────────────────────────────────────────────┘
 * ```
 *
 * ## What this module owns
 *
 * - {@link Company} — the campaign record: name, **Crowns**, **Regimental
 *   Honours**, the **roster** and the current **theatre state**.
 * - {@link RosterMember} — one soldier: its battlefield {@link Unit} (T017)
 *   plus the {@link PostAssignment} progression record (T051). Per that
 *   module's contract the assignment — not the unit's `postId` snapshot — is
 *   the authority for stats and equip legality.
 * - {@link TheatreState} — where and *when* the company is: the campaign
 *   **day** (T076 owns the calendar that advances it), the current
 *   **region** and the regions it has charted (T073 owns the map).
 * - Pure, immutable updates for the economy, the roster and travel:
 *   {@link addCrowns}, {@link spendCrowns}, {@link awardHonours},
 *   {@link addMember}, {@link removeMember}, {@link advanceDay},
 *   {@link travelTo}.
 * - The **recruiting office** loop (T069): {@link createRecruitingOffice},
 *   {@link recruitFee}, {@link recruitBlockers}, {@link canRecruit},
 *   {@link recruitSoldier} and {@link dismissMember}, so a garrison town can
 *   sign a soldier of a given **power** and the company can release one.
 *
 * ## Contract (`agents.md` §2, §3, §7, §9)
 *
 * - **Engine purity & determinism** — framework-free, DOM-free TypeScript with
 *   no `Math.random` and no `Date`. The campaign clock is the integer
 *   {@link TheatreState.day}, advanced explicitly, so a save plus an ordered
 *   list of campaign commands always reproduces the same company.
 * - **State in, state out** — the input is never mutated; every helper returns
 *   a **new** {@link Company} (structural sharing is fine). The engine treats
 *   campaign state exactly like battle state.
 * - **Trust boundary** — {@link createCompany} and {@link parseCompany} rebuild
 *   every member through the authored factories (`createUnit`, T017;
 *   `createPostAssignment`, T051), so a corrupt save or a bad fixture fails
 *   loudly instead of poisoning the campaign.
 * - **Data-driven** — the roster cap, the starting economy and the recruiting
 *   *policy* (offices, fees, dismissal limits) live here as named constants and
 *   plain value objects, so T069 tunes them in one place.
 *
 * Reference: mapping §1 (Clan → Company, Gil → Crowns, clan title →
 * Regimental Honours, world map → The Theatre), §5 (resources) and §10
 * (campaign layer). This is original fiction inspired by the Napoleonic Wars,
 * not a port of FFTA's clan records.
 */

import { canTakePost, isPostKey } from "../data/posts";
import type { PowerKey } from "../data/schema";
import { coord } from "./grid";
import { assertId, type CompanyId, type PostId, type RegionId, type UnitId } from "./ids";
import { createPostAssignment, derivePostStats, type PostAssignment } from "./progression/posts";
import { createUnit, isPowerKey, type Unit } from "./unit";

/* --------------------------------------------------------------------------
 * Tunables (Phase 13 owns the final balance pass)
 * ------------------------------------------------------------------------ */

/** A company can never owe money; Crowns bottom out at zero. */
export const CROWNS_MIN = 0;

/** Regimental Honours are a count of distinctions earned, never negative. */
export const HONOURS_MIN = 0;

/** The campaign opens on Day 1 (T076 owns the calendar thereafter). */
export const CAMPAIGN_DAY_MIN = 1;

/**
 * Most soldiers the roster may hold. FFTA clans grow across a whole campaign,
 * so this is deliberately generous; T069's recruiting office enforces the real
 * policy (fees, offices, dismissals) against this cap.
 */
export const ROSTER_MAX = 24;

/**
 * Fewest soldiers a company may keep. The colours do not march without at
 * least one stand under them, so {@link dismissMember} refuses to leave the
 * company empty.
 */
export const ROSTER_MIN = 1;

/** Lowest level a recruiting office will sign a fresh soldier at. */
export const RECRUIT_LEVEL_MIN = 1;

/**
 * Default Crowns a recruiting office charges to sign a level-1 recruit. T069
 * policy (Phase 13 rebalances); an office may override it.
 */
export const RECRUIT_BASE_FEE = 200;

/** Added to a recruit's fee for every level above {@link RECRUIT_LEVEL_MIN}. */
export const RECRUIT_FEE_PER_LEVEL = 150;

/** Longest a company name may be, so the UI never has to truncate mid-word. */
export const COMPANY_NAME_MAX = 40;

/* --------------------------------------------------------------------------
 * Theatre state (mapping §1, §10)
 * ------------------------------------------------------------------------ */

/**
 * Where the company is in the **Theatre** (the fictionalized Napoleonic Europe
 * the campaign map depicts, mapping §1). The detailed map and calendar are
 * later tasks (T073/T076); this is the small, serialisable snapshot the Company
 * carries so those systems have a home.
 */
export interface TheatreState {
  /**
   * The campaign **day**, starting at {@link CAMPAIGN_DAY_MIN}. Time is
   * discrete and advanced explicitly (never read from a clock), so daily
   * Articles of War (T055/T076) and dispatch timers stay deterministic.
   */
  readonly day: number;
  /**
   * The region the company currently occupies, or `null` while it is between
   * postings. Travel sets it (see {@link travelTo}).
   */
  readonly regionId: RegionId | null;
  /**
   * Regions the company has charted, in first-seen order. Traveling to a region
   * adds it; the current region is always included.
   */
  readonly knownRegionIds: readonly RegionId[];
}

/** Authoring input for {@link createTheatre}; every field is optional. */
export interface TheatreInit {
  readonly day?: number;
  readonly regionId?: RegionId | null;
  readonly knownRegionIds?: readonly RegionId[];
}

/* --------------------------------------------------------------------------
 * Roster members
 * ------------------------------------------------------------------------ */

/**
 * One soldier in the company roster: the battlefield {@link Unit} (T017)
 * together with the {@link PostAssignment} progression record (T051) that is
 * authoritative for stats, skillsets and equipped slots between battles.
 */
export interface RosterMember {
  /** The soldier's current battle snapshot; its `id` is the roster key. */
  readonly unit: Unit;
  /** Primary/attached post, chosen skillset and ability slots (T051). */
  readonly assignment: PostAssignment;
  /** Campaign day the soldier joined (for seniority, pay and fiction). */
  readonly recruitedOnDay: number;
}

/** Authoring input for {@link createRosterMember}. */
export interface RosterMemberInit {
  readonly unit: Unit;
  readonly assignment: PostAssignment;
  readonly recruitedOnDay?: number;
}

/* --------------------------------------------------------------------------
 * The company
 * ------------------------------------------------------------------------ */

/**
 * The player's free company — the persistent campaign record (mapping §1).
 * Treat as immutable: use the `with…`/`add…`/`spend…` helpers below rather
 * than mutating fields.
 */
export interface Company {
  /** Stable, branded identity (a save may hold several companies). */
  readonly id: CompanyId;
  /** Player-facing company name (the fiction layer). */
  readonly name: string;
  /** The war chest (FFTA gil, mapping §5); a non-negative integer. */
  readonly crowns: number;
  /**
   * Earned **Regimental Honours** (FFTA clan titles, mapping §1) — a count of
   * the company's distinctions and reputation. Contract rewards grant them
   * (`ContractReward.honours`), and later systems may gate perks on the count.
   */
  readonly honours: number;
  /** The soldiers under the company's colours, in roster order. */
  readonly roster: readonly RosterMember[];
  /** Where and when the company currently is. */
  readonly theatre: TheatreState;
}

/** Authoring/creation input for {@link createCompany}. */
export interface CompanyInit {
  readonly id: CompanyId;
  readonly name: string;
  readonly crowns?: number;
  readonly honours?: number;
  readonly roster?: readonly RosterMemberInit[];
  readonly theatre?: TheatreInit;
}

/** Thrown when an untrusted value is not a well-formed company (see `parseCompany`). */
export class CompanyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompanyError";
  }
}

/* --------------------------------------------------------------------------
 * Validation (fail fast at the data/save boundary)
 * ------------------------------------------------------------------------ */

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RangeError(`${label} must be a non-empty string`);
  }
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < CROWNS_MIN) {
    throw new RangeError(`${label} must be an integer >= ${CROWNS_MIN}, received ${String(value)}`);
  }
}

function assertCampaignDay(value: number, label: string): void {
  if (!Number.isInteger(value) || value < CAMPAIGN_DAY_MIN) {
    throw new RangeError(
      `${label} must be an integer >= ${CAMPAIGN_DAY_MIN}, received ${String(value)}`,
    );
  }
}

/** Any integer at or above `min` (recruit levels, counts). */
function assertIntegerAtLeast(value: number, min: number, label: string): void {
  if (!Number.isInteger(value) || value < min) {
    throw new RangeError(`${label} must be an integer >= ${min}, received ${String(value)}`);
  }
}

/* --------------------------------------------------------------------------
 * Theatre
 * ------------------------------------------------------------------------ */

/**
 * Validate and normalise a theatre state. The current region is folded into
 * {@link TheatreState.knownRegionIds} (you always know where you are) and
 * duplicates are removed, so the result is canonical.
 */
export function createTheatre(init: TheatreInit = {}): TheatreState {
  const day = init.day ?? CAMPAIGN_DAY_MIN;
  assertCampaignDay(day, "theatre.day");

  const regionId = init.regionId ?? null;
  if (regionId !== null) assertId(regionId, "theatre.regionId");

  const knownRegionIds: RegionId[] = [];
  const seen = new Set<string>();
  const supplied = init.knownRegionIds ?? [];
  for (let index = 0; index < supplied.length; index++) {
    const id = supplied[index] as RegionId;
    assertId(id, `theatre.knownRegionIds[${index}]`);
    if (seen.has(id)) continue;
    seen.add(id);
    knownRegionIds.push(id);
  }
  if (regionId !== null && !seen.has(regionId)) {
    knownRegionIds.push(regionId);
  }

  return { day, regionId, knownRegionIds };
}

/* --------------------------------------------------------------------------
 * Roster members
 * ------------------------------------------------------------------------ */

/**
 * Validate and normalise one roster member. The {@link Unit} is rebuilt through
 * `createUnit` (T017) and the {@link PostAssignment} through
 * `createPostAssignment` (T051), so malformed input is rejected here rather
 * than corrupting the campaign. When `recruitedOnDay` is omitted it defaults to
 * `defaultDay` (normally the company's current campaign day).
 *
 * @throws RangeError when the unit, the assignment or the day is malformed, or
 *   when the assignment is not legal for the unit's power.
 */
export function createRosterMember(
  member: RosterMemberInit,
  defaultDay: number = CAMPAIGN_DAY_MIN,
): RosterMember {
  assertCampaignDay(defaultDay, "defaultDay");

  const unit = createUnit(member.unit);
  const assignment = createPostAssignment({
    ...member.assignment,
    power: unit.power,
  });

  const recruitedOnDay = member.recruitedOnDay ?? defaultDay;
  assertCampaignDay(recruitedOnDay, "rosterMember.recruitedOnDay");

  return { unit, assignment, recruitedOnDay };
}

/** Normalise a full roster, rejecting duplicates and overflow. */
function normalizeRoster(
  members: readonly RosterMemberInit[],
  defaultDay: number,
): readonly RosterMember[] {
  if (members.length > ROSTER_MAX) {
    throw new RangeError(`company.roster may hold at most ${ROSTER_MAX} members`);
  }
  const roster: RosterMember[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < members.length; index++) {
    const member = createRosterMember(members[index] as RosterMemberInit, defaultDay);
    const unitId = member.unit.id;
    if (seen.has(unitId)) {
      throw new RangeError(`company.roster[${index}] duplicates unit id ${unitId}`);
    }
    seen.add(unitId);
    roster.push(member);
  }
  return roster;
}

/* --------------------------------------------------------------------------
 * Creation
 * ------------------------------------------------------------------------ */

/**
 * Build and validate a {@link Company}. Every optional field has a safe
 * default, so a fresh company is simply:
 *
 * ```ts
 * createCompany({ id: asCompanyId("company-1"), name: "The Greycoats" });
 * // { crowns: 0, honours: 0, roster: [], theatre: { day: 1, ... } }
 * ```
 *
 * @throws RangeError on a malformed id/name/economy, an out-of-range day, a
 *   roster over {@link ROSTER_MAX}, duplicate unit ids or a bad member.
 */
export function createCompany(init: CompanyInit): Company {
  assertId(init.id, "company.id");
  assertNonEmptyString(init.name, "company.name");
  if (init.name.length > COMPANY_NAME_MAX) {
    throw new RangeError(
      `company.name must be at most ${COMPANY_NAME_MAX} characters, received ${String(init.name.length)}`,
    );
  }

  const crowns = init.crowns ?? CROWNS_MIN;
  assertNonNegativeInteger(crowns, "company.crowns");
  const honours = init.honours ?? HONOURS_MIN;
  assertNonNegativeInteger(honours, "company.honours");

  const theatre = createTheatre(init.theatre);
  const roster = normalizeRoster(init.roster ?? [], theatre.day);

  return { id: init.id, name: init.name, crowns, honours, roster, theatre };
}

/**
 * Validate an untrusted value and return it as a fresh {@link Company}. This is
 * the trust boundary for a save file or a fixture (T101); it rebuilds every
 * member through the authored factories and throws {@link CompanyError} when
 * the shape is wrong.
 */
export function parseCompany(value: unknown, label = "company"): Company {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CompanyError(`${label} must be an object`);
  }
  const record = value as Record<string, unknown>;
  try {
    return createCompany({
      id: record.id as CompanyId,
      name: record.name as string,
      crowns: record.crowns as number | undefined,
      honours: record.honours as number | undefined,
      roster: (record.roster as readonly RosterMemberInit[] | undefined) ?? [],
      theatre: (record.theatre as TheatreInit | undefined) ?? {},
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new CompanyError(`${label} is not a well-formed company: ${reason}`);
  }
}

/** `true` when `value` round-trips through {@link parseCompany}. */
export function isCompany(value: unknown): value is Company {
  try {
    parseCompany(value);
    return true;
  } catch {
    return false;
  }
}

/* --------------------------------------------------------------------------
 * Queries
 * ------------------------------------------------------------------------ */

/** The roster member with `unitId`, or `undefined` when not in the company. */
export function memberOf(company: Company, unitId: UnitId): RosterMember | undefined {
  return company.roster.find((member) => member.unit.id === unitId);
}

/** `true` when `unitId` is on the roster. */
export function hasMember(company: Company, unitId: UnitId): boolean {
  return memberOf(company, unitId) !== undefined;
}

/** How many soldiers the company currently holds. */
export function rosterSize(company: Company): number {
  return company.roster.length;
}

/** `true` when the roster is at {@link ROSTER_MAX} and no recruit may join. */
export function isRosterFull(company: Company): boolean {
  return company.roster.length >= ROSTER_MAX;
}

/** `true` when the war chest covers `cost` Crowns. */
export function canAfford(company: Company, cost: number): boolean {
  assertNonNegativeInteger(cost, "cost");
  return company.crowns >= cost;
}

/* --------------------------------------------------------------------------
 * Immutable updates — identity & economy
 * ------------------------------------------------------------------------ */

/** Rename the company (validated like {@link createCompany}). */
export function withName(company: Company, name: string): Company {
  assertNonEmptyString(name, "company.name");
  if (name.length > COMPANY_NAME_MAX) {
    throw new RangeError(
      `company.name must be at most ${COMPANY_NAME_MAX} characters, received ${String(name.length)}`,
    );
  }
  return { ...company, name };
}

/** Set the war chest to an exact amount (a non-negative integer). */
export function withCrowns(company: Company, crowns: number): Company {
  assertNonNegativeInteger(crowns, "company.crowns");
  return { ...company, crowns };
}

/** Add Crowns earned from a contract or sale. */
export function addCrowns(company: Company, amount: number): Company {
  assertNonNegativeInteger(amount, "amount");
  return { ...company, crowns: company.crowns + amount };
}

/**
 * Pay `amount` Crowns out of the war chest.
 *
 * @throws RangeError when `amount` is malformed or the company cannot afford
 *   it — an overspend is a caller bug, not a silent zero.
 */
export function spendCrowns(company: Company, amount: number): Company {
  assertNonNegativeInteger(amount, "amount");
  if (company.crowns < amount) {
    throw new RangeError(`company cannot afford ${amount} Crowns; it holds ${company.crowns}`);
  }
  return { ...company, crowns: company.crowns - amount };
}

/** Set the Regimental Honours count to an exact amount. */
export function withHonours(company: Company, honours: number): Company {
  assertNonNegativeInteger(honours, "company.honours");
  return { ...company, honours };
}

/** Award Regimental Honours for a decisive action or contract (mapping §12). */
export function awardHonours(company: Company, amount: number): Company {
  assertNonNegativeInteger(amount, "amount");
  return { ...company, honours: company.honours + amount };
}

/* --------------------------------------------------------------------------
 * Immutable updates — theatre
 * ------------------------------------------------------------------------ */

/** Replace the theatre state with a normalised one. */
export function withTheatre(company: Company, init: TheatreInit): Company {
  return { ...company, theatre: createTheatre(init) };
}

/** Advance the campaign clock by `days` (default `1`). */
export function advanceDay(company: Company, days = 1): Company {
  assertCampaignDay(days, "days");
  return {
    ...company,
    theatre: { ...company.theatre, day: company.theatre.day + days },
  };
}

/**
 * March the company to `regionId` (or to `null` for "between postings"),
 * charting the region if it is new. The current region is always known.
 */
export function travelTo(company: Company, regionId: RegionId | null): Company {
  if (regionId !== null) assertId(regionId, "regionId");
  const knownRegionIds =
    regionId !== null && !company.theatre.knownRegionIds.includes(regionId)
      ? [...company.theatre.knownRegionIds, regionId]
      : company.theatre.knownRegionIds;
  return { ...company, theatre: { ...company.theatre, regionId, knownRegionIds } };
}

/* --------------------------------------------------------------------------
 * Immutable updates — roster
 * ------------------------------------------------------------------------ */

/**
 * Add a soldier to the roster. The member is normalised like
 * {@link createRosterMember}, so its id is unique and its assignment is legal
 * for its power.
 *
 * @throws RangeError when the unit id is already on the roster or the roster is
 *   full ({@link ROSTER_MAX}).
 */
export function addMember(company: Company, member: RosterMemberInit): Company {
  const normalized = createRosterMember(member, company.theatre.day);
  if (hasMember(company, normalized.unit.id)) {
    throw new RangeError(`unit ${normalized.unit.id} is already on the roster`);
  }
  if (isRosterFull(company)) {
    throw new RangeError(`company roster is full (max ${ROSTER_MAX})`);
  }
  return { ...company, roster: [...company.roster, normalized] };
}

/**
 * Remove the soldier with `unitId` from the roster, returning the same company
 * unchanged when it is not present. This is the mechanical primitive;
 * {@link dismissMember} layers the player-facing dismissal policy on top.
 */
export function removeMember(company: Company, unitId: UnitId): Company {
  assertId(unitId, "unitId");
  const roster = company.roster.filter((member) => member.unit.id !== unitId);
  if (roster.length === company.roster.length) return company;
  return { ...company, roster };
}

/* --------------------------------------------------------------------------
 * Recruiting offices (mapping §10 — FFTA "recruit by race in towns")
 * ------------------------------------------------------------------------ */

/**
 * A **recruiting office** (mapping §10): a garrison-town post that signs new
 * soldiers of one great-power school. FFTA opens a roster slot at each town's
 * recruit screen; here the office names the **power** it draws from, the
 * **region** it stands in and the Crowns **fee** it charges for a level-1
 * recruit (higher levels scale by {@link RECRUIT_FEE_PER_LEVEL}).
 *
 * The office is a plain value so the campaign map (T073) can author offices as
 * data and the engine only enforces the policy.
 */
export interface RecruitingOffice {
  /** The military school whose recruits this office signs (FFTA race). */
  readonly power: PowerKey;
  /** The region the office stands in; the company must be present to recruit. */
  readonly regionId: RegionId;
  /** Base Crowns to sign a level-1 recruit; `0` is a free (pressed) recruit. */
  readonly fee: number;
}

/** Authoring input for {@link createRecruitingOffice}; `fee` defaults to {@link RECRUIT_BASE_FEE}. */
export interface RecruitingOfficeInit {
  readonly power: PowerKey;
  readonly regionId: RegionId;
  readonly fee?: number;
}

/**
 * Validate and normalise a recruiting office, so a bad fixture or save fails at
 * the boundary rather than at the recruit screen.
 *
 * @throws RangeError when the power is unknown, the region id is malformed or
 *   the fee is not a non-negative integer.
 */
export function createRecruitingOffice(init: RecruitingOfficeInit): RecruitingOffice {
  if (!isPowerKey(init.power)) {
    throw new RangeError(
      `office.power must be a great-power school, received ${String(init.power)}`,
    );
  }
  assertId(init.regionId, "office.regionId");
  const fee = init.fee ?? RECRUIT_BASE_FEE;
  assertNonNegativeInteger(fee, "office.fee");
  return { power: init.power, regionId: init.regionId, fee };
}

/**
 * The Crowns to sign a recruit of `level` at `office`. A level-1 soldier costs
 * the office's base fee; each level above adds {@link RECRUIT_FEE_PER_LEVEL}.
 */
export function recruitFee(office: RecruitingOffice, level: number = RECRUIT_LEVEL_MIN): number {
  assertNonNegativeInteger(office.fee, "office.fee");
  assertIntegerAtLeast(level, RECRUIT_LEVEL_MIN, "level");
  return office.fee + (level - RECRUIT_LEVEL_MIN) * RECRUIT_FEE_PER_LEVEL;
}

/**
 * The soldier a recruiting office is asked to sign. The office supplies the
 * **power**; the request supplies the identity and the primary **post** (FFTA
 * job). The post must be one the power may take (its own school or a common
 * post). Level defaults to {@link RECRUIT_LEVEL_MIN}.
 */
export interface RecruitRequest {
  /** The new soldier's unit id (the roster key). */
  readonly unitId: UnitId;
  /** Player-facing name (the fiction layer). */
  readonly name: string;
  /** The post supplying the recruit's stats and kit. */
  readonly postId: PostId;
  /** Starting level, an integer `>= 1`; defaults to 1. */
  readonly level?: number;
}

/** Why a recruiting office cannot sign a request right now (empty ⇒ it can). */
export type RecruitBlocker =
  "wrong-region" | "roster-full" | "duplicate-unit" | "insufficient-crowns" | "post-not-available";

/**
 * Every reason `request` cannot be signed at `office`, in a stable order. An
 * empty array means {@link canRecruit} is `true` and {@link recruitSoldier}
 * will succeed.
 *
 * The checks, in order, are the same ones the recruit screen shows an officer:
 *
 * | Blocker                 | Rule                                              |
 * | ----------------------- | ------------------------------------------------- |
 * | `wrong-region`          | the company is not in the office's region          |
 * | `roster-full`           | the roster is at {@link ROSTER_MAX}                |
 * | `duplicate-unit`        | the unit id is already on the roster               |
 * | `insufficient-crowns`   | the war chest cannot cover {@link recruitFee}      |
 * | `post-not-available`    | the post is unknown or barred to the office's power |
 *
 * @throws RangeError when `request.level` is not an integer `>= 1`.
 */
export function recruitBlockers(
  company: Company,
  office: RecruitingOffice,
  request: RecruitRequest,
): readonly RecruitBlocker[] {
  const blockers: RecruitBlocker[] = [];
  const level = request.level ?? RECRUIT_LEVEL_MIN;
  // Validates the level and the office fee before anything else.
  const fee = recruitFee(office, level);

  if (company.theatre.regionId !== office.regionId) blockers.push("wrong-region");
  if (isRosterFull(company)) blockers.push("roster-full");
  if (hasMember(company, request.unitId)) blockers.push("duplicate-unit");
  if (!isPostKey(request.postId) || !canTakePost(request.postId, office.power)) {
    blockers.push("post-not-available");
  }
  if (!canAfford(company, fee)) blockers.push("insufficient-crowns");

  return blockers;
}

/** `true` when {@link recruitSoldier} would sign `request` at `office`. */
export function canRecruit(
  company: Company,
  office: RecruitingOffice,
  request: RecruitRequest,
): boolean {
  return recruitBlockers(company, office, request).length === 0;
}

/**
 * Recruit a fresh soldier at a **recruiting office** (mapping §10). The office
 * decides the power, the request the identity and post, and the fee is paid
 * from the war chest. The new member joins the roster immediately at the
 * company's current campaign day.
 *
 * ```ts
 * const office = createRecruitingOffice({
 *   power: "france",
 *   regionId: asRegionId("sainte-colombe"),
 * });
 * const company = travelTo(funded, office.regionId);
 * recruitSoldier(company, office, {
 *   unitId: asUnitId("unit-9"),
 *   name: "Cpl. Voss",
 *   postId: asPostId("fusilier"),
 * });
 * ```
 *
 * @throws RangeError when any {@link RecruitBlocker} applies, or the recruit's
 *   assignment/unit data is malformed.
 */
export function recruitSoldier(
  company: Company,
  office: RecruitingOffice,
  request: RecruitRequest,
): Company {
  const blockers = recruitBlockers(company, office, request);
  if (blockers.length > 0) {
    throw new RangeError(`cannot recruit: ${blockers.join(", ")}`);
  }

  const level = request.level ?? RECRUIT_LEVEL_MIN;
  const assignment = createPostAssignment({
    primaryPostId: request.postId,
    power: office.power,
  });
  const stats = derivePostStats({ level, assignment });
  const unit = createUnit({
    id: request.unitId,
    name: request.name,
    power: office.power,
    postId: request.postId,
    level,
    at: coord(0, 0),
    stats,
  });

  const joined = addMember(company, { unit, assignment });
  return spendCrowns(joined, recruitFee(office, level));
}

/**
 * Dismiss the soldier with `unitId` from the company (FFTA "release a clan
 * member", mapping §10). A companion leaves without a fee, but the last soldier
 * may never be dismissed ({@link ROSTER_MIN}), and dismissing someone who is
 * not on the roster is a caller bug rather than a silent no-op.
 *
 * @throws RangeError when the soldier is not on the roster or is the last one.
 */
export function dismissMember(company: Company, unitId: UnitId): Company {
  assertId(unitId, "unitId");
  if (!hasMember(company, unitId)) {
    throw new RangeError(`unit ${unitId} is not on the roster`);
  }
  if (company.roster.length <= ROSTER_MIN) {
    throw new RangeError(`company must keep at least ${ROSTER_MIN} soldier(s)`);
  }
  return removeMember(company, unitId);
}
