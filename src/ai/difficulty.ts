/**
 * Difficulty tiers + decision budget (T099) — the **policy dial** on top of the
 * utility AI (T095).
 *
 * `./utility.ts` decides *what is best*; this module decides *how well the
 * enemy plays*. A difficulty tier is authored balance data (`agents.md` §2)
 * that bends the utility scorer along two axes and sets a ceiling on how much
 * work one decision may do:
 *
 * - **Aggression** (0–100) — how hard the soldier presses. It raises the value
 *   of kills, threat and closing to contact, while a cautious tier keeps a
 *   healthy fear of return fire. The mapping is a small, readable set of deltas
 *   over the scorer's {@link UtilityWeights}, so a reviewer can see exactly
 *   what "veteran" changes.
 * - **Mistakes** (`mistakeChance` 0–1, `mistakeDepth`) — how often, and how
 *   badly, the soldier misjudges the field. A blunder is **not** an illegal
 *   order: the AI still picks from its own scored, legal candidate set, but it
 *   stoops to the 2nd-, 3rd- … best plan instead of the best. The roll is
 *   drawn from a **seeded** PRNG ({@link createDifficultyRng}) so the same
 *   battle and command log replay byte-for-byte (`agents.md` §2, decision D15).
 * - **Search limit** — an upper bound on destination tiles explored per
 *   decision. FFTA-scale skirmishes are small, but the AI must still fit the
 *   60 fps frame budget ({@link DECISION_BUDGET_MS}) on a large map, so every
 *   decision is capped. The cap doubles as a handicap: green troops consider
 *   fewer options.
 *
 * The tier is deliberately *global*, while a troop's authored `aiProfile`
 * (`src/data/enemies/profiles.ts`) is *personal*. They compose:
 *
 * ```ts
 * base    = profile ? weightsFromProfile(profile) : DEFAULT_UTILITY_WEIGHTS;
 * weights = { ...difficultyWeights(tier, base), ...callerOverrides };
 * ```
 *
 * so a fanatic under `recruit` is a cautious fanatic, and a gun line under
 * `elite` is a merciless gun line.
 *
 * ## Determinism
 *
 * The mistake stream is seeded from facts already in the battle — the battle
 * seed, the tier id, the soldier's id and the current Orders Tempo tick
 * ({@link difficultySeed}). Two consequences matter:
 *
 * - **Pure** — no `Math.random`, no clock, no engine mutation. The same battle
 *   value and soldier always yield the same decision, so a replay never
 *   diverges.
 * - **Stateless** — there is no difficulty RNG to persist. Loading a save and
 *   resuming reproduces the same rolls because the seed is derived, not stored.
 *
 * ## The decision budget
 *
 * {@link DECISION_BUDGET_MS} is the wall-clock ceiling a single decision should
 * stay under to hold 60 fps. {@link chooseTurnWithDifficulty} passes each
 * tier's `searchLimit` to the scorer's `maxDestinations` bound, which stops the
 * destination × ability × target enumeration (and the per-destination exposure
 * probe) growing without limit. `tests/unit/ai.test.ts` pins a typical
 * encounter well inside the budget.
 *
 * Reference: mapping §11–§12 (irregulars and the Orders Tempo tactical inputs).
 * Difficulty is authored for this project, not scraped (`agents.md` §3, §10).
 */

import type { BattleState } from "../engine/battle";
import type { UnitId } from "../engine/ids";
import { Rng, type Seed } from "../engine/rng";
import {
  DEFAULT_UTILITY_WEIGHTS,
  chooseTurn,
  weightsFromProfile,
  type TurnPlan,
  type UtilityOptions,
  type UtilityWeights,
} from "./utility";

/* --------------------------------------------------------------------------
 * Constants (authored balance data; Phase 13 owns the final pass)
 * ------------------------------------------------------------------------ */

/**
 * Wall-clock ceiling (milliseconds) a single AI decision should stay under to
 * hold a 60 fps frame with room for animation and rendering. It is a
 * **budget**, not a timer: nothing reads the clock to enforce it, the search
 * limit keeps typical decisions far inside it, and the test suite measures it.
 */
export const DECISION_BUDGET_MS = 16;

/**
 * Default number of destination tiles a tier explores when it does not name
 * its own limit. Large enough not to distort a typical skirmish, small enough
 * to bound the enumeration on a pathological map.
 */
export const DEFAULT_SEARCH_LIMIT = 32;

/* --------------------------------------------------------------------------
 * Tier data
 * ------------------------------------------------------------------------ */

/** The four named difficulty presets, weakest first. */
export const DIFFICULTY_TIER_IDS = ["recruit", "regular", "veteran", "elite"] as const;
export type DifficultyTierId = (typeof DIFFICULTY_TIER_IDS)[number];

/**
 * One difficulty policy: how hard the soldier presses, how often it errs, and
 * how much of the battlefield it reasons about per turn. Plain data, so it can
 * be authored, saved or overridden without touching `./utility.ts`.
 */
export interface DifficultyDef {
  /** Stable id (`"recruit"`, `"regular"`, …, or a scenario's own). */
  readonly id: string;
  /** Display name for the difficulty menu. */
  readonly name: string;
  /** One-line rules summary. */
  readonly description: string;
  /** Period-fiction flavour line. */
  readonly flavour: string;
  /** 0–100: how readily the soldier presses an attack. */
  readonly aggression: number;
  /** 0–1: probability that any single decision is a blunder. */
  readonly mistakeChance: number;
  /** 1–8: the worst candidate rank a blunder may stoop to (1 = 2nd-best). */
  readonly mistakeDepth: number;
  /** Maximum destination tiles explored per decision (frame safety). */
  readonly searchLimit: number;
}

/**
 * The canonical tiers, keyed by id. `regular` is the neutral, balanced preset
 * and the {@link DEFAULT_DIFFICULTY}; the others bracket it toward a green,
 * hesitant enemy and toward a ruthless professional one.
 */
export const DIFFICULTY_TIERS: Readonly<Record<DifficultyTierId, DifficultyDef>> = {
  recruit: {
    id: "recruit",
    name: "Recruit",
    description: "Hesitant and error-prone: it misreads the field and rarely presses home.",
    flavour: "Fresh from the depot, with more courage than judgement.",
    aggression: 25,
    mistakeChance: 0.35,
    mistakeDepth: 4,
    searchLimit: 16,
  },
  regular: {
    id: "regular",
    name: "Regular",
    description: "Competent line behaviour: sound targets, occasional lapses.",
    flavour: "A soldier who has been shot at before, and remembers the lesson.",
    aggression: 50,
    mistakeChance: 0.15,
    mistakeDepth: 3,
    searchLimit: DEFAULT_SEARCH_LIMIT,
  },
  veteran: {
    id: "veteran",
    name: "Veteran",
    description: "Experienced and cold: it exploits openings and seldom misjudges.",
    flavour: "The oldest hands are the quietest, and the last to be surprised.",
    aggression: 75,
    mistakeChance: 0.05,
    mistakeDepth: 2,
    searchLimit: 40,
  },
  elite: {
    id: "elite",
    name: "Elite",
    description: "A professional adversary: relentless, precise and never careless.",
    flavour: "They have done this a hundred times, and intend to do it again.",
    aggression: 100,
    mistakeChance: 0,
    mistakeDepth: 1,
    searchLimit: 48,
  },
};

/** The difficulty a battle uses when none is named. */
export const DEFAULT_DIFFICULTY: DifficultyTierId = "regular";

/** Clamp a value into the inclusive `[0, 100]` integer band. */
export function clampAggression(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** Clamp a value into the inclusive `[0, 1]` band. */
function clampChance(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Positive integer, or `fallback` when `value` is absent/invalid. */
function positiveInt(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

/**
 * A tier id or a full definition. Accepting both lets the UI pass a named
 * preset while a scenario or test passes a bespoke {@link DifficultyDef}.
 */
export type DifficultyChoice = DifficultyTierId | DifficultyDef;

/** Resolve a {@link DifficultyChoice} to its definition (id → preset). */
export function resolveDifficulty(choice: DifficultyChoice = DEFAULT_DIFFICULTY): DifficultyDef {
  return typeof choice === "string" ? DIFFICULTY_TIERS[choice] : choice;
}

/** Authoring input for {@link makeDifficulty}; every field is optional. */
export interface DifficultyInit {
  readonly id?: string;
  readonly name?: string;
  readonly description?: string;
  readonly flavour?: string;
  readonly aggression?: number;
  readonly mistakeChance?: number;
  readonly mistakeDepth?: number;
  readonly searchLimit?: number;
}

/**
 * Build a bespoke difficulty definition, clamping each field into range so a
 * malformed value can never ask for an impossible behaviour (e.g. a negative
 * search budget or a 300% mistake rate). Handy for scenario tuning and tests
 * that want to pin an exact policy.
 */
export function makeDifficulty(init: DifficultyInit = {}): DifficultyDef {
  return {
    id: init.id ?? "custom",
    name: init.name ?? "Custom",
    description: init.description ?? "A scenario-authored difficulty.",
    flavour: init.flavour ?? "",
    aggression: clampAggression(init.aggression ?? 50),
    mistakeChance: clampChance(init.mistakeChance ?? 0),
    mistakeDepth: positiveInt(init.mistakeDepth, 1),
    searchLimit: positiveInt(init.searchLimit, DEFAULT_SEARCH_LIMIT),
  };
}

/* --------------------------------------------------------------------------
 * Aggression → weights
 * ------------------------------------------------------------------------ */

/**
 * Apply a tier's **aggression** to a base weight block. The base is usually
 * {@link DEFAULT_UTILITY_WEIGHTS} or {@link weightsFromProfile} output, so the
 * troop's authored temperament and the global difficulty compose rather than
 * clobber one another (`agents.md` §2).
 *
 * The deltas are intentionally small and readable:
 *
 * - `kill` and `threat` rise with aggression, so a hard tier finishes wounded
 *   soldiers and silences batteries;
 * - `advance` rises with aggression and falls for a cautious tier, so a
 *   recruit needs more persuading to close;
 * - `exposure` and `brace` rise as aggression falls, so a cautious tier values
 *   cover and holding ground.
 *
 * Pure: `base` is only read and a fresh block is returned.
 */
export function difficultyWeights(
  choice: DifficultyChoice,
  base: UtilityWeights = DEFAULT_UTILITY_WEIGHTS,
): UtilityWeights {
  const def = resolveDifficulty(choice);
  const aggression = clampAggression(def.aggression) / 100;
  const caution = 1 - aggression;

  return {
    ...base,
    kill: base.kill + Math.round(15 * aggression),
    threat: base.threat + Math.round(2 * aggression),
    advance: Math.max(0, base.advance + Math.round(4 * aggression) - 2),
    exposure: Math.max(0, base.exposure + Math.round(4 * caution) - 2),
    brace: Math.max(0, base.brace + Math.round(2 * caution)),
  };
}

/* --------------------------------------------------------------------------
 * Seeded mistakes
 * ------------------------------------------------------------------------ */

/**
 * The seed for one soldier's difficulty roll: derived from the battle seed, the
 * tier id, the soldier id and the current Orders Tempo tick. Derived rather
 * than stored, so a save/load resumes the same stream and the AI stays
 * stateless (`agents.md` §2).
 */
export function difficultySeed(
  state: BattleState,
  unitId: UnitId,
  choice: DifficultyChoice = DEFAULT_DIFFICULTY,
): Seed {
  const def = resolveDifficulty(choice);
  return `difficulty:${String(state.seed)}:${def.id}:${unitId}:${state.tempo.tick}`;
}

/**
 * A fresh seeded PRNG for one difficulty decision. Separate from the engine's
 * Orders Tempo stream, so drawing from it never perturbs the simulation.
 */
export function createDifficultyRng(
  state: BattleState,
  unitId: UnitId,
  choice: DifficultyChoice = DEFAULT_DIFFICULTY,
): Rng {
  return new Rng(difficultySeed(state, unitId, choice));
}

/** The outcome of one seeded blunder check. */
export interface BlunderRoll {
  /** `true` when the soldier misjudged this decision. */
  readonly blundered: boolean;
  /** Candidate rank to take (`0` = best; `>= 1` only when `blundered`). */
  readonly rank: number;
}

/**
 * Roll for a mistake on a tier. Draws exactly one float to decide whether the
 * soldier blunders and, if so, one integer to pick how far down the ranked
 * candidate list it stoops ({@link DifficultyDef.mistakeDepth}). A tier with
 * `mistakeChance: 0` never blunders; one with `1` always does.
 *
 * Pure: the RNG is advanced, but the battle is not touched.
 */
export function rollBlunder(rng: Rng, choice: DifficultyChoice): BlunderRoll {
  const def = resolveDifficulty(choice);
  const chance = clampChance(def.mistakeChance);
  if (chance <= 0 || rng.next() >= chance) return { blundered: false, rank: 0 };

  const depth = positiveInt(def.mistakeDepth, 1);
  return { blundered: true, rank: 1 + rng.nextInt(depth) };
}

/* --------------------------------------------------------------------------
 * Planning
 * ------------------------------------------------------------------------ */

/** Why a plan looked the way it did, for traces and difficulty UIs. */
export interface DifficultyTrace {
  /** The tier id the plan ran under. */
  readonly tier: string;
  /** The tier's display name. */
  readonly name: string;
  /** The tier's authored aggression (0–100). */
  readonly aggression: number;
  /** The tier's authored mistake chance (0–1). */
  readonly mistakeChance: number;
  /** The tier's authored mistake depth (1–8). */
  readonly mistakeDepth: number;
  /** The destination cap actually used. */
  readonly searchLimit: number;
  /** Whether this decision was a blunder. */
  readonly blundered: boolean;
  /** The candidate rank taken (`0` = best). */
  readonly rank: number;
  /** How many candidates were scored (also on the plan itself). */
  readonly considered: number;
}

/** A {@link TurnPlan} plus the difficulty trace that produced it. */
export interface DifficultyPlan extends TurnPlan {
  readonly difficulty: DifficultyTrace;
}

/**
 * Plan one soldier's turn under a difficulty tier: apply the tier's aggression,
 * roll a seeded mistake, bound the search, and return the best (or blundered)
 * legal plan together with a {@link DifficultyTrace}.
 *
 * ```ts
 * const plan = chooseTurnWithDifficulty(battle, battle.currentActorId!, "veteran");
 * for (const command of plan.commands) battle = step(battle, command).state;
 * ```
 *
 * A caller's explicit `options.weights`, `options.abilities`, `options.orders`
 * and `options.forecast` are all honoured; only `profile` is folded into the
 * final weight block, so it is cleared before delegating to
 * {@link chooseTurn}. `options.maxDestinations` overrides the tier's
 * `searchLimit` when supplied.
 *
 * Deterministic: the same battle and soldier always yield the same plan, with
 * or without a blunder.
 */
export function chooseTurnWithDifficulty(
  state: BattleState,
  unitId: UnitId,
  difficulty: DifficultyChoice = DEFAULT_DIFFICULTY,
  options: UtilityOptions = {},
): DifficultyPlan {
  const def = resolveDifficulty(difficulty);
  const rng = createDifficultyRng(state, unitId, def);
  const { blundered, rank } = rollBlunder(rng, def);

  const base =
    options.profile === undefined ? DEFAULT_UTILITY_WEIGHTS : weightsFromProfile(options.profile);
  const weights: UtilityWeights = { ...difficultyWeights(def, base), ...options.weights };

  const plan = chooseTurn(state, unitId, {
    ...options,
    profile: undefined,
    weights,
    maxDestinations: options.maxDestinations ?? def.searchLimit,
    rank,
  });

  return {
    ...plan,
    difficulty: {
      tier: def.id,
      name: def.name,
      aggression: def.aggression,
      mistakeChance: def.mistakeChance,
      mistakeDepth: def.mistakeDepth,
      searchLimit: def.searchLimit,
      blundered,
      rank,
      considered: plan.considered,
    },
  };
}
