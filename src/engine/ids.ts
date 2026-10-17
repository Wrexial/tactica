/**
 * Branded identifier types for the deterministic engine (T012).
 *
 * The engine and the authored content (`src/data/`) both use plain,
 * JSON-serialisable **strings** as ids — that keeps saves, replays and event
 * logs trivial. The problem with bare strings is that nothing stops a
 * `PostId` being passed where an `AbilityId` is expected. We fix that with
 * **branded (nominal) types**: at runtime every id is still a string, but at
 * compile time each kind carries a phantom tag, so mixing ids is a type error.
 *
 * Contract (see `agents.md` §9):
 * - Ids are **branded strings**; the brand is compile-time only and costs
 *   nothing at runtime.
 * - {@link asUnitId} & friends cast/relabel an already-trusted string (data
 *   layer, fixtures). {@link parseId} / {@link assertId} validate untrusted
 *   input at the boundary (save files, network, JSON).
 * - {@link createIdGenerator} mints ids from a plain counter, never from
 *   `Math.random`, so generated ids are reproducible from a seed + call count.
 * - This module is pure: no DOM, no I/O, no randomness.
 *
 * The kinds follow the global naming dictionary in
 * `docs/NAPOLEONIC_MAPPING.md` §1: Post (job), Ability (action/reaction/
 * trait/volley), Contract (mission), Company (clan), Guard Sortie (Totema),
 * Equipment (kit), Article (law).
 */

/**
 * Phantom tag attached to a branded id. Declared as a `unique symbol` so the
 * brand cannot be forged structurally by an ordinary `{ __brand: "..." }`
 * object; it exists only in the type system and is erased at runtime.
 */
declare const idBrand: unique symbol;

/**
 * A `string` branded with a nominal `Kind`. Do not build these by hand — use
 * the `as…Id` constructors below so the intent is explicit at the call site.
 */
export type BrandedId<Kind extends string> = string & { readonly [idBrand]: Kind };

/** Every id namespace the engine knows about. Keeps generic helpers honest. */
export type IdKind =
  | "company"
  | "unit"
  | "post"
  | "skillset"
  | "ability"
  | "equipment"
  | "condition"
  | "article"
  | "contract"
  | "region"
  | "enemy"
  | "mapToken"
  | "guardSortie"
  | "generalOrder"
  | "aiProfile";

/** The player's free company / roster (FFTA "clan"). */
export type CompanyId = BrandedId<"company">;
/** A combatant — one specialist or small crew (FFTA "unit"). */
export type UnitId = BrandedId<"unit">;
/** A role/class (FFTA "job", mapping §3). */
export type PostId = BrandedId<"post">;
/** A skillset/kit that groups abilities (FFTA command). */
export type SkillsetId = BrandedId<"skillset">;
/** An action, reaction, trait or volley ability (mapping §6). */
export type AbilityId = BrandedId<"ability">;
/** A piece of kit — weapon, armour, accessory (schema key `itemId`). */
export type EquipmentId = BrandedId<"equipment">;
/** A status/condition (mapping §8). */
export type ConditionId = BrandedId<"condition">;
/** A daily standing order (FFTA "law", mapping §9). */
export type ArticleId = BrandedId<"article">;
/** An officers'-mess contract (FFTA "mission", mapping §10). */
export type ContractId = BrandedId<"contract">;
/** A campaign-map region, including lawless No-Man's Land. */
export type RegionId = BrandedId<"region">;
/** An irregular/auxiliary enemy definition (mapping §11). */
export type EnemyId = BrandedId<"enemy">;
/** A placeable campaign-map token (FFTA "area token"). */
export type MapTokenId = BrandedId<"mapToken">;
/** A power's Guard Sortie (FFTA "Totema", mapping §4). */
export type GuardSortieId = BrandedId<"guardSortie">;
/** A company privilege (FFTA "Advanced Law", mapping §9). */
export type GeneralOrderId = BrandedId<"generalOrder">;
/** A key into the AI profiles in `src/ai` (T095). */
export type AiProfileId = BrandedId<"aiProfile">;

/** Any branded id, regardless of kind. Useful for generic containers. */
export type AnyId = BrandedId<IdKind>;

/* --------------------------------------------------------------------------
 * Trusted casts (data layer / fixtures)
 * ------------------------------------------------------------------------ */

/**
 * Relabel a string as a branded id of the given kind.
 *
 * This performs **no validation** — it is the escape hatch for trusted data
 * (authored content, test fixtures). Use {@link parseId} for input that could
 * be malformed.
 */
export function asId<Kind extends IdKind>(value: string): BrandedId<Kind> {
  return value as BrandedId<Kind>;
}

/** Trusted cast to a {@link CompanyId}. See {@link asId}. */
export const asCompanyId = (value: string): CompanyId => asId<"company">(value);
/** Trusted cast to a {@link UnitId}. See {@link asId}. */
export const asUnitId = (value: string): UnitId => asId<"unit">(value);
/** Trusted cast to a {@link PostId}. See {@link asId}. */
export const asPostId = (value: string): PostId => asId<"post">(value);
/** Trusted cast to a {@link SkillsetId}. See {@link asId}. */
export const asSkillsetId = (value: string): SkillsetId => asId<"skillset">(value);
/** Trusted cast to an {@link AbilityId}. See {@link asId}. */
export const asAbilityId = (value: string): AbilityId => asId<"ability">(value);
/** Trusted cast to an {@link EquipmentId}. See {@link asId}. */
export const asEquipmentId = (value: string): EquipmentId => asId<"equipment">(value);
/** Trusted cast to a {@link ConditionId}. See {@link asId}. */
export const asConditionId = (value: string): ConditionId => asId<"condition">(value);
/** Trusted cast to an {@link ArticleId}. See {@link asId}. */
export const asArticleId = (value: string): ArticleId => asId<"article">(value);
/** Trusted cast to a {@link ContractId}. See {@link asId}. */
export const asContractId = (value: string): ContractId => asId<"contract">(value);
/** Trusted cast to a {@link RegionId}. See {@link asId}. */
export const asRegionId = (value: string): RegionId => asId<"region">(value);
/** Trusted cast to an {@link EnemyId}. See {@link asId}. */
export const asEnemyId = (value: string): EnemyId => asId<"enemy">(value);
/** Trusted cast to a {@link MapTokenId}. See {@link asId}. */
export const asMapTokenId = (value: string): MapTokenId => asId<"mapToken">(value);
/** Trusted cast to a {@link GuardSortieId}. See {@link asId}. */
export const asGuardSortieId = (value: string): GuardSortieId => asId<"guardSortie">(value);
/** Trusted cast to a {@link GeneralOrderId}. See {@link asId}. */
export const asGeneralOrderId = (value: string): GeneralOrderId => asId<"generalOrder">(value);
/** Trusted cast to an {@link AiProfileId}. See {@link asId}. */
export const asAiProfileId = (value: string): AiProfileId => asId<"aiProfile">(value);

/* --------------------------------------------------------------------------
 * Runtime validation (save files / network / JSON boundaries)
 * ------------------------------------------------------------------------ */

/** Error thrown when a value fails id validation. */
export class IdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdError";
  }
}

/**
 * Type guard: `true` when `value` is a string that is non-empty once trimmed.
 * Rejects `null`, numbers, `""` and whitespace-only strings.
 */
export function isValidId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Assert that `value` is a valid id, narrowing it to `string`. Throws
 * {@link IdError} otherwise. `label` is included in the message so callers
 * can point at the offending field.
 */
export function assertId(value: unknown, label = "id"): asserts value is string {
  if (!isValidId(value)) {
    throw new IdError(`${label} must be a non-empty string, received ${describe(value)}`);
  }
}

/**
 * Validate untrusted input and return it as a branded id.
 *
 * ```ts
 * const id = parseId<"unit">(save.leaderId, "leaderId");
 * ```
 */
export function parseId<Kind extends IdKind>(value: unknown, label = "id"): BrandedId<Kind> {
  assertId(value, label);
  return value as BrandedId<Kind>;
}

/** Compact, human-readable description of a rejected value for error messages. */
function describe(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "object") return "an object";
  return String(value);
}

/* --------------------------------------------------------------------------
 * Deterministic id generation
 * ------------------------------------------------------------------------ */

/**
 * A counter-based id factory. `next()` returns `"<prefix>-<n>"` with `n`
 * starting at 1 (or `startAt + 1`). Because it is a plain integer counter it is
 * fully deterministic and reproducible — unlike `Math.random`, which the engine
 * forbids.
 */
export interface IdGenerator<Kind extends IdKind> {
  /** Stable prefix every generated id starts with (e.g. `"unit"`). */
  readonly prefix: string;
  /** How many ids have been issued so far. */
  readonly issued: number;
  /** Mint the next id. Advances {@link issued} by one. */
  next(): BrandedId<Kind>;
}

/**
 * Create a new {@link IdGenerator} for one id kind.
 *
 * ```ts
 * const unitIds = createIdGenerator<"unit">("unit");
 * unitIds.next(); // "unit-1"
 * unitIds.next(); // "unit-2"
 * ```
 *
 * `startAt` lets a resumed save continue a sequence without collisions.
 */
export function createIdGenerator<Kind extends IdKind>(
  prefix: string,
  startAt = 0,
): IdGenerator<Kind> {
  if (!isValidId(prefix)) {
    throw new IdError("prefix must be a non-empty string");
  }
  if (!Number.isInteger(startAt) || startAt < 0) {
    throw new IdError(`startAt must be a non-negative integer, received ${String(startAt)}`);
  }

  let issued = startAt;
  return {
    prefix,
    get issued(): number {
      return issued;
    },
    next(): BrandedId<Kind> {
      issued += 1;
      return `${prefix}-${issued}` as BrandedId<Kind>;
    },
  };
}
