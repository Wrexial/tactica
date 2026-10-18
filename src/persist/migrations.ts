/**
 * Save migrations (T104) — carry an **older** persisted payload forward to the
 * format this build understands, one version at a time, in order, and
 * deterministically.
 *
 * A save is a contract with the future (`agents.md` §2, §7). T100's
 * {@link import("./saveStore").SaveStore} already refuses to *guess* at a
 * newer record, and T101's {@link import("./campaign").CampaignSave} validates
 * every field it reads; what was missing was the middle ground — a **v(N) file
 * opened by a v(N+k) build**. This module is that bridge:
 *
 * ```
 *   untrusted payload ─► read `version` ─► run migrations N → N+1 → … → target
 *                                        ─► parsed/validated by the family
 * ```
 *
 * ## Two ways to describe a format
 *
 * There are two independent version streams in persistence:
 *
 * - the **envelope** version ({@link SAVE_FORMAT_VERSION}), the shape of the
 *   record the {@link SaveStore} writes around the payload; and
 * - the **payload** version, owned by its family — e.g.
 *   {@link CAMPAIGN_SAVE_VERSION} for a campaign.
 *
 * Each stream is a {@link MigrationTable}: an ordered list of
 * {@link Migration} steps, each moving exactly one version forward. Tables are
 * built with {@link defineMigrations}, which rejects gaps, duplicates and
 * non-sequential jumps at construction time so a bad table fails loudly in
 * tests rather than silently at load.
 *
 * ## Contract (`agents.md` §2, §3, §7, §9)
 *
 * - **Pure & deterministic.** A migration is a plain function from one
 *   JSON-safe object to the next. No clock, no randomness, no I/O, no engine
 *   imports — only {@link import("./campaign").parseCampaignSave} and the
 *   version constants are consulted, one direction (`migrations` → `campaign`).
 * - **Forward only, never backward.** There is exactly one file shape per
 *   version; older builds refuse newer files rather than fabricate a shape they
 *   no longer know ({@link SaveMigrationError} code `newer-version`).
 * - **Fail loud, fail closed.** A corrupt, gapped or unknown record throws a
 *   {@link SaveMigrationError}; a caller can fall back to "start a new company"
 *   without ever trusting half-migrated bytes.
 * - **Never silent.** {@link MigrationResult.applied} records exactly which
 *   steps ran, so a load path can surface "this save was upgraded from v1".
 *
 * The tables ship **empty** while every family is at its baseline version
 * (campaign v1, envelope v1). Each time a persisted shape changes, bump the
 * family's constant and append one {@link Migration} step here; nothing else
 * about a load path has to change.
 *
 * This is original engineering for *Lines of Glory*; no FFTA save data was
 * copied (mapping §3).
 */

import {
  CAMPAIGN_SAVE_VERSION,
  CampaignSaveError,
  parseCampaignSave,
  type CampaignSave,
} from "./campaign";
import { SAVE_FORMAT_VERSION, type SaveEnvelope, type SaveStore } from "./saveStore";

/* --------------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------------ */

/**
 * The JSON-safe object shape a migration operates on. A save is an object with
 * (at least) a numeric `version`; migrations may add, rename or drop fields but
 * must return another object.
 */
export type PersistedPayload = Record<string, unknown>;

/**
 * One forward migration: the transform that turns a payload at version
 * {@link from} into the same payload at version {@link to}. By convention
 * `to === from + 1`, which {@link defineMigrations} enforces.
 */
export interface Migration {
  /** Version this step reads. */
  readonly from: number;
  /** Version this step writes; always `from + 1`. */
  readonly to: number;
  /** Short human explanation, surfaced in logs and the upgrade ledger. */
  readonly summary: string;
  /** Transform the payload. Must be pure and return an object. */
  migrate(payload: PersistedPayload): PersistedPayload;
}

/** An ordered list of forward migrations for one version stream. */
export type MigrationTable = readonly Migration[];

/** Machine-readable cause for a {@link SaveMigrationError}. */
export type SaveMigrationErrorCode = "corrupt" | "newer-version" | "no-migration";

/** Thrown when a payload cannot be carried forward to the target version. */
export class SaveMigrationError extends Error {
  readonly code: SaveMigrationErrorCode;

  constructor(code: SaveMigrationErrorCode, message: string) {
    super(message);
    this.name = "SaveMigrationError";
    this.code = code;
  }
}

/** Options for {@link applyMigrations}. */
export interface ApplyMigrationsOptions {
  /** The ordered migration table for this version stream. */
  readonly table: MigrationTable;
  /** Version the payload should end up at (the build's current version). */
  readonly target: number;
  /** Label used in error messages, e.g. `campaign save` or `slot "alpha"`. */
  readonly label?: string;
}

/** The outcome of running a payload through {@link applyMigrations}. */
export interface MigrationResult {
  /** The migrated payload (identical to the input when no step ran). */
  readonly payload: PersistedPayload;
  /** Version the payload was read at. */
  readonly fromVersion: number;
  /** Version the payload now carries (always `target`). */
  readonly toVersion: number;
  /** The steps that ran, in order; empty when already current. */
  readonly applied: readonly Migration[];
  /** Whether any step ran. */
  readonly migrated: boolean;
}

/* --------------------------------------------------------------------------
 * Table authoring
 * ------------------------------------------------------------------------ */

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A version must be a positive integer; shared by tables and payload reads. */
function assertVersion(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive integer, received ${describe(value)}`);
  }
}

/**
 * Validate and freeze a migration table. Every step must advance exactly one
 * version (`to === from + 1`), versions must be unique, and the steps must
 * cover a contiguous range with no gaps. Building a table through this helper
 * makes those mistakes impossible to ship.
 *
 * @param family Human name for the version stream, used in error messages.
 * @param steps  The steps, in any order.
 * @throws RangeError when the table is malformed.
 */
export function defineMigrations(family: string, steps: MigrationTable): MigrationTable {
  const sorted = [...steps].sort((a, b) => a.from - b.from);
  const seen = new Set<number>();
  for (let index = 0; index < sorted.length; index++) {
    const step = sorted[index]!;
    assertVersion(step.from, `${family} migration from`);
    assertVersion(step.to, `${family} migration to`);
    if (step.to !== step.from + 1) {
      throw new RangeError(
        `${family} migration v${step.from} must advance exactly one version, got v${step.to}`,
      );
    }
    if (seen.has(step.from)) {
      throw new RangeError(`${family} has more than one migration from v${step.from}`);
    }
    seen.add(step.from);
    const previous = sorted[index - 1];
    if (previous !== undefined && step.from !== previous.to) {
      throw new RangeError(
        `${family} migrations jump from v${previous.to} to v${step.from}; every version needs a step`,
      );
    }
  }
  return Object.freeze(sorted.map((step) => Object.freeze(step)));
}

/* --------------------------------------------------------------------------
 * Running migrations
 * ------------------------------------------------------------------------ */

function isPayload(value: unknown): value is PersistedPayload {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read and validate the version a payload was written at. Accepts the `version`
 * field directly.
 *
 * @throws RangeError when the field is missing or not a positive integer.
 */
export function readPayloadVersion(payload: unknown, label = "save"): number {
  if (!isPayload(payload)) {
    throw new RangeError(`${label} must be an object`);
  }
  assertVersion(payload.version, `${label}.version`);
  return payload.version;
}

/**
 * Carry `value` forward from its own `version` to `options.target`, applying
 * the matching steps in order. The input is never mutated; each step receives
 * the previous step's output and the engine stamps the step's `to` version
 * onto the result, so a migration cannot fail to bump the counter.
 *
 * @throws {@link SaveMigrationError} when the record is corrupt, newer than
 *   the target, or no path through the table exists.
 */
export function applyMigrations(value: unknown, options: ApplyMigrationsOptions): MigrationResult {
  const label = options.label ?? "save";
  if (!isPayload(value)) {
    throw new SaveMigrationError("corrupt", `${label} is not a JSON object`);
  }

  let fromVersion: number;
  try {
    fromVersion = readPayloadVersion(value, label);
  } catch (error) {
    throw new SaveMigrationError("corrupt", describe(error));
  }

  let target: number;
  try {
    assertVersion(options.target, "target version");
    target = options.target;
  } catch (error) {
    throw new SaveMigrationError("corrupt", describe(error));
  }

  if (fromVersion > target) {
    throw new SaveMigrationError(
      "newer-version",
      `${label} was written by format v${fromVersion}; this build migrates up to v${target}`,
    );
  }

  let payload: PersistedPayload = value;
  let version = fromVersion;
  const applied: Migration[] = [];

  while (version < target) {
    const step = options.table.find((candidate) => candidate.from === version);
    if (step === undefined) {
      throw new SaveMigrationError(
        "no-migration",
        `${label} is at v${version} but no migration to v${version + 1} is registered`,
      );
    }
    const next = step.migrate(payload);
    if (!isPayload(next)) {
      throw new SaveMigrationError(
        "corrupt",
        `migration v${step.from}→v${step.to} (${step.summary}) did not return an object`,
      );
    }
    payload = { ...next, version: step.to };
    applied.push(step);
    version = step.to;
  }

  return {
    payload,
    fromVersion,
    toVersion: version,
    applied,
    migrated: applied.length > 0,
  };
}

/* --------------------------------------------------------------------------
 * The registered tables
 * ------------------------------------------------------------------------ */

/**
 * Envelope-format migrations, keyed to {@link SAVE_FORMAT_VERSION}. Empty at
 * v1: the first time the record wrapped around `data` changes shape, append a
 * step here.
 */
export const SAVE_ENVELOPE_MIGRATIONS: MigrationTable = defineMigrations("save envelope", []);

/**
 * Campaign-payload migrations, keyed to {@link CAMPAIGN_SAVE_VERSION}. Empty at
 * v1 (the baseline authored in T101): append a step here whenever the campaign
 * shape changes, and bump {@link CAMPAIGN_SAVE_VERSION} to match.
 */
export const CAMPAIGN_MIGRATIONS: MigrationTable = defineMigrations("campaign save", []);

/* --------------------------------------------------------------------------
 * Family-specific entry points
 * ------------------------------------------------------------------------ */

/**
 * Migrate an untrusted campaign payload to the current
 * {@link CAMPAIGN_SAVE_VERSION}. Returns the payload for the caller to validate
 * with {@link import("./campaign").parseCampaignSave}; at v1 this is an identity
 * (on a well-formed record) because {@link CAMPAIGN_MIGRATIONS} is empty.
 *
 * @throws {@link SaveMigrationError} when the payload is corrupt, from a newer
 *   format, or cannot reach the current version.
 */
export function migrateCampaignPayload(value: unknown, label = "campaign save"): PersistedPayload {
  return applyMigrations(value, {
    table: CAMPAIGN_MIGRATIONS,
    target: CAMPAIGN_SAVE_VERSION,
    label,
  }).payload;
}

/**
 * Migrate a save envelope to the current {@link SAVE_FORMAT_VERSION}. The
 * payload's inner `data` is untouched here — its own family migration runs when
 * the data is parsed.
 */
export function migrateSaveEnvelope(envelope: SaveEnvelope<unknown>): SaveEnvelope<unknown> {
  const { payload, toVersion } = applyMigrations(envelope, {
    table: SAVE_ENVELOPE_MIGRATIONS,
    target: SAVE_FORMAT_VERSION,
    label: "save envelope",
  });
  return {
    version: toVersion,
    savedAt: (payload.savedAt as number) ?? envelope.savedAt,
    label: (payload.label as string) ?? envelope.label,
    data: payload.data,
  };
}

/**
 * Load a campaign from a {@link SaveStore} slot, migrating older payloads
 * forward before validation. The migration-aware counterpart to
 * {@link import("./campaign").loadCampaign}: returns `null` for an empty slot,
 * throws {@link SaveMigrationError} for a payload that cannot be carried
 * forward, and {@link import("./campaign").CampaignSaveError} for one that is
 * malformed after migration.
 */
export async function loadCampaignMigrated(
  store: SaveStore,
  slot: string,
): Promise<CampaignSave | null> {
  const envelope = await store.load<unknown>(slot);
  if (envelope === null) return null;
  const label = `slot "${slot}"`;
  return parseCampaignSave(migrateCampaignPayload(envelope.data, label), label);
}

/**
 * Parse campaign JSON (an export, a paste, a file) and migrate it forward
 * before validation. The migration-aware counterpart to
 * {@link import("./campaign").deserializeCampaign}.
 */
export function deserializeCampaignMigrated(json: string, label = "campaign save"): CampaignSave {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    throw new CampaignSaveError("corrupt", `${label} is not valid JSON: ${describe(error)}`);
  }
  return parseCampaignSave(migrateCampaignPayload(value, label), label);
}
