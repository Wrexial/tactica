/**
 * Campaign save/load (T101) — snapshot the whole **campaign sandbox** as one
 * JSON-safe payload, round-trip it through a {@link SaveStore} and rebuild it
 * through the authored engine factories on the way back in.
 *
 * The engine is a pure, deterministic value (`agents.md` §2, §7): a battle is
 * `seed + setup + command log`, and a campaign is the same idea one level up —
 * the **company**, the **campaign map**, the **contracts** it has taken, and a
 * seeded **history** of what has happened. T100 gave those bytes a home (a
 * versioned {@link SaveStore}); this module defines *what* a campaign save is
 * and how it survives the trip to disk and back.
 *
 * ```
 *   ┌──────────────────────────── CampaignSave ─────────────────────────────┐
 *   │ version    ── the campaign payload format (migrations live in T104)    │
 *   │ seed       ── the root campaign seed (battles derive their own seed)  │
 *   │ company    ── roster, Crowns, Honours, theatre (T068)                 │
 *   │ map        ── the Theatre + placed markers (T073)                     │
 *   │ calendar   ── the campaign clock + dispatch timers (T076)             │
 *   │ inventory  ── the quartermaster reserve (FFTA item bag, T075)         │
 *   │ progress   ── story chapter + active/completed contracts (T070/T077)  │
 *   │ history[]  ── the ordered campaign log (this module)                  │
 *   └───────────────────────────────────────────────────────────────────────┘
 * ```
 *
 * ## The trust boundary
 *
 * A save file is untrusted input. {@link createCampaignSave} and
 * {@link parseCampaignSave} validate *every* part by rebuilding it through the
 * engine's own factories — {@link import("../engine/company").parseCompany},
 * {@link import("../engine/campaignMap").parseCampaignMap},
 * {@link import("../engine/calendar").createCalendar},
 * {@link import("../engine/depot").createDepotInventory} — so a corrupt or
 * hostile record fails loudly with a {@link CampaignSaveError} instead of
 * poisoning a campaign. Nothing here mutates engine state; a snapshot is a
 * value in, a fresh value out.
 *
 * ## Contract (`agents.md` §2, §3, §7, §9)
 *
 * - **Edge layer.** `src/persist` may talk to the DOM (`saveStore.ts`); the
 *   engine stays framework-free. This module imports the engine *one way* and
 *   builds no game rules of its own.
 * - **Serialisable payloads.** A {@link CampaignSave} survives
 *   `structuredClone`/JSON; {@link serializeCampaign}/{@link deserializeCampaign}
 *   round-trip it to text.
 * - **Deterministic.** No `Math.random`, no `Date`. The seed and the ordered
 *   history are carried so a campaign can be replayed; the format version is
 *   carried so T104 can migrate older saves forward.
 * - **Validated at load.** Every id, integer and reference is checked at the
 *   boundary; unknown fields are dropped.
 *
 * Reference: mapping §10 (the campaign sandbox), §12 D15 (determinism, seeded
 * RNG, command log). This is original fiction inspired by the Napoleonic Wars,
 * not a port of FFTA's save data.
 */

import { isContractKey } from "../data/contracts";
import { MAX_STORY_CHAPTER, type StoryFacts } from "../data/story";

import {
  createCalendar,
  type CampaignCalendar,
  type CampaignCalendarInit,
} from "../engine/calendar";
import {
  parseCampaignMap,
  type CampaignMapInit,
  type CampaignMapState,
} from "../engine/campaignMap";
import { parseCompany, type Company, type CompanyInit } from "../engine/company";
import { createDepotInventory, type DepotInventory } from "../engine/depot";
import { coord, type Coord } from "../engine/grid";
import {
  parseId,
  type ContractId,
  type DispatchId,
  type MapTokenId,
  type RegionId,
} from "../engine/ids";
import type { Seed } from "../engine/rng";
import { canonicalStringify } from "../engine/serialize";

import type { SaveEnvelope, SaveOptions, SaveStore } from "./saveStore";

/* --------------------------------------------------------------------------
 * Constants
 * ------------------------------------------------------------------------ */

/** Current campaign-payload format version. Bump when the shape changes (T104). */
export const CAMPAIGN_SAVE_VERSION = 1;

/**
 * The stable handles a {@link CampaignHistoryEntry} may use, in authoring order.
 * Kept as a tuple so a typo is a compile error and the runtime guard can reuse
 * it.
 */
export const CAMPAIGN_HISTORY_KINDS = [
  "day-advanced",
  "region-travelled",
  "contract-accepted",
  "contract-completed",
  "marker-placed",
  "treasure-hunted",
  "detachment-sent",
] as const;
export type CampaignHistoryKind = (typeof CAMPAIGN_HISTORY_KINDS)[number];

/* --------------------------------------------------------------------------
 * Progress — the story spine & the contract ledger
 * ------------------------------------------------------------------------ */

/**
 * How far the campaign has advanced: the **story chapter** reached and the
 * **contract ledger** (the posting being undertaken now plus everything already
 * completed, in completion order).
 *
 * The ledger is the campaign's answer to "which contracts have been fought?",
 * the fact {@link import("../data/story").StoryFacts} is built from and the
 * thing T077's `advanceChapter` reads. Every id must be an authored contract
 * key, so a save cannot silently reference a contract this build does not know.
 */
export interface CampaignProgress {
  /** Story chapter reached, in `0..`{@link MAX_STORY_CHAPTER}; `0` = not started. */
  readonly chapter: number;
  /** The contract currently accepted and awaiting resolution, or `null`. */
  readonly activeContractId: ContractId | null;
  /** Contracts completed, in completion order (deduplicated). */
  readonly completedContractIds: readonly ContractId[];
}

/** Authoring input for {@link createCampaignProgress}; every field is optional. */
export interface CampaignProgressInit {
  readonly chapter?: number;
  readonly activeContractId?: ContractId | string | null;
  readonly completedContractIds?: readonly (ContractId | string)[];
}

/* --------------------------------------------------------------------------
 * History — the ordered campaign log
 * ------------------------------------------------------------------------ */

/** A day passed on the campaign calendar (T076). */
export interface CampaignDayAdvancedEntry {
  readonly kind: "day-advanced";
  /** Campaign day the advance was recorded on (the *new* day). */
  readonly day: number;
  /** How many days were advanced; a positive integer. */
  readonly days: number;
}

/** The company marched to a new region (T073). */
export interface CampaignRegionTravelledEntry {
  readonly kind: "region-travelled";
  readonly day: number;
  readonly regionId: RegionId;
}

/** A contract was accepted at the Officers' Mess (T070). */
export interface CampaignContractAcceptedEntry {
  readonly kind: "contract-accepted";
  readonly day: number;
  readonly contractId: ContractId;
}

/** A contract was completed (T070/T077). */
export interface CampaignContractCompletedEntry {
  readonly kind: "contract-completed";
  readonly day: number;
  readonly contractId: ContractId;
}

/** A campaign marker was placed into a map slot (T073). */
export interface CampaignMarkerPlacedEntry {
  readonly kind: "marker-placed";
  readonly day: number;
  readonly markerId: MapTokenId;
  readonly at: Coord;
}

/** A location was treasure-hunted (T073). */
export interface CampaignTreasureHuntedEntry {
  readonly kind: "treasure-hunted";
  readonly day: number;
  readonly at: Coord;
}

/** A party was sent away on a detachment contract (T072). */
export interface CampaignDetachmentSentEntry {
  readonly kind: "detachment-sent";
  readonly day: number;
  readonly dispatchId: DispatchId;
  readonly contractId: ContractId;
}

/**
 * One recorded campaign action. A discriminated union (per `agents.md` §9) so
 * the log is typed, JSON-safe and forward-compatible: closed set of handles,
 * validated payloads, never a bag of untyped JSON.
 */
export type CampaignHistoryEntry =
  | CampaignDayAdvancedEntry
  | CampaignRegionTravelledEntry
  | CampaignContractAcceptedEntry
  | CampaignContractCompletedEntry
  | CampaignMarkerPlacedEntry
  | CampaignTreasureHuntedEntry
  | CampaignDetachmentSentEntry;

/* --------------------------------------------------------------------------
 * The campaign save
 * ------------------------------------------------------------------------ */

/**
 * The complete, serialisable campaign sandbox. Treat as immutable; rebuild it
 * with {@link createCampaignSave} after a transition rather than editing it.
 */
export interface CampaignSave {
  /** Campaign payload format; see {@link CAMPAIGN_SAVE_VERSION}. */
  readonly version: number;
  /** Root campaign seed. Battles derive their own seed from it deterministically. */
  readonly seed: Seed;
  /** The free company: roster, Crowns, Honours and theatre (T068). */
  readonly company: Company;
  /** The Theatre map plus every placed marker (T073). */
  readonly map: CampaignMapState;
  /** The campaign clock and its dispatch timers (T076). */
  readonly calendar: CampaignCalendar;
  /** The quartermaster's reserve (T075). */
  readonly inventory: DepotInventory;
  /** Story chapter and the contract ledger (T070/T077). */
  readonly progress: CampaignProgress;
  /** The ordered campaign log (this module). */
  readonly history: readonly CampaignHistoryEntry[];
}

/** Authoring input for {@link createCampaignSave}; values are validated/normalised. */
export interface CampaignSaveInit {
  readonly seed: Seed;
  readonly company: Company | CompanyInit;
  readonly map: CampaignMapState | CampaignMapInit;
  readonly calendar: CampaignCalendar | CampaignCalendarInit;
  readonly inventory?: DepotInventory;
  readonly progress?: CampaignProgress | CampaignProgressInit;
  readonly history?: readonly CampaignHistoryEntry[];
}

/** Machine-readable cause for a {@link CampaignSaveError}. */
export type CampaignSaveErrorCode =
  | "corrupt"
  | "version"
  | "invalid-seed"
  | "invalid-company"
  | "invalid-map"
  | "invalid-calendar"
  | "invalid-inventory"
  | "invalid-progress"
  | "invalid-history";

/** Thrown when a campaign save cannot be built, serialised or parsed. */
export class CampaignSaveError extends Error {
  readonly code: CampaignSaveErrorCode;

  constructor(code: CampaignSaveErrorCode, message: string) {
    super(message);
    this.name = "CampaignSaveError";
    this.code = code;
  }
}

/* --------------------------------------------------------------------------
 * Validation internals
 * ------------------------------------------------------------------------ */

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Run a validator, tagging any failure with the section's error code. */
function section<T>(code: CampaignSaveErrorCode, label: string, build: () => T): T {
  try {
    return build();
  } catch (error) {
    if (error instanceof CampaignSaveError) throw error;
    throw new CampaignSaveError(code, `${label}: ${describe(error)}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validate and return a campaign seed (a finite number or non-empty string). */
function resolveSeed(value: unknown, label = "seed"): Seed {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new RangeError(`${label} must be a finite number, received ${String(value)}`);
    }
    return value;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RangeError(`${label} must be a non-empty string or a finite number`);
  }
  return value;
}

function assertCampaignDay(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new RangeError(`${label} must be an integer >= 1, received ${describe(value)}`);
  }
}

function assertPositiveInteger(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive integer, received ${describe(value)}`);
  }
}

function assertCoord(value: unknown, label: string): asserts value is Coord {
  if (!isRecord(value) || !Number.isInteger(value.x) || !Number.isInteger(value.y)) {
    throw new RangeError(`${label} must be integer coordinates`);
  }
}

/** Require an authored contract key, returning it as a branded id. */
function resolveContractId(value: unknown, label: string): ContractId {
  if (typeof value !== "string" || !isContractKey(value)) {
    throw new RangeError(`${label} is not an authored contract: ${describe(value)}`);
  }
  return value as ContractId;
}

/* --------------------------------------------------------------------------
 * Progress
 * ------------------------------------------------------------------------ */

/**
 * Validate and normalise a {@link CampaignProgress}. The chapter must be within
 * the authored spine, `activeContractId` must be `null` or an authored contract
 * key, and completed ids are deduplicated in first-completed order.
 *
 * @throws RangeError on a malformed chapter, contract id or field type.
 */
export function createCampaignProgress(init: CampaignProgressInit = {}): CampaignProgress {
  const chapter = init.chapter ?? 0;
  if (!Number.isInteger(chapter) || chapter < 0 || chapter > MAX_STORY_CHAPTER) {
    throw new RangeError(
      `progress.chapter must be an integer in [0, ${MAX_STORY_CHAPTER}], received ${String(chapter)}`,
    );
  }

  const rawActive = init.activeContractId ?? null;
  const activeContractId =
    rawActive === null ? null : resolveContractId(rawActive, "progress.activeContractId");

  const completedContractIds: ContractId[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < (init.completedContractIds?.length ?? 0); index++) {
    const contractId = resolveContractId(
      init.completedContractIds?.[index],
      `progress.completedContractIds[${index}]`,
    );
    if (seen.has(contractId)) continue;
    seen.add(contractId);
    completedContractIds.push(contractId);
  }

  return { chapter, activeContractId, completedContractIds };
}

/**
 * The {@link import("../data/story").StoryFacts} a campaign at `progress` and
 * `day` presents to the story spine. Pure; neither input is mutated.
 */
export function storyFactsOf(progress: CampaignProgress, day: number): StoryFacts {
  return { completedContractIds: progress.completedContractIds, day };
}

/* --------------------------------------------------------------------------
 * History
 * ------------------------------------------------------------------------ */

function normalizeHistoryEntry(value: unknown, index: number): CampaignHistoryEntry {
  const label = `history[${index}]`;
  if (!isRecord(value)) {
    throw new RangeError(`${label} must be an object`);
  }
  const day = value.day;
  assertCampaignDay(day, `${label}.day`);

  switch (value.kind) {
    case "day-advanced": {
      const days = resolvePositiveInteger(value.days, `${label}.days`);
      return { kind: "day-advanced", day, days };
    }
    case "region-travelled": {
      const regionId: RegionId = parseId<"region">(value.regionId, `${label}.regionId`);
      return { kind: "region-travelled", day, regionId };
    }
    case "contract-accepted": {
      const contractId = resolveContractId(value.contractId, `${label}.contractId`);
      return { kind: "contract-accepted", day, contractId };
    }
    case "contract-completed": {
      const contractId = resolveContractId(value.contractId, `${label}.contractId`);
      return { kind: "contract-completed", day, contractId };
    }
    case "marker-placed": {
      const markerId: MapTokenId = parseId<"mapToken">(value.markerId, `${label}.markerId`);
      const at = value.at;
      assertCoord(at, `${label}.at`);
      return { kind: "marker-placed", day, markerId, at: coord(at.x, at.y) };
    }
    case "treasure-hunted": {
      const at = value.at;
      assertCoord(at, `${label}.at`);
      return { kind: "treasure-hunted", day, at: coord(at.x, at.y) };
    }
    case "detachment-sent": {
      const dispatchId: DispatchId = parseId<"dispatch">(value.dispatchId, `${label}.dispatchId`);
      const contractId = resolveContractId(value.contractId, `${label}.contractId`);
      return { kind: "detachment-sent", day, dispatchId, contractId };
    }
    default:
      throw new RangeError(
        `${label}.kind is not a campaign action: ${describe(value.kind)} (expected one of ${CAMPAIGN_HISTORY_KINDS.join(", ")})`,
      );
  }
}

function resolvePositiveInteger(value: unknown, label: string): number {
  assertPositiveInteger(value, label);
  return value;
}

function normalizeHistory(value: readonly unknown[]): readonly CampaignHistoryEntry[] {
  return value.map((entry, index) => normalizeHistoryEntry(entry, index));
}

/* --------------------------------------------------------------------------
 * Creation & parsing
 * ------------------------------------------------------------------------ */

/**
 * Build and validate a {@link CampaignSave}. Every part is rebuilt through the
 * engine's own factories, so the result is canonical and safe to persist.
 *
 * ```ts
 * const save = createCampaignSave({ seed, company, map, calendar, inventory, progress, history });
 * ```
 *
 * @throws {@link CampaignSaveError} when any section is malformed.
 */
export function createCampaignSave(init: CampaignSaveInit): CampaignSave {
  const seed = section("invalid-seed", "campaignSave.seed", () => resolveSeed(init.seed));
  const company = section("invalid-company", "campaignSave.company", () =>
    parseCompany(init.company),
  );
  const map = section("invalid-map", "campaignSave.map", () => parseCampaignMap(init.map));
  const calendar = section("invalid-calendar", "campaignSave.calendar", () =>
    createCalendar(init.calendar),
  );
  const inventory = section("invalid-inventory", "campaignSave.inventory", () =>
    createDepotInventory(init.inventory ?? {}),
  );
  const progress = section("invalid-progress", "campaignSave.progress", () =>
    createCampaignProgress(init.progress ?? {}),
  );
  const history = section("invalid-history", "campaignSave.history", () =>
    normalizeHistory(init.history ?? []),
  );

  return {
    version: CAMPAIGN_SAVE_VERSION,
    seed,
    company,
    map,
    calendar,
    inventory,
    progress,
    history,
  };
}

/**
 * Validate an untrusted value (a slot payload, a JSON export) and return it as
 * a fresh {@link CampaignSave}. Rejects a record written by a *newer* format
 * ({@link CampaignSaveError} code `version`); older formats are accepted here
 * so T104 can migrate them.
 *
 * @throws {@link CampaignSaveError} when the shape is wrong.
 */
export function parseCampaignSave(value: unknown, label = "campaign save"): CampaignSave {
  if (!isRecord(value)) {
    throw new CampaignSaveError("corrupt", `${label} must be an object`);
  }

  const version = value.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new CampaignSaveError("version", `${label}.version must be a positive integer`);
  }
  if (version > CAMPAIGN_SAVE_VERSION) {
    throw new CampaignSaveError(
      "version",
      `${label} was written by format v${version}; this build reads up to v${CAMPAIGN_SAVE_VERSION}`,
    );
  }

  return createCampaignSave({
    seed: value.seed as Seed,
    company: value.company as CompanyInit,
    map: value.map as CampaignMapInit,
    calendar: value.calendar as CampaignCalendarInit,
    inventory: value.inventory as DepotInventory | undefined,
    progress: value.progress as CampaignProgressInit | undefined,
    history: value.history as readonly CampaignHistoryEntry[] | undefined,
  });
}

/** `true` when `value` round-trips through {@link parseCampaignSave}. */
export function isCampaignSave(value: unknown): value is CampaignSave {
  try {
    parseCampaignSave(value);
    return true;
  } catch {
    return false;
  }
}

/* --------------------------------------------------------------------------
 * Text round-trip (export / import, T102)
 * ------------------------------------------------------------------------ */

/**
 * Serialise a campaign to a **canonical** JSON string (object keys sorted), so
 * two equal campaigns always produce byte-identical text and a checksum can be
 * taken directly. Accepts an init and normalises it first.
 */
export function serializeCampaign(save: CampaignSave | CampaignSaveInit): string {
  return canonicalStringify(createCampaignSave(save as CampaignSaveInit));
}

/**
 * Parse a JSON string produced by {@link serializeCampaign} (or any equivalent
 * export) back into a validated {@link CampaignSave}.
 *
 * @throws {@link CampaignSaveError} code `corrupt` when the text is not JSON,
 *   or the relevant section code when the payload is malformed.
 */
export function deserializeCampaign(json: string, label = "campaign save"): CampaignSave {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    throw new CampaignSaveError("corrupt", `${label} is not valid JSON: ${describe(error)}`);
  }
  return parseCampaignSave(value, label);
}

/* --------------------------------------------------------------------------
 * SaveStore integration
 * ------------------------------------------------------------------------ */

/**
 * Write a campaign to a {@link SaveStore} slot. The snapshot is validated and
 * canonicalised first, so a bad controller state never reaches the backend.
 *
 * ```ts
 * await saveCampaign(store, "slot-1", { seed, company, map, calendar });
 * ```
 */
export async function saveCampaign(
  store: SaveStore,
  slot: string,
  save: CampaignSaveInit,
  options?: SaveOptions,
): Promise<SaveEnvelope<CampaignSave>> {
  const normalized = createCampaignSave(save);
  return store.save<CampaignSave>(slot, normalized, options);
}

/**
 * Read a campaign from a {@link SaveStore} slot, validating the payload. Returns
 * `null` when the slot is empty; throws {@link CampaignSaveError} on corrupt or
 * future-format data (and {@link import("./saveStore").SaveStoreError} on a
 * backend failure).
 */
export async function loadCampaign(store: SaveStore, slot: string): Promise<CampaignSave | null> {
  const envelope = await store.load<unknown>(slot);
  if (envelope === null) return null;
  return parseCampaignSave(envelope.data, `slot "${slot}"`);
}
