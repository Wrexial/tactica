/**
 * Auxiliary Barracks (T078) — the company's holding pens for **captured and
 * cajoled irregulars**, and the **Foreign Drill** seam that copies enemy
 * actions (mapping §10, §11).
 *
 * FFTA's Monster Bank is the model
 * (`docs/wiki/pages/Monster_Bank.md`): a **Hunter** *captures* a monster in
 * battle, the beast is deposited in the bank, and a **Morpher** raises it —
 * feeding it to build **Affection** — before it can fight for the clan. The
 * retheme turns that whole loop into **auxiliary irregulars** (mapping §11):
 * captured bands are held in the **Auxiliary Barracks**, *cajoled* into
 * service, and then *deployed* alongside the company. The Blue Mage's **Blue
 * Magic** — learning an action from the enemy that uses it — becomes
 * **Foreign Drill** (mapping §11), the seam that lets an Intelligence Officer
 * copy an irregular's trick.
 *
 * ```
 *   captureIrregular / attemptCapture   ── irregular band → Captive (willingness 0)
 *                    │
 *   cajoleIrregular  ── raises willingness toward CAJOLE_MAX (FFTA Affection)
 *                    │
 *   deployIrregular / deployParty ── a willing Captive → a fielded Unit
 *
 *   learnFromEnemy   ── enemy action + Foreign Drill → a mastered LearnedAbility
 * ```
 *
 * ## What this module owns
 *
 * - {@link IrregularDef} — the slim, engine-facing projection of an authored
 *   `EnemyDef` (`src/data/schema.ts`): the identity, level, stat block, enemy
 *   actions and `capturable` flag the barracks actually needs. T091 authors the
 *   full enemy roster; {@link irregularDefOf} projects it.
 * - {@link Captive} — one held irregular: its {@link IrregularDef}, a field
 *   name, the campaign day it was taken and its **willingness** (FFTA
 *   Affection) in `[0, {@link CAJOLE_MAX}]`.
 * - {@link AuxiliaryBarracks} — the pen itself, a plain serialisable value with
 *   a generous capacity ({@link BARRACKS_CAPACITY}).
 * - The **capture** loop ({@link captureBlockers}, {@link canCapture},
 *   {@link captureIrregular}, {@link captureChance}, {@link attemptCapture}),
 *   the **cajole** loop ({@link cajoleBlockers}, {@link cajoleIrregular}) and
 *   the **deploy** loop ({@link deployBlockers}, {@link deployIrregular},
 *   {@link deployParty}).
 * - **Foreign Drill** ({@link foreignDrillBlockers},
 *   {@link learnFromEnemy}) — the trait-aware bridge from an enemy action the
 *   soldier has seen to a mastered {@link LearnedAbility} (T048).
 *
 * ## Contract (`agents.md` §2, §3, §7, §9)
 *
 * - **Engine purity & determinism** — framework-free, DOM-free TypeScript with
 *   no `Math.random` and no `Date`. Capture odds, when they are rolled at all,
 *   come from the seeded {@link Rng} passed by the caller, so a capture
 *   resolves identically on every platform.
 * - **State in, state out** — nothing is mutated; every helper returns a
 *   **new** barracks, captive or unit. Structural sharing is fine.
 * - **Data-driven** — the authored irregular roster (T091) supplies the stats
 *   and enemy actions; only the *policy* (capacity, cajole amounts, deploy
 *   requirement, capture odds) lives here as named tunables for the Phase 13
 *   balance pass.
 * - **Trust boundary** — {@link createBarracks} and {@link parseBarracks}
 *   validate every field, so a bad fixture or save fails loudly rather than
 *   fielding an impossible auxiliary.
 * - **Trait-aware, not trait-coupled** — Foreign Drill defers to the support
 *   trait engine (`src/engine/traits.ts`) via `learnsAbility`, so the "maybe
 *   learn" rule is authored in one place (mapping §6).
 *
 * Reference: mapping §10 (Monster Bank → Auxiliary Barracks), §11 ("Blue Magic
 * → Foreign Drill: learn actions from enemy troops you fight"; "Monster Bank →
 * Auxiliary Barracks: deploy captured/cajoled irregular bands") and
 * `docs/wiki/pages/Monster_Bank.md`. This is original fiction inspired by the
 * Napoleonic Wars, not a port of FFTA's bank data.
 */

import { ELEMENT_KEYS, type ElementKey, type EnemyDef, type PowerKey, type StatBlock } from "../data/schema";
import { CAMPAIGN_DAY_MIN } from "./company";
import { coord, isFacing, type Coord, type Facing } from "./grid";
import {
  asAbilityId,
  asEnemyId,
  asPostId,
  assertId,
  type AbilityId,
  type EnemyId,
  type UnitId,
} from "./ids";
import { Rng } from "./rng";
import { learnsAbility, makeTraitContext, type TraitOptions } from "./traits";
import { createUnit, isPowerKey, learnAbility, type Unit, type UnitSide } from "./unit";

/* --------------------------------------------------------------------------
 * Tunables (Phase 13 owns the final balance pass)
 * ------------------------------------------------------------------------ */

/**
 * How many irregulars the Auxiliary Barracks may hold. FFTA's bank is
 * effectively unbounded, but a cap keeps a corrupt save from growing without
 * end and gives the UI a finite list; it is deliberately generous.
 */
export const BARRACKS_CAPACITY = 30;

/**
 * Lowest **willingness** a captive can have (FFTA Affection `0` — it bites the
 * hand that feeds it). A freshly captured band starts here.
 */
export const CAJOLE_MIN = 0;

/**
 * Highest **willingness** a captive can reach (FFTA Affection `100` — it will
 * follow you anywhere). Willingness is clamped into this band.
 */
export const CAJOLE_MAX = 100;

/**
 * Willingness gained by one cajole. Four rounds of persuasion carry a band from
 * hostile to devoted; T078's `Partisan`/`Impersonator` flavour can later scale
 * it, but the flat step keeps the loop legible.
 */
export const CAJOLE_STEP = 25;

/**
 * Willingness a captive needs before {@link canDeploy} allows it onto the
 * field. Above the first cajole, so "cajole then deploy" is always two distinct
 * steps.
 */
export const CAJOLE_DEPLOY_MIN = 50;

/**
 * Most auxiliaries that may be fielded in one action. FFTA lets a clan bring a
 * small escort of banked monsters; three keeps the detachment scale (mapping §0)
 * and stops auxiliaries from outnumbering the company.
 */
export const DEPLOY_MAX = 3;

/**
 * Base success chance of {@link attemptCapture} against a full-strength band,
 * as a fraction in `[0, 1]`. Re-authored balance; the scraped wiki does not
 * document FFTA's Hunter capture rate.
 */
export const CAPTURE_BASE_CHANCE = 0.5;

/**
 * Help a weakened band gives a would-be captor: a band reduced to or below
 * {@link CAPTURE_WEAK_HP_FRACTION} of its hit points is easier to run down.
 */
export const CAPTURE_WEAK_HP_FRACTION = 0.25;

/** Added to {@link CAPTURE_BASE_CHANCE} when the target is weakened. */
export const CAPTURE_WEAK_BONUS = 0.35;

/**
 * Subtracted from the capture chance for each level the band has above 1. A
 * veteran band is harder to run down than a green one.
 */
export const CAPTURE_LEVEL_PENALTY = 0.05;

/** Capture is never hopeless; this floors the chance. */
export const CAPTURE_MIN_CHANCE = 0.05;

/** Ceiling for a capture roll (a weakened band still can always be taken). */
export const CAPTURE_MAX_CHANCE = 0.95;

/**
 * Synthetic post id for a fielded auxiliary. An irregular has no authored
 * **post** (FFTA job); the battlefield {@link Unit} still needs a stable
 * `postId`, so auxiliaries carry this one. It is deliberately not a key in
 * `src/data/posts`, so an auxiliary can never be mistaken for a recruitable
 * soldier or added to the roster.
 */
export const AUXILIARY_POST_ID = asPostId("auxiliary");

/**
 * Power (military school) an irregular is treated as for depot discounts and
 * ability legality when none is authored. France is FFTA's versatile Hume
 * school (mapping §2), the natural neutral. An authored enemy may override it
 * through {@link IrregularDefInit.power}.
 */
export const DEFAULT_IRREGULAR_POWER: PowerKey = "france";

/* --------------------------------------------------------------------------
 * Irregulars (the engine-facing projection of an EnemyDef)
 * ------------------------------------------------------------------------ */

/**
 * The slim projection of an authored `EnemyDef` (`src/data/schema.ts`) that the
 * barracks needs: the band's identity, level, stat block, the enemy actions it
 * fights with (for Foreign Drill) and whether it may be captured at all. The
 * full enemy definition — drops, affinities, AI profile — stays in `src/data/`.
 */
export interface IrregularDef {
  /** The authored enemy id this band was projected from (mapping §11). */
  readonly id: EnemyId;
  /** Player-facing band name (the fiction layer). */
  readonly name: string;
  /** The band's level, used when it is fielded and for capture odds. */
  readonly level: number;
  /** Base stat block at that level, used verbatim when deployed. */
  readonly stats: StatBlock;
  /** The enemy actions the band knows (candidates for Foreign Drill). */
  readonly abilities: readonly AbilityId[];
  /** Innate elemental cause, preserved for later attack resolution. */
  readonly element?: ElementKey;
  /**
   * The military school the band is treated as for gear and legality. Not all
   * irregulars owe allegiance to a great power; authoring one keeps the rules
   * predictable. Defaults to {@link DEFAULT_IRREGULAR_POWER}.
   */
  readonly power: PowerKey;
  /** Whether FFTA's Hunters may take this band prisoner. */
  readonly capturable: boolean;
}

/** Authoring input for {@link createIrregularDef}; `abilities`, `element`, `power` and `capturable` are optional. */
export interface IrregularDefInit {
  readonly id: EnemyId;
  readonly name: string;
  readonly level: number;
  readonly stats: StatBlock;
  readonly abilities?: readonly AbilityId[];
  readonly element?: ElementKey;
  readonly power?: PowerKey;
  readonly capturable?: boolean;
}

/* --------------------------------------------------------------------------
 * Captives
 * ------------------------------------------------------------------------ */

/**
 * One irregular held in the barracks: its {@link IrregularDef} plus the
 * campaign metadata that makes it an individual — a field name, the day it was
 * taken and its **willingness** toward the company (FFTA Affection).
 */
export interface Captive {
  /** Stable identity; also the final unit id when it is deployed. */
  readonly id: UnitId;
  /** The band's authored definition. */
  readonly irregular: IrregularDef;
  /** Player-facing name used when fielded (defaults to the band name). */
  readonly name: string;
  /** Campaign day the band was captured (for senescence and fiction). */
  readonly capturedOnDay: number;
  /** FFTA Affection: how willingly the band serves, in `[0, CAJOLE_MAX]`. */
  readonly willingness: number;
}

/** Authoring input for {@link createCaptive}. */
export interface CaptiveInit {
  readonly id: UnitId;
  readonly irregular: IrregularDefInit | IrregularDef;
  readonly name?: string;
  readonly capturedOnDay?: number;
  readonly willingness?: number;
}

/* --------------------------------------------------------------------------
 * The barracks
 * ------------------------------------------------------------------------ */

/**
 * The **Auxiliary Barracks** (FFTA Monster Bank): the camp pen holding every
 * irregular the company has captured and not yet dismissed. Treat as immutable
 * — use the helpers below rather than mutating `captives`.
 */
export interface AuxiliaryBarracks {
  /** The held irregulars, in acquisition order. */
  readonly captives: readonly Captive[];
}

/** Authoring input for {@link createBarracks}; an empty pen is the default. */
export interface AuxiliaryBarracksInit {
  readonly captives?: readonly CaptiveInit[];
}

/** Thrown when an untrusted value is not a well-formed barracks (`parseBarracks`). */
export class BarracksError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BarracksError";
  }
}

/* --------------------------------------------------------------------------
 * Validation helpers (fail fast at the data/save boundary)
 * ------------------------------------------------------------------------ */

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RangeError(`${label} must be a non-empty string`);
  }
}

function assertIntegerAtLeast(value: number, min: number, label: string): void {
  if (!Number.isInteger(value) || value < min) {
    throw new RangeError(`${label} must be an integer >= ${min}, received ${String(value)}`);
  }
}

/** The nine stat columns every {@link StatBlock} must carry, in a stable order. */
const STAT_KEYS: readonly (keyof StatBlock)[] = [
  "hp",
  "mp",
  "atk",
  "def",
  "mag",
  "res",
  "spd",
  "move",
  "jump",
];

function assertStatBlock(stats: StatBlock, label: string): void {
  for (const key of STAT_KEYS) {
    assertIntegerAtLeast(stats[key], 0, `${label}.${key}`);
  }
  if (stats.hp < 1) {
    throw new RangeError(`${label}.hp must be >= 1, received ${String(stats.hp)}`);
  }
}

function assertElement(value: unknown, label: string): asserts value is ElementKey {
  if (typeof value !== "string" || !(ELEMENT_KEYS as readonly string[]).includes(value)) {
    throw new RangeError(
      `${label} must be one of ${ELEMENT_KEYS.join(", ")}, received ${String(value)}`,
    );
  }
}

/**
 * Validate and normalise an irregular band. Every field that reaches a stat
 * block or a unit id is checked here, so a malformed enemy definition fails at
 * projection time rather than on the battlefield.
 */
export function createIrregularDef(init: IrregularDefInit): IrregularDef {
  assertId(init.id, "irregular.id");
  assertNonEmptyString(init.name, "irregular.name");
  assertIntegerAtLeast(init.level, 1, "irregular.level");
  assertStatBlock(init.stats, "irregular.stats");

  const abilities: AbilityId[] = [];
  const seenAbilities = new Set<string>();
  const suppliedAbilities = init.abilities ?? [];
  for (let index = 0; index < suppliedAbilities.length; index++) {
    const abilityId = suppliedAbilities[index] as AbilityId;
    assertId(abilityId, `irregular.abilities[${index}]`);
    if (seenAbilities.has(abilityId)) continue;
    seenAbilities.add(abilityId);
    abilities.push(abilityId);
  }

  if (init.element !== undefined) assertElement(init.element, "irregular.element");
  const power = init.power ?? DEFAULT_IRREGULAR_POWER;
  if (!isPowerKey(power)) {
    throw new RangeError(
      `irregular.power must be a great-power school, received ${String(power)}`,
    );
  }
  const capturable = init.capturable ?? false;
  if (typeof capturable !== "boolean") {
    throw new RangeError("irregular.capturable must be a boolean");
  }

  return {
    id: init.id,
    name: init.name,
    level: init.level,
    stats: { ...init.stats },
    abilities,
    ...(init.element !== undefined ? { element: init.element } : {}),
    power,
    capturable,
  };
}

/**
 * Project an authored `EnemyDef` (T091) down to the engine-facing
 * {@link IrregularDef}. Ids are branded at this boundary and the `abilities`
 * list is copied so the barracks never aliases authored data.
 */
export function irregularDefOf(enemy: EnemyDef): IrregularDef {
  return createIrregularDef({
    id: asEnemyId(enemy.id),
    name: enemy.name,
    level: enemy.level,
    stats: enemy.stats,
    abilities: enemy.abilities.map((abilityId) => asAbilityId(abilityId)),
    element: enemy.element,
    capturable: enemy.capturable,
  });
}

/** `true` when `value` is a structurally valid {@link IrregularDef}. */
export function isIrregularDef(value: unknown): value is IrregularDef {
  try {
    createIrregularDef(value as IrregularDefInit);
    return true;
  } catch {
    return false;
  }
}

/* --------------------------------------------------------------------------
 * Captives
 * ------------------------------------------------------------------------ */

/**
 * Validate and normalise one captive. The {@link IrregularDef} is rebuilt
 * through {@link createIrregularDef} (accepting either a raw init or a full
 * def), the name defaults to the band's own name, the day defaults to
 * `defaultDay`, and willingness defaults to {@link CAJOLE_MIN}.
 *
 * @throws RangeError when the id, the irregular, the day or the willingness is
 *   malformed.
 */
export function createCaptive(
  init: CaptiveInit,
  defaultDay: number = CAMPAIGN_DAY_MIN,
): Captive {
  assertIntegerAtLeast(defaultDay, CAMPAIGN_DAY_MIN, "defaultDay");
  assertId(init.id, "captive.id");

  const irregular = createIrregularDef(init.irregular);
  const name = init.name ?? irregular.name;
  assertNonEmptyString(name, "captive.name");

  const capturedOnDay = init.capturedOnDay ?? defaultDay;
  assertIntegerAtLeast(capturedOnDay, CAMPAIGN_DAY_MIN, "captive.capturedOnDay");

  const willingness = init.willingness ?? CAJOLE_MIN;
  if (!Number.isInteger(willingness) || willingness < CAJOLE_MIN || willingness > CAJOLE_MAX) {
    throw new RangeError(
      `captive.willingness must be an integer within [${CAJOLE_MIN}, ${CAJOLE_MAX}], received ${String(willingness)}`,
    );
  }

  return { id: init.id, irregular, name, capturedOnDay, willingness };
}

/* --------------------------------------------------------------------------
 * Barracks creation & queries
 * ------------------------------------------------------------------------ */

/**
 * Validate and normalise a full barracks. Duplicate captive ids and overflow
 * past {@link BARRACKS_CAPACITY} are rejected, so the pen is always canonical.
 */
export function createBarracks(init: AuxiliaryBarracksInit = {}): AuxiliaryBarracks {
  const supplied = init.captives ?? [];
  if (supplied.length > BARRACKS_CAPACITY) {
    throw new RangeError(`barracks may hold at most ${BARRACKS_CAPACITY} captives`);
  }
  const captives: Captive[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < supplied.length; index++) {
    const captive = createCaptive(supplied[index] as CaptiveInit);
    if (seen.has(captive.id)) {
      throw new RangeError(`barracks.captives[${index}] duplicates captive id ${captive.id}`);
    }
    seen.add(captive.id);
    captives.push(captive);
  }
  return { captives };
}

/**
 * Validate an untrusted value and return it as a fresh {@link AuxiliaryBarracks}.
 * This is the trust boundary for a save file or fixture (T101); a malformed pen
 * throws {@link BarracksError} rather than poisoning the campaign.
 */
export function parseBarracks(value: unknown, label = "barracks"): AuxiliaryBarracks {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BarracksError(`${label} must be an object`);
  }
  const record = value as Record<string, unknown>;
  try {
    return createBarracks({
      captives: (record.captives as readonly CaptiveInit[] | undefined) ?? [],
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new BarracksError(`${label} is not a well-formed barracks: ${reason}`);
  }
}

/** `true` when `value` round-trips through {@link parseBarracks}. */
export function isBarracks(value: unknown): value is AuxiliaryBarracks {
  try {
    parseBarracks(value);
    return true;
  } catch {
    return false;
  }
}

/** The captive with `captiveId`, or `undefined` when the pen does not hold it. */
export function captiveOf(
  barracks: AuxiliaryBarracks,
  captiveId: UnitId,
): Captive | undefined {
  return barracks.captives.find((captive) => captive.id === captiveId);
}

/** `true` when the pen holds `captiveId`. */
export function hasCaptive(barracks: AuxiliaryBarracks, captiveId: UnitId): boolean {
  return captiveOf(barracks, captiveId) !== undefined;
}

/** How many irregulars the pen currently holds. */
export function barracksSize(barracks: AuxiliaryBarracks): number {
  return barracks.captives.length;
}

/** `true` when the pen is at {@link BARRACKS_CAPACITY} and no capture may join. */
export function isBarracksFull(barracks: AuxiliaryBarracks): boolean {
  return barracks.captives.length >= BARRACKS_CAPACITY;
}

/** Every captive taken from the authored band `enemyId`, in acquisition order. */
export function captivesOfEnemy(
  barracks: AuxiliaryBarracks,
  enemyId: EnemyId,
): readonly Captive[] {
  return barracks.captives.filter((captive) => captive.irregular.id === enemyId);
}

/**
 * Whether a captive is willing enough to field ({@link CAJOLE_DEPLOY_MIN}).
 * A pure predicate; {@link deployBlockers} reports it alongside the other gates.
 */
export function isWilling(captive: Captive): boolean {
  return captive.willingness >= CAJOLE_DEPLOY_MIN;
}

/* --------------------------------------------------------------------------
 * Capture (mapping §11 — FFTA Hunter "Capture" / Beastmaster "Control")
 * ------------------------------------------------------------------------ */

/** A request to take a named irregular prisoner. */
export interface CaptureRequest {
  /** Identity the captive (and its future unit) will carry. */
  readonly id: UnitId;
  /** Optional field name; defaults to the band's own name. */
  readonly name?: string;
  /** Campaign day of capture; defaults to {@link CAMPAIGN_DAY_MIN}. */
  readonly capturedOnDay?: number;
}

/** Why an irregular cannot be taken prisoner right now (empty ⇒ it can). */
export type CaptureBlocker = "not-capturable" | "barracks-full" | "duplicate-captive";

/**
 * Every reason `request` cannot be captured, in a stable order. An empty array
 * means {@link canCapture} is `true` and {@link captureIrregular} will succeed.
 *
 * | Blocker             | Rule                                                |
 * | ------------------- | --------------------------------------------------- |
 * | `not-capturable`    | the authored band is not flagged `capturable`        |
 * | `barracks-full`     | the pen is at {@link BARRACKS_CAPACITY}              |
 * | `duplicate-captive` | the captive id is already held                       |
 */
export function captureBlockers(
  barracks: AuxiliaryBarracks,
  irregular: IrregularDef,
  request: CaptureRequest,
): readonly CaptureBlocker[] {
  const blockers: CaptureBlocker[] = [];
  assertId(request.id, "request.id");
  if (!irregular.capturable) blockers.push("not-capturable");
  if (isBarracksFull(barracks)) blockers.push("barracks-full");
  if (hasCaptive(barracks, request.id)) blockers.push("duplicate-captive");
  return blockers;
}

/** `true` when {@link captureIrregular} would take `irregular` prisoner. */
export function canCapture(
  barracks: AuxiliaryBarracks,
  irregular: IrregularDef,
  request: CaptureRequest,
): boolean {
  return captureBlockers(barracks, irregular, request).length === 0;
}

/**
 * Take an irregular prisoner and add it to the pen at willingness
 * {@link CAJOLE_MIN}. The full band is captured (its stats, level and actions);
 * it must be cajoled before it can be fielded.
 *
 * @throws RangeError when any {@link CaptureBlocker} applies or the captive is
 *   malformed.
 */
export function captureIrregular(
  barracks: AuxiliaryBarracks,
  irregular: IrregularDef,
  request: CaptureRequest,
): AuxiliaryBarracks {
  const blockers = captureBlockers(barracks, irregular, request);
  if (blockers.length > 0) {
    throw new RangeError(`cannot capture: ${blockers.join(", ")}`);
  }
  const captive = createCaptive(
    {
      id: request.id,
      irregular,
      ...(request.name !== undefined ? { name: request.name } : {}),
      ...(request.capturedOnDay !== undefined
        ? { capturedOnDay: request.capturedOnDay }
        : {}),
    },
    request.capturedOnDay ?? CAMPAIGN_DAY_MIN,
  );
  return { captives: [...barracks.captives, captive] };
}

/**
 * The chance a capture attempt succeeds, as a fraction in `[0, 1]`. A
 * full-strength, level-1 band is captured at {@link CAPTURE_BASE_CHANCE}; a
 * band reduced to or below {@link CAPTURE_WEAK_HP_FRACTION} of its hit points
 * gains {@link CAPTURE_WEAK_BONUS}, and each level above 1 costs
 * {@link CAPTURE_LEVEL_PENALTY}. The result is clamped to
 * `[{@link CAPTURE_MIN_CHANCE}, {@link CAPTURE_MAX_CHANCE}]`, so a capture is
 * never a certainty or a formality. `hpFraction` is the target's remaining hit
 * points divided by its maximum, in `[0, 1]`.
 */
export function captureChance(irregular: IrregularDef, hpFraction = 1): number {
  if (!Number.isFinite(hpFraction) || hpFraction < 0 || hpFraction > 1) {
    throw new RangeError(
      `hpFraction must be within [0, 1], received ${String(hpFraction)}`,
    );
  }
  const weakened = hpFraction <= CAPTURE_WEAK_HP_FRACTION;
  const penalty = Math.max(0, irregular.level - 1) * CAPTURE_LEVEL_PENALTY;
  const raw = CAPTURE_BASE_CHANCE + (weakened ? CAPTURE_WEAK_BONUS : 0) - penalty;
  return Math.min(CAPTURE_MAX_CHANCE, Math.max(CAPTURE_MIN_CHANCE, raw));
}

/** Outcome of one seeded capture attempt. */
export interface CaptureAttempt {
  /** The pen after the attempt (unchanged when it failed). */
  readonly barracks: AuxiliaryBarracks;
  /** `true` when the roll succeeded and the band was penned. */
  readonly captured: boolean;
  /** Chance the roll used, in `[0, 1]`. */
  readonly chance: number;
  /** Gates that blocked the attempt before any roll; empty when it was rolled. */
  readonly blockers: readonly CaptureBlocker[];
}

/**
 * Roll a seeded capture attempt. The gates ({@link captureBlockers}) are
 * checked first: when any applies the attempt fails without consuming the
 * {@link Rng}, so the stream stays reproducible regardless of caller retries.
 * Otherwise one draw is made against {@link captureChance} and, on success, the
 * band is added to a new pen.
 *
 * ```ts
 * const rng = new Rng(1809);
 * const { barracks: pen, captured } = attemptCapture(pen, band, { id }, rng, 0.1);
 * ```
 */
export function attemptCapture(
  barracks: AuxiliaryBarracks,
  irregular: IrregularDef,
  request: CaptureRequest,
  rng: Rng,
  hpFraction = 1,
): CaptureAttempt {
  const blockers = captureBlockers(barracks, irregular, request);
  if (blockers.length > 0) {
    return { barracks, captured: false, chance: 0, blockers };
  }
  const chance = captureChance(irregular, hpFraction);
  if (!rng.chance(chance)) {
    return { barracks, captured: false, chance, blockers };
  }
  return {
    barracks: captureIrregular(barracks, irregular, request),
    captured: true,
    chance,
    blockers,
  };
}

/* --------------------------------------------------------------------------
 * Cajole (mapping §11 — FFTA Affection: feeding a banked monster)
 * ------------------------------------------------------------------------ */

/** Why a captive cannot be cajoled right now (empty ⇒ it can). */
export type CajoleBlocker = "unknown-captive" | "fully-cajoled";

/**
 * Every reason `captiveId` cannot be cajoled, in a stable order. A captive that
 * is already at {@link CAJOLE_MAX} willingness has nothing left to gain.
 */
export function cajoleBlockers(
  barracks: AuxiliaryBarracks,
  captiveId: UnitId,
): readonly CajoleBlocker[] {
  assertId(captiveId, "captiveId");
  const captive = captiveOf(barracks, captiveId);
  if (captive === undefined) return ["unknown-captive"];
  if (captive.willingness >= CAJOLE_MAX) return ["fully-cajoled"];
  return [];
}

/** `true` when {@link cajoleIrregular} would raise `captiveId`'s willingness. */
export function canCajole(barracks: AuxiliaryBarracks, captiveId: UnitId): boolean {
  return cajoleBlockers(barracks, captiveId).length === 0;
}

/**
 * Cajole a captive, raising its willingness by `amount` (default
 * {@link CAJOLE_STEP}) and clamping at {@link CAJOLE_MAX}. The pen is returned
 * unchanged when the captive is already fully cajoled; an unknown id is a
 * caller bug and throws.
 *
 * @throws RangeError when the id is unknown or `amount` is not a positive
 *   integer.
 */
export function cajoleIrregular(
  barracks: AuxiliaryBarracks,
  captiveId: UnitId,
  amount: number = CAJOLE_STEP,
): AuxiliaryBarracks {
  assertId(captiveId, "captiveId");
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new RangeError(`amount must be a positive integer, received ${String(amount)}`);
  }
  const blockers = cajoleBlockers(barracks, captiveId);
  if (blockers.includes("unknown-captive")) {
    throw new RangeError(`no captive named ${captiveId}`);
  }
  if (blockers.length > 0) return barracks;

  const captives = barracks.captives.map((captive) =>
    captive.id === captiveId
      ? { ...captive, willingness: Math.min(CAJOLE_MAX, captive.willingness + amount) }
      : captive,
  );
  return { captives };
}

/* --------------------------------------------------------------------------
 * Deploy (mapping §10, §11 — fielding a cajoled band)
 * ------------------------------------------------------------------------ */

/** Why a captive cannot be fielded right now (empty ⇒ it can). */
export type DeployBlocker = "unknown-captive" | "not-cajoled";

/**
 * Every reason `captiveId` cannot be deployed, in a stable order. A band must
 * be cajoled to at least {@link CAJOLE_DEPLOY_MIN} willingness before it will
 * march under the company's colours.
 */
export function deployBlockers(
  barracks: AuxiliaryBarracks,
  captiveId: UnitId,
): readonly DeployBlocker[] {
  assertId(captiveId, "captiveId");
  const captive = captiveOf(barracks, captiveId);
  if (captive === undefined) return ["unknown-captive"];
  if (!isWilling(captive)) return ["not-cajoled"];
  return [];
}

/** `true` when {@link deployIrregular} would field `captiveId`. */
export function canDeploy(barracks: AuxiliaryBarracks, captiveId: UnitId): boolean {
  return deployBlockers(barracks, captiveId).length === 0;
}

/** The captives currently willing to be fielded, in acquisition order. */
export function deployableCaptives(barracks: AuxiliaryBarracks): readonly Captive[] {
  return barracks.captives.filter(isWilling);
}

/** Where and how a captive is placed on the field when deployed. */
export interface DeployRequest {
  /** The captive to field. */
  readonly id: UnitId;
  /** The tile the auxiliary occupies. */
  readonly at: Coord;
  /** Initial facing; defaults to north, like every {@link createUnit} unit. */
  readonly facing?: Facing;
  /** Which side it fights for; defaults to the free company. */
  readonly side?: UnitSide;
  /** Optional override for the field name; defaults to the captive's name. */
  readonly name?: string;
}

/**
 * The battlefield {@link Unit} a captive fields as. The band's own stats,
 * level and actions are carried across, every enemy action is marked as a
 * **mastered** {@link LearnedAbility} (an irregular needs no Drill to use what
 * it already knows), and the unit fights for the company. Its `postId` is the
 * synthetic {@link AUXILIARY_POST_ID}: an auxiliary has no authored post and
 * must never be mistaken for a roster soldier.
 *
 * @throws RangeError when `captiveId` is unknown, is not yet cajoled, or the
 *   placed coordinates/facing are malformed.
 */
export function deployIrregular(
  barracks: AuxiliaryBarracks,
  request: DeployRequest,
): Unit {
  const blockers = deployBlockers(barracks, request.id);
  if (blockers.length > 0) {
    throw new RangeError(`cannot deploy: ${blockers.join(", ")}`);
  }
  const captive = captiveOf(barracks, request.id) as Captive;
  const { at, facing, side, name } = request;
  if (facing !== undefined && !isFacing(facing)) {
    throw new RangeError(`facing must be a cardinal direction, received ${String(facing)}`);
  }
  return createUnit({
    id: captive.id,
    name: name ?? captive.name,
    power: captive.irregular.power,
    postId: AUXILIARY_POST_ID,
    ...(side !== undefined ? { side } : {}),
    level: captive.irregular.level,
    at: coord(at.x, at.y),
    ...(facing !== undefined ? { facing } : {}),
    stats: captive.irregular.stats,
    abilities: captive.irregular.abilities.map((abilityId) => ({
      abilityId,
      drill: 0,
      mastered: true,
    })),
  });
}

/**
 * Field up to {@link DEPLOY_MAX} cajoled captives at once. Every request is
 * validated before any unit is built, so a party either deploys whole or not at
 * all (no half-built escort). Duplicate captive ids and duplicate tiles are
 * rejected, matching `createBattle`'s one-unit-per-tile rule.
 *
 * @throws RangeError when the party is empty, exceeds {@link DEPLOY_MAX}, names
 *   an unknown/cajoled captive, or shares an id or tile.
 */
export function deployParty(
  barracks: AuxiliaryBarracks,
  requests: readonly DeployRequest[],
): readonly Unit[] {
  if (requests.length === 0) {
    throw new RangeError("a deployment needs at least one captive");
  }
  if (requests.length > DEPLOY_MAX) {
    throw new RangeError(`at most ${DEPLOY_MAX} auxiliaries may be deployed at once`);
  }
  const seenIds = new Set<string>();
  const seenTiles = new Set<string>();
  for (const request of requests) {
    const blockers = deployBlockers(barracks, request.id);
    if (blockers.length > 0) {
      throw new RangeError(`cannot deploy ${request.id}: ${blockers.join(", ")}`);
    }
    if (seenIds.has(request.id)) {
      throw new RangeError(`duplicate captive in deployment: ${request.id}`);
    }
    seenIds.add(request.id);
    const tile = `${request.at.x},${request.at.y}`;
    if (seenTiles.has(tile)) {
      throw new RangeError(`two auxiliaries may not share tile { x: ${request.at.x}, y: ${request.at.y} }`);
    }
    seenTiles.add(tile);
  }
  return requests.map((request) => deployIrregular(barracks, request));
}

/* --------------------------------------------------------------------------
 * Foreign Drill (mapping §11 — FFTA Blue Magic)
 * ------------------------------------------------------------------------ */

/** Why a soldier cannot learn an enemy action (empty ⇒ it can). */
export type ForeignDrillBlocker =
  | "not-an-enemy-action"
  | "no-foreign-drill"
  | "already-mastered";

/** `true` when the soldier has already mastered `abilityId` (T048). */
export function hasMasteredAbility(unit: Unit, abilityId: AbilityId): boolean {
  return unit.abilities.some(
    (learned) => learned.abilityId === abilityId && learned.mastered,
  );
}

/**
 * Every reason `unit` cannot copy `abilityId` from `irregular`, in a stable
 * order. The checks mirror FFTA's Blue Magic: the skill must be an action the
 * enemy actually uses, the soldier must have the **Foreign Drill** trait
 * equipped (`src/engine/traits.ts`), and the action must not already be
 * mastered.
 *
 * | Blocker               | Rule                                                |
 * | --------------------- | --------------------------------------------------- |
 * | `not-an-enemy-action` | the band does not know the action                    |
 * | `no-foreign-drill`    | the soldier has no `learnsAbility` trait equipped    |
 * | `already-mastered`    | the action is already permanently known             |
 */
export function foreignDrillBlockers(
  unit: Unit,
  irregular: IrregularDef,
  abilityId: AbilityId,
  options: TraitOptions = {},
): readonly ForeignDrillBlocker[] {
  assertId(abilityId, "abilityId");
  const blockers: ForeignDrillBlocker[] = [];
  if (!irregular.abilities.includes(abilityId)) blockers.push("not-an-enemy-action");
  const ctx = makeTraitContext({ unit, role: "defender" });
  if (!learnsAbility(abilityId, ctx, options)) blockers.push("no-foreign-drill");
  if (hasMasteredAbility(unit, abilityId)) blockers.push("already-mastered");
  return blockers;
}

/** `true` when {@link learnFromEnemy} would copy `abilityId` from the band. */
export function canLearnFromEnemy(
  unit: Unit,
  irregular: IrregularDef,
  abilityId: AbilityId,
  options: TraitOptions = {},
): boolean {
  return foreignDrillBlockers(unit, irregular, abilityId, options).length === 0;
}

/**
 * Copy an irregular's action into a soldier's permanent repertoire. The action
 * is learned **mastered** (an observation is not a Drill grind), so it survives
 * the death of the band that taught it, exactly like an ability mastered by kit
 * (T048). The soldier is returned untouched when a gate blocks the attempt;
 * only an unknown ability id is a caller bug.
 *
 * ```ts
 * const officer = learnFromEnemy(unit, guerrillaBand, asAbilityId("ambush"), {
 *   loadout: { [unit.id]: "foreignDrill" },
 * });
 * hasMasteredAbility(officer, asAbilityId("ambush")); // true
 * ```
 */
export function learnFromEnemy(
  unit: Unit,
  irregular: IrregularDef,
  abilityId: AbilityId,
  options: TraitOptions = {},
): Unit {
  const blockers = foreignDrillBlockers(unit, irregular, abilityId, options);
  if (blockers.length > 0) {
    if (blockers.includes("not-an-enemy-action")) {
      throw new RangeError(
        `the band does not know action ${abilityId}; cannot copy a foreign action it never used`,
      );
    }
    return unit;
  }
  return learnAbility(unit, { abilityId, drill: 0, mastered: true });
}

/**
 * Every action held by `irregular` that `unit` could copy under `options`, in
 * the band's authored order. This is the list a Foreign Drill warrior is
 * offered after a battle — the candidate "blue magic" pool.
 */
export function foreignDrillCandidates(
  unit: Unit,
  irregular: IrregularDef,
  options: TraitOptions = {},
): readonly AbilityId[] {
  return irregular.abilities.filter((abilityId) =>
    canLearnFromEnemy(unit, irregular, abilityId, options),
  );
}
