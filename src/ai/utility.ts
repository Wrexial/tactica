/**
 * Utility-based AI (T095) — the decision-maker for hostile and auto-battled
 * soldiers.
 *
 * The AI is a **client of the engine**, never a second rules system
 * (`agents.md` §7): it reads a {@link BattleState}, enumerates the legal orders
 * the current actor could issue, weighs each one with a small, tunable scoring
 * function, and hands the winner back as ordinary {@link Command}s. Those
 * commands are then committed through `step` exactly as a player's would be, so
 * a battle driven by the AI is as deterministic and replayable as one driven by
 * a human.
 *
 * ## Why utility scoring
 *
 * FFTA's tactical AI (and our retheme of it, mapping §11–§12) is not a script:
 * a trooper weighs how much hurt it can do, whether the blow will finish a
 * target, how dangerous that target is, and whether the ground it must stand on
 * exposes it to the enemy's next volley. {@link scoreCandidate} makes those
 * trade-offs explicit:
 *
 * - **expected damage** — the hit-weighted damage the order would land, summed
 *   across every hostile it catches (mirroring the T086 forecast so the AI and
 *   the confirm prompt never disagree).
 * - **kill potential** — a bonus, scaled by the victim's {@link targetThreat},
 *   for finishing a soldier off. This is why an otherwise equal AI prefers the
 *   finishing stroke over a fresh wound.
 * - **threat** — the danger a damaged target represents, so a gun section
 *   silences the battery before it chases a skirmisher.
 * - **positioning** — elevation, flank/rear bearing and sight-blocking cover,
 *   minus the expected return fire the destination invites.
 *
 * ## Content-driven knobs
 *
 * The weights are data, not branches (`agents.md` §2). Enemy troops carry an
 * authored `aiProfile` (`src/data/enemies/profiles.ts`) describing their
 * temperament; {@link weightsFromProfile} turns those coarse knobs
 * (`aggression`, `flankBias`, `holdGround`, ...) into a {@link UtilityWeights}
 * block. A hand-authored override passed through
 * {@link UtilityOptions.weights} always wins, so tests and scenario authors can
 * pin behaviour exactly.
 *
 * ## Contracts (`agents.md` §2, §7, §9)
 *
 * - **Pure and deterministic** — no DOM, no I/O, no `Math.random`, no `Date`.
 *   Destinations, abilities and targets are enumerated in stable orders and
 *   ties keep the first-seen candidate, so the same battle always yields the
 *   same plan.
 * - **Legal by construction, verified by the engine** — candidates are built
 *   only from the actor's true move range and the battle's ability catalogue,
 *   and {@link chooseTurn} replays the winning commands through `step` before
 *   returning them. If the engine would refuse the plan it falls back to a
 *   `wait`, so the AI can never issue an illegal order.
 * - **No mutation** — the input state is only read; planning returns a fresh
 *   value and leaves the battle byte-identical.
 *
 * ## Articles of War (T096)
 *
 * A soldier fights under the day's **Articles of War** (mapping §9): the
 * Provost Marshal issues a **Reprimand** (Yellow) or **Court-Martial** (Red)
 * for a forbidden act, and a Red Card removes the offender from the field. A
 * competent AI therefore refuses to plan a turn that would breach a standing
 * order — unless the soldier holds a **Commission** (the Colours, FFTA's Boss
 * Medal), which caps escalation at a Reprimand and makes violations free of
 * consequence.
 *
 * Callers pass the battle's posting ({@link UtilityOptions.orders}, a
 * {@link BattleOrders} value) and any held medals ({@link
 * UtilityOptions.commissions}). Each candidate's action and march are projected
 * into the same {@link ArticleSubject} facts the Provost rules on (reusing the
 * tested T056 {@link detectArticles}), and a breach 	extbf{disqualifies} the
 * candidate for an uncommissioned soldier. A commissioned soldier skips that
 * filter. With no posting supplied the AI is entirely law-agnostic, exactly as
 * before.
 *
 * Reference: `docs/wiki/pages/Final_Fantasy_Tactics_Advance_jobs.md` (job/AI
 * behaviour is largely emergent), `docs/wiki/pages/Law_system_(Tactics_
 * Advance).md` (forbidden acts, the Boss Medal), mapping §9 and §11–§12. The
 * scoring shape is **authored balance data**, not scraped gospel (`agents.md`
 * §3, §10).
 */

import type { ElementKey, WeaponType } from "../data/schema";
import type { EnemyAiProfileDef } from "../data/enemies/profiles";
import type { BattleOrders } from "../engine/actions/orders";
import { canAfford, type ActionSpec } from "../engine/actions/resolve";
import { findUnit, step, type BattleState } from "../engine/battle";
import type { Command, Target } from "../engine/commands";
import { coordEquals, manhattanDistance, type Coord } from "../engine/grid";
import { asArticleId, type AbilityId, type ArticleId, type UnitId } from "../engine/ids";
import { findPath, reachableWithin } from "../engine/pathfinding";
import { blocksSightAt, heightAt } from "../engine/terrain";
import {
  articleSubjectOfAction,
  detectArticles,
  isCommissioned,
  type ArticleActionView,
  type ArticleEffectView,
  type ArticleMatch,
  type ArticleSubject,
  type Commissions,
} from "../engine/rules/articles";
import { areHostile, isAllyTarget, isEnemyTarget, type TargetActor } from "../engine/targeting";
import { isOutOfAction, type Unit } from "../engine/unit";
import {
  forecastAbility,
  type ForecastAbilitySpec,
  type ForecastOptions,
} from "../ui/battleForecast";

/* --------------------------------------------------------------------------
 * Errors
 * ------------------------------------------------------------------------ */

/**
 * Thrown when the AI is asked to plan for a soldier who is not deployed, or
 * when an authored weight block is malformed. These are programmer/content
 * mistakes, not in-world illegal orders — those become a `wait` fallback.
 */
export class AiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiError";
  }
}

/* --------------------------------------------------------------------------
 * Weights (authored balance data)
 * ------------------------------------------------------------------------ */

/**
 * The tunable coefficients behind {@link scoreCandidate}. Every term is
 * additive on a shared integer scale so a change is easy to reason about; the
 * defaults are deliberately coarse and in the spirit of the AI profiles'
 * "temperament" knobs (`src/data/enemies/profiles.ts`).
 */
export interface UtilityWeights {
  /** Value per point of hit-weighted damage dealt to hostiles. */
  readonly damage: number;
  /** Value per point of victim threat when the blow would finish them. */
  readonly kill: number;
  /** Value per point of threat represented by every hostile the blow damages. */
  readonly threat: number;
  /** Value per point of medicine restored to an ally. */
  readonly healing: number;
  /** Penalty per point of hit-weighted damage the order would deal an ally. */
  readonly friendlyFire: number;
  /** Value per elevation layer held over an engaged target. */
  readonly elevation: number;
  /** Value per flanking point (side = 1, rear = 2) against an engaged target. */
  readonly flank: number;
  /** Value for ending the turn on a sight-blocking (cover) tile. */
  readonly cover: number;
  /** Penalty per point of expected return fire at the destination. */
  readonly exposure: number;
  /** Penalty per movement point spent, so equal plans favour shorter marches. */
  readonly moveCost: number;
  /** Penalty per tile of distance from the nearest hostile (advance plans only). */
  readonly advance: number;
  /** Small bonus for bracing in place when no attack presents itself. */
  readonly brace: number;
}

/**
 * The balanced default weights. Tuned so a genuine attack dominates any purely
 * positional consideration, while a lethal stroke outranks an equivalent
 * non-lethal one. The Phase 13 balance pass owns the final numbers.
 */
export const DEFAULT_UTILITY_WEIGHTS: UtilityWeights = {
  damage: 4,
  kill: 25,
  threat: 3,
  healing: 3,
  friendlyFire: 40,
  elevation: 2,
  flank: 4,
  cover: 3,
  exposure: 3,
  moveCost: 1,
  advance: 3,
  brace: 2,
};

/** Clamp a value into the inclusive `[low, high]` integer band. */
function clampInt(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, Math.round(value)));
}

/**
 * Turn an authored troop temperament (`EnemyAiProfileDef`, T091) into concrete
 * {@link UtilityWeights}. Content stays the behaviour contract (`agents.md`
 * §2): a `fanatic` presses and never holds, an `artillery` crew keeps its
 * distance and values elevation, a `defensive` line refuses needless marches.
 *
 * The mapping is intentionally readable rather than clever — each knob bends
 * one or two weights:
 *
 * - `aggression` raises the value of kills and of closing to contact, and
 *   lowers the caution applied to return fire;
 * - `rangedBias` tempers how far a unit is willing to march (`advance`);
 * - `flankBias` raises the flank weight;
 * - `holdGround` raises the movement penalty and cuts the advance term.
 */
export function weightsFromProfile(profile: EnemyAiProfileDef): UtilityWeights {
  const aggression = clampInt(profile.aggression, 0, 100) / 100;
  const caution = 1 - aggression;
  const ranged = clampInt(profile.rangedBias, 0, 100) / 100;

  return {
    ...DEFAULT_UTILITY_WEIGHTS,
    kill: DEFAULT_UTILITY_WEIGHTS.kill + Math.round(15 * aggression),
    threat: DEFAULT_UTILITY_WEIGHTS.threat + Math.round(2 * aggression),
    flank: DEFAULT_UTILITY_WEIGHTS.flank + Math.round(profile.flankBias / 20),
    elevation: DEFAULT_UTILITY_WEIGHTS.elevation + Math.round(ranged * 2),
    exposure: DEFAULT_UTILITY_WEIGHTS.exposure + Math.round(4 * caution),
    moveCost: profile.holdGround ? 4 : DEFAULT_UTILITY_WEIGHTS.moveCost,
    advance: profile.holdGround
      ? 1
      : DEFAULT_UTILITY_WEIGHTS.advance + Math.round(3 * aggression - 2 * ranged),
  };
}

/**
 * An action the AI may consider: the T086 {@link ForecastAbilitySpec} plus the
 * Article-bearing fields the battle's minimal catalogue omits — an explicit
 * `element`, the weapon family an attack is made with, and any top-level
 * `inflicts` conditions. A full authored `AbilityDef` (T089) is structurally
 * assignable, so content can hand the AI its real definitions and the AI will
 * see exactly the facts the Provost Marshal would judge (T056).
 */
export interface UtilityAbilitySpec extends ForecastAbilitySpec {
  /** Elemental property declared at the action level (`AbilityDef.element`). */
  readonly element?: ElementKey;
  /** Weapon family an attack is made with (`AbilityDef` omits it; content adds it). */
  readonly weaponType?: WeaponType;
  /** Conditions the action inflicts (`AbilityDef.inflicts`). */
  readonly inflicts?: readonly string[];
}

/**
 * Options for the utility AI.
 *
 * Everything is optional: with no options the AI uses {@link
 * DEFAULT_UTILITY_WEIGHTS} and the battle's own action catalogue, which is what
 * the tests and the demo scenario rely on.
 */
export interface UtilityOptions {
  /** Override individual weights; merged over the profile/default block. */
  readonly weights?: Partial<UtilityWeights>;
  /**
   * The actor's authored temperament. When supplied it seeds the weights via
   * {@link weightsFromProfile}; {@link weights} still takes precedence.
   */
  readonly profile?: EnemyAiProfileDef;
  /**
   * Richer action data than the battle's minimal catalogue. Content can pass
   * full {@link UtilityAbilitySpec}s here to expose target rules and effects
   * (heals, buffs, AoE) the catalogue may omit. Falls back to
   * `state.abilities`.
   */
  readonly abilities?: Readonly<Record<string, UtilityAbilitySpec>>;
  /** Hooks passed straight to the T086 forecast (affinities, evasion, reactions). */
  readonly forecast?: ForecastOptions;
  /**
   * The Articles of War in force today (T055/T063). When supplied, the AI
   * rules out any candidate that would breach a forbidding Article, unless the
   * acting soldier holds a **Commission** ({@link commissions}). Omit it — the
   * default — for a law-agnostic AI or a lawless No-Man's Land.
   */
  readonly orders?: BattleOrders;
  /**
   * Soldiers holding a **Commission** (FFTA's Boss Medal, T059), immune to the
   * Court-Martial. A commissioned soldier is not filtered for breaches, so it
   * may break standing orders freely; everyone else avoids them.
   */
  readonly commissions?: Commissions;
}

/** Merge profile/default weights with any explicit override. */
function resolveWeights(options: UtilityOptions): UtilityWeights {
  const base =
    options.profile === undefined ? DEFAULT_UTILITY_WEIGHTS : weightsFromProfile(options.profile);
  return { ...base, ...options.weights };
}

/* --------------------------------------------------------------------------
 * Threat & exposure
 * ------------------------------------------------------------------------ */

/**
 * How dangerous a soldier is to the enemy, as a single integer: its offensive
 * stats (`atk + mag`). It is the yardstick behind both the **kill** and
 * **threat** score terms, so a battery that can level a line outrank a lone
 * picket even when their hit points are equal.
 *
 * A soldier already out of action represents no threat.
 */
export function targetThreat(unit: Unit): number {
  if (isOutOfAction(unit)) return 0;
  return Math.max(0, unit.stats.atk) + Math.max(0, unit.stats.mag);
}

/* --------------------------------------------------------------------------
 * Articles of War
 * ------------------------------------------------------------------------ */

/**
 * Project one action into the {@link ArticleActionView} the T056 rules read.
 * Elements, weapon family and inflicted conditions are gathered from the
 * action-level fields and from every authored effect, so an ability that both
 * strikes with a rifle and inflicts Bleeding exposes both facts. A `condition`
 * effect contributes the condition it applies, matching how resolution will
 * judge it.
 */
function articleActionViewOf(actor: Unit, spec: UtilityAbilitySpec): ArticleActionView {
  const effects: ArticleEffectView[] = [];
  if (spec.inflicts !== undefined && spec.inflicts.length > 0) {
    effects.push({ inflicts: spec.inflicts });
  }
  for (const effect of spec.effects ?? []) {
    switch (effect.kind) {
      case "steel":
      case "powder":
      case "weapon":
        effects.push({
          ...(effect.element === undefined ? {} : { element: effect.element }),
          ...(effect.inflicts === undefined ? {} : { inflicts: effect.inflicts }),
        });
        break;
      case "condition":
        effects.push({ inflicts: [effect.conditionId] });
        break;
      default:
        break;
    }
  }

  return {
    id: spec.id,
    ...(spec.element === undefined ? {} : { element: spec.element }),
    ...(spec.weaponType === undefined ? {} : { weaponType: spec.weaponType }),
    ...(actor.postId === undefined ? {} : { postId: actor.postId }),
    ...(effects.length > 0 ? { effects } : {}),
  };
}

/**
 * The Article facts a candidate exposes: the action's own facts (id, element,
 * weapon family, inflicted conditions and the actor's post) plus the `move`
 * fact when the plan includes a march. A march with no follow-up order exposes
 * only `move` — a hold or wait exposes nothing, so an idle soldier can never be
 * judged as if it had acted.
 *
 * Pure: the soldier and spec are only read. Exported so callers can preview why
 * a plan would be refused (AI traces, a debug overlay).
 */
export function articleSubjectForCandidate(
  actor: Unit,
  spec: UtilityAbilitySpec | null,
  moved: boolean,
): ArticleSubject {
  const base: ArticleSubject =
    spec === null ? {} : articleSubjectOfAction(articleActionViewOf(actor, spec));
  return moved ? { ...base, moved: true } : base;
}

/**
 * The active forbidding Articles a subject would break, in posting order. An
 * absent posting or a **lawless** No-Man's Land (no Provost, mapping §9) yields
 * an empty list — there is no one to judge and nothing to avoid. Reuses the
 * tested T056 {@link detectArticles}, so the AI and the Provost Marshal agree
 * on what a breach is.
 */
export function articleBreaches(
  orders: BattleOrders | undefined,
  subject: ArticleSubject,
): readonly ArticleMatch[] {
  if (orders === undefined || orders.lawless) return [];
  return detectArticles(orders.articles, subject).broken;
}

/** The branded ids of the Articles in a breach list, in posting order. */
function breachedArticleIds(breaches: readonly ArticleMatch[]): ArticleId[] {
  return breaches.map((match) => asArticleId(match.article.id));
}

/** Replace one soldier in the deployed list, preserving order. */
function withUnitAt(state: BattleState, unit: Unit, at: Coord): BattleState {
  const placed: Unit = { ...unit, at: { ...at } };
  return { ...state, units: state.units.map((entry) => (entry.id === unit.id ? placed : entry)) };
}

/** Every tile another soldier currently occupies; the mover's own is ignored. */
function occupiedByOthers(state: BattleState, mover: Unit): Coord[] {
  return state.units
    .filter((unit) => unit.id !== mover.id)
    .map((unit) => ({ x: unit.at.x, y: unit.at.y }));
}

/** The actions the AI may consider, richest source first. */
function abilitySpecs(state: BattleState, options: UtilityOptions): readonly UtilityAbilitySpec[] {
  const source: Readonly<Record<string, ActionSpec | UtilityAbilitySpec>> =
    options.abilities ?? state.abilities;
  return Object.values(source) as readonly UtilityAbilitySpec[];
}

/** The soldier named by `unitId`, or a loud failure (the AI must know its world). */
function requireUnit(state: BattleState, unitId: UnitId, label: string): Unit {
  const unit = findUnit(state, unitId);
  if (unit === undefined) {
    throw new AiError(`${label} "${unitId}" is not deployed in this battle`);
  }
  return unit;
}

/**
 * The expected return fire a soldier would suffer standing on `at`: for each
 * hostile, the single most damaging order it could land on that tile next
 * turn, summed across the hostile side.
 *
 * This reuses the T086 forecast, so "exposure" is measured with the same
 * damage, hit-chance and range rules the battle will actually resolve — no
 * separate threat model can drift from the engine. A hostile is assumed to act
 * from where it currently stands (movement is ignored) and to spend its turn on
 * its best single strike, which keeps the figure honest and the cost bounded.
 *
 * Pure: the battle is copied, never mutated. The actor itself is ignored, so a
 * soldier is never counted as its own threat.
 */
export function exposureAt(
  state: BattleState,
  unit: Unit,
  at: Coord,
  options: UtilityOptions = {},
): number {
  const placedState = withUnitAt(state, unit, at);
  const placed = requireUnit(placedState, unit.id, "soldier");
  const specs = abilitySpecs(placedState, options);

  let total = 0;
  for (const hostile of placedState.units) {
    if (
      hostile.id === placed.id ||
      isOutOfAction(hostile) ||
      !areHostile(hostile.side, placed.side)
    ) {
      continue;
    }

    let worst = 0;
    for (const spec of specs) {
      if (!canAfford(hostile, spec)) continue;
      const forecast = forecastAbility(
        placedState,
        hostile,
        spec,
        { kind: "unit", unitId: placed.id },
        options.forecast,
      );
      if (!forecast.ok) continue;
      const hit = forecast.targets.find((entry) => entry.unitId === placed.id);
      if (hit !== undefined && hit.expectedDamage > worst) worst = hit.expectedDamage;
    }
    total += worst;
  }
  return total;
}

/** Chebyshev-free distance from `at` to the nearest standing hostile, or `0`. */
function nearestHostileDistance(state: BattleState, actor: Unit, at: Coord): number {
  let best = Number.POSITIVE_INFINITY;
  for (const unit of state.units) {
    if (isOutOfAction(unit) || !areHostile(unit.side, actor.side)) continue;
    const distance = manhattanDistance(at, unit.at);
    if (distance < best) best = distance;
  }
  return best === Number.POSITIVE_INFINITY ? 0 : best;
}

/* --------------------------------------------------------------------------
 * Candidate scores
 * ------------------------------------------------------------------------ */

/**
 * The auditable breakdown behind one candidate's {@link CandidateScore.total}.
 * Keeping every term visible makes the AI explainable (and unit-testable): a
 * reviewer can see *why* a stroke was chosen without replaying the arithmetic.
 */
export interface CandidateScore {
  /** Hit-weighted damage the order would deal to hostiles. */
  readonly expectedDamage: number;
  /** Summed {@link targetThreat} of every hostile the order would finish. */
  readonly killThreat: number;
  /** Summed {@link targetThreat} of every hostile the order would damage. */
  readonly engagedThreat: number;
  /** Hit-weighted medicine restored to allies. */
  readonly healing: number;
  /** Hit-weighted damage the order would deal to allies (area fire). */
  readonly friendlyFire: number;
  /** Summed elevation advantage (layers) over engaged targets. */
  readonly elevation: number;
  /** Summed flank/rear points (side = 1, rear = 2) over engaged targets. */
  readonly flank: number;
  /** `1` when the destination tile blocks sight (cover), else `0`. */
  readonly cover: number;
  /** Expected return fire at the destination (see {@link exposureAt}). */
  readonly exposure: number;
  /** Movement points spent reaching the destination. */
  readonly moveCost: number;
  /** Tiles to the nearest hostile (advance plans only; `0` when engaged). */
  readonly proximity: number;
  /** Active forbidding Articles the plan would break, in posting order. */
  readonly breaches: readonly ArticleId[];
  /** `true` when at least one active forbidding Article would be broken. */
  readonly unlawful: boolean;
  /** The weighted total the AI maximises. */
  readonly total: number;
}

/** What a candidate plans to do once it has reached its destination. */
export type UtilityIntent = "act" | "hold" | "advance" | "wait";

/** An evaluated plan: a destination, an optional order, and its score. */
export interface UtilityCandidate {
  /** The acting soldier. */
  readonly unitId: UnitId;
  /** Where the plan would leave the soldier standing. */
  readonly destination: Coord;
  /** Movement points spent reaching {@link destination}. */
  readonly moveCost: number;
  /** The order to use at the destination, or `null` for a march/hold. */
  readonly abilityId: AbilityId | null;
  /** The order's target, when {@link abilityId} is set. */
  readonly target: Target | null;
  /** What the candidate intends to do. */
  readonly intent: UtilityIntent;
  /** The full scoring breakdown. */
  readonly score: CandidateScore;
}

/** Inputs to {@link scoreCandidate}, gathered so the function stays pure. */
interface ScoreInputs {
  readonly state: BattleState;
  readonly actor: Unit;
  readonly destination: Coord;
  readonly moveCost: number;
  readonly exposure: number;
  readonly intent: UtilityIntent;
  readonly forecast: ReturnType<typeof forecastAbility> | null;
  readonly breaches: readonly ArticleMatch[];
  readonly weights: UtilityWeights;
}

/**
 * Score one evaluated plan against the {@link UtilityWeights}, returning the
 * full breakdown. See the module header for the meaning of each term. This is
 * the single place the AI's values live, which is what makes its behaviour
 * tunable and testable.
 */
function scoreCandidate(inputs: ScoreInputs): CandidateScore {
  const { state, actor, destination, moveCost, exposure, intent, forecast, breaches, weights } =
    inputs;

  let expectedDamage = 0;
  let killThreat = 0;
  let engagedThreat = 0;
  let healing = 0;
  let friendlyFire = 0;
  let elevation = 0;
  let flank = 0;

  if (forecast !== null) {
    for (const target of forecast.targets) {
      if (target.hostile) {
        if (target.expectedDamage <= 0) continue;
        expectedDamage += target.expectedDamage;
        const victim = state.units.find((unit) => unit.id === target.unitId);
        if (victim === undefined) continue;
        engagedThreat += targetThreat(victim);
        if (target.lethal) killThreat += targetThreat(victim);
        elevation += heightAt(state.map, destination) - heightAt(state.map, victim.at);
        if (target.facing === "side") flank += 1;
        else if (target.facing === "rear") flank += 2;
      } else {
        healing += target.healing;
        friendlyFire += target.expectedDamage;
      }
    }
  }

  const cover = blocksSightAt(state.map, destination) ? 1 : 0;
  const engaged = expectedDamage > 0 || healing > 0;
  const proximity = engaged ? 0 : nearestHostileDistance(state, actor, destination);

  const total =
    weights.damage * expectedDamage +
    weights.kill * killThreat +
    weights.threat * engagedThreat +
    weights.healing * healing -
    weights.friendlyFire * friendlyFire +
    weights.elevation * elevation +
    weights.flank * flank +
    weights.cover * cover -
    weights.exposure * exposure -
    weights.moveCost * moveCost -
    weights.advance * proximity +
    (intent === "hold" ? weights.brace : 0);

  return {
    expectedDamage,
    killThreat,
    engagedThreat,
    healing,
    friendlyFire,
    elevation,
    flank,
    cover,
    exposure,
    moveCost,
    proximity,
    breaches: breachedArticleIds(breaches),
    unlawful: breaches.length > 0,
    total,
  };
}

/* --------------------------------------------------------------------------
 * Candidate enumeration
 * ------------------------------------------------------------------------ */

/**
 * The {@link Target}s worth trying for `spec` from `actor`. Affiliation comes
 * from the action's authored rule (defaulting to `"enemy"`, matching the
 * forecast); a `"tile"` action is aimed at every occupied tile so clusters and
 * friend/foe alike are considered.
 *
 * Soldiers out of action are skipped — there is nothing to gain from naming a
 * casualty. Order is field order, so candidate ties resolve deterministically.
 */
function targetSelections(state: BattleState, actor: Unit, spec: ForecastAbilitySpec): Target[] {
  const filter = spec.target ?? "enemy";
  const selections: Target[] = [];
  const actorAsTarget: TargetActor = actor;

  for (const unit of state.units) {
    if (isOutOfAction(unit)) continue;
    switch (filter) {
      case "self":
        if (unit.id === actor.id) selections.push({ kind: "self" });
        break;
      case "ally":
        if (isAllyTarget(actorAsTarget, unit)) {
          selections.push({ kind: "unit", unitId: unit.id });
        }
        break;
      case "enemy":
        if (isEnemyTarget(actorAsTarget, unit)) {
          selections.push({ kind: "unit", unitId: unit.id });
        }
        break;
      case "any":
        if (isAllyTarget(actorAsTarget, unit) || isEnemyTarget(actorAsTarget, unit)) {
          selections.push({ kind: "unit", unitId: unit.id });
        }
        break;
      case "tile":
        selections.push({ kind: "tile", at: { x: unit.at.x, y: unit.at.y } });
        break;
    }
  }

  // A `"self"` action always has its own tile to fall back on.
  if (selections.length === 0 && filter === "self") selections.push({ kind: "self" });
  return selections;
}

/** Where a soldier may end its march, cheapest first (deterministic order). */
function destinationsFor(state: BattleState, actor: Unit): { at: Coord; cost: number }[] {
  if (state.hasMovedThisTurn) {
    return [{ at: { x: actor.at.x, y: actor.at.y }, cost: 0 }];
  }
  return reachableWithin(state.map, actor.at, actor.stats.move, {
    climb: actor.stats.jump,
    occupied: occupiedByOthers(state, actor),
  }).map((tile) => ({ at: { x: tile.at.x, y: tile.at.y }, cost: tile.cost }));
}

/** Keep the better of two candidates: strictly higher total, ties to `next`. */
function betterOf(best: UtilityCandidate | null, next: UtilityCandidate): UtilityCandidate {
  if (best === null || next.score.total > best.score.total) return next;
  return best;
}

/* --------------------------------------------------------------------------
 * Commands
 * ------------------------------------------------------------------------ */

/** Build the real, replayable command log for a winning candidate. */
function commandsFor(state: BattleState, actor: Unit, candidate: UtilityCandidate): Command[] {
  const commands: Command[] = [];

  if (!coordEquals(candidate.destination, actor.at)) {
    const route = findPath(state.map, actor.at, candidate.destination, {
      climb: actor.stats.jump,
      occupied: occupiedByOthers(state, actor),
      maxCost: actor.stats.move,
    });
    if (!route.found) return [{ kind: "wait", unitId: actor.id }];
    commands.push({
      kind: "move",
      unitId: actor.id,
      path: route.path.map((at) => ({ x: at.x, y: at.y })),
    });
  }

  if (candidate.abilityId !== null && candidate.target !== null) {
    commands.push({
      kind: "act",
      unitId: actor.id,
      abilityId: candidate.abilityId,
      target: candidate.target,
    });
  } else if (candidate.intent === "hold" && commands.length === 0) {
    commands.push({ kind: "hold", unitId: actor.id });
  } else {
    // A march with no follow-up must close the Orders Tempo turn (T115).
    commands.push({ kind: "wait", unitId: actor.id });
  }

  return commands;
}

/**
 * Guarantee the AI only ever issues orders the engine will accept: if the plan
 * is for the soldier who currently holds the Orders Tempo turn, replay it
 * through `step` and fall back to a plain `wait` the moment the engine refuses
 * a command. Plans for other soldiers (e.g. an ally being previewed before its
 * turn) are returned untouched.
 */
function ensureLegal(state: BattleState, actorId: UnitId, commands: readonly Command[]): Command[] {
  if (state.currentActorId !== actorId) return commands.map(copyCommand);
  let working = state;
  for (const command of commands) {
    const result = step(working, command);
    if (result.rejection !== undefined) {
      return [{ kind: "wait", unitId: actorId }];
    }
    working = result.state;
  }
  return commands.map(copyCommand);
}

/** Deep-copy a command so callers cannot alias engine-bound values. */
function copyCommand(command: Command): Command {
  switch (command.kind) {
    case "move":
      return { kind: "move", unitId: command.unitId, path: command.path.map((at) => ({ ...at })) };
    case "act":
      return {
        kind: "act",
        unitId: command.unitId,
        abilityId: command.abilityId,
        target:
          command.target.kind === "tile"
            ? { kind: "tile", at: { ...command.target.at } }
            : command.target.kind === "unit"
              ? { kind: "unit", unitId: command.target.unitId }
              : { kind: "self" },
      };
    case "wait":
      return { kind: "wait", unitId: command.unitId };
    case "face":
      return { kind: "face", unitId: command.unitId, facing: command.facing };
    case "hold":
      return { kind: "hold", unitId: command.unitId };
    case "volley":
      return {
        kind: "volley",
        unitId: command.unitId,
        abilityId: command.abilityId,
        target:
          command.target.kind === "tile"
            ? { kind: "tile", at: { ...command.target.at } }
            : command.target.kind === "unit"
              ? { kind: "unit", unitId: command.target.unitId }
              : { kind: "self" },
        honour: command.honour,
      };
    case "guardSortie":
      return {
        kind: "guardSortie",
        unitId: command.unitId,
        guardSortieId: command.guardSortieId,
      };
  }
}

/* --------------------------------------------------------------------------
 * The decision
 * ------------------------------------------------------------------------ */

/** A complete turn plan: the orders to issue, and the reasoning behind them. */
export interface TurnPlan {
  /** The soldier the plan is for. */
  readonly unitId: UnitId;
  /** The replayable command log, always legal for the current state. */
  readonly commands: readonly Command[];
  /** Where the plan would leave the soldier standing. */
  readonly destination: Coord;
  /** Movement points spent reaching {@link destination}. */
  readonly moveCost: number;
  /** The order to use, or `null` for a march/hold/wait. */
  readonly abilityId: AbilityId | null;
  /** The order's target, when {@link abilityId} is set. */
  readonly target: Target | null;
  /** What the plan intends to do. */
  readonly intent: UtilityIntent;
  /** The winning candidate's full scoring breakdown. */
  readonly score: CandidateScore;
  /** Active forbidding Articles the plan would break (empty for a clean plan). */
  readonly breaches: readonly ArticleId[];
  /** How many candidates were evaluated (for prompt traces and perf checks). */
  readonly considered: number;
}

/**
 * Plan one soldier's Orders Tempo turn: enumerate every legal march, action and
 * target, score them, and return the best as a replayable command log.
 *
 * The enumeration is:
 * 1. every tile the soldier can reach with its Move (the origin included);
 * 2. every affordable action in the battle's catalogue (or the richer
 *    {@link UtilityOptions.abilities} override);
 * 3. every legal target the action's affiliation rule admits, scored through
 *    the T086 forecast.
 *
 * A march with no follow-up and a brace are also considered, so a soldier with
 * no shot still advances or holds good ground rather than freezing. When the
 * caller supplies the day's posting ({@link UtilityOptions.orders}), every
 * candidate is judged against it and one that would break a forbidding Article
 * is discarded — unless the soldier holds a {@link UtilityOptions.commissions
 * Commission}, in which case it is free to violate. The winner is converted to
 * real commands and replayed through `step` before it is returned
 * ({@link ensureLegal}), so the AI issues only legal orders.
 *
 * ```ts
 * const plan = chooseTurn(battle, battle.currentActorId!);
 * for (const command of plan.commands) battle = step(battle, command).state;
 * ```
 *
 * Throws {@link AiError} only when `unitId` is not deployed — a caller bug, not
 * an in-world rejection.
 */
export function chooseTurn(
  state: BattleState,
  unitId: UnitId,
  options: UtilityOptions = {},
): TurnPlan {
  const actor = requireUnit(state, unitId, "soldier");
  const weights = resolveWeights(options);
  const specs = abilitySpecs(state, options);
  // A commissioned soldier answers to no standing order: it may bank
  // Reprimands freely, so the breach filter is bypassed for it (T059/T096).
  const commissioned = isCommissioned(options.commissions, actor.id);

  const destinations = destinationsFor(state, actor);
  const origin: Coord = { x: actor.at.x, y: actor.at.y };

  const candidates: UtilityCandidate[] = [];
  const consider = (candidate: UtilityCandidate): void => {
    candidates.push(candidate);
  };

  for (const destination of destinations) {
    const placedState = withUnitAt(state, actor, destination.at);
    const placedActor = requireUnit(placedState, actor.id, "soldier");
    const exposure = exposureAt(state, actor, destination.at, options);
    const moved = !coordEquals(destination.at, origin);

    for (const spec of specs) {
      if (!canAfford(placedActor, spec)) continue;
      // Judge the order (and the march to reach it) before aiming it, so an
      // unlawful action is never even targeted at a foe.
      const breaches = articleBreaches(
        options.orders,
        articleSubjectForCandidate(placedActor, spec, moved),
      );
      if (!commissioned && breaches.length > 0) continue;
      for (const target of targetSelections(placedState, placedActor, spec)) {
        const forecast = forecastAbility(placedState, placedActor, spec, target, options.forecast);
        if (!forecast.ok || forecast.targets.length === 0) continue;
        consider({
          unitId: actor.id,
          destination: destination.at,
          moveCost: destination.cost,
          abilityId: spec.id,
          target,
          intent: "act",
          score: scoreCandidate({
            state: placedState,
            actor: placedActor,
            destination: destination.at,
            moveCost: destination.cost,
            exposure,
            intent: "act",
            forecast,
            breaches,
            weights,
          }),
        });
      }
    }

    // A pure advance: evaluate the ground without an order, so a soldier with
    // no shot still closes on the enemy (or avoids an exposed field). A march
    // alone can still breach a "no movement" order, so it is judged too.
    if (!state.hasMovedThisTurn && destination.cost > 0) {
      const breaches = articleBreaches(
        options.orders,
        articleSubjectForCandidate(placedActor, null, true),
      );
      if (commissioned || breaches.length === 0) {
        consider({
          unitId: actor.id,
          destination: destination.at,
          moveCost: destination.cost,
          abilityId: null,
          target: null,
          intent: "advance",
          score: scoreCandidate({
            state: placedState,
            actor: placedActor,
            destination: destination.at,
            moveCost: destination.cost,
            exposure,
            intent: "advance",
            forecast: null,
            breaches,
            weights,
          }),
        });
      }
    }
  }

  // Brace in place — the fallback when no attack presents itself. Standing on
  // the spot and doing nothing can never breach an Article, so it is always
  // available to an uncommissioned soldier.
  consider({
    unitId: actor.id,
    destination: origin,
    moveCost: 0,
    abilityId: null,
    target: null,
    intent: "hold",
    score: scoreCandidate({
      state,
      actor,
      destination: origin,
      moveCost: 0,
      exposure: exposureAt(state, actor, origin, options),
      intent: "hold",
      forecast: null,
      breaches: [],
      weights,
    }),
  });

  // `betterOf` keeps the first candidate on a tie. The hold candidate above is
  // always considered, so the fallback exists only to satisfy the type checker.
  let winner: UtilityCandidate | null = null;
  for (const candidate of candidates) {
    winner = betterOf(winner, candidate);
  }
  if (winner === null) {
    winner = {
      unitId: actor.id,
      destination: origin,
      moveCost: 0,
      abilityId: null,
      target: null,
      intent: "wait",
      score: scoreCandidate({
        state,
        actor,
        destination: origin,
        moveCost: 0,
        exposure: 0,
        intent: "wait",
        forecast: null,
        breaches: [],
        weights,
      }),
    };
  }

  const commands = ensureLegal(state, actor.id, commandsFor(state, actor, winner));

  return {
    unitId: actor.id,
    commands,
    destination: { x: winner.destination.x, y: winner.destination.y },
    moveCost: winner.moveCost,
    abilityId: winner.abilityId,
    target: winner.target,
    intent: winner.intent,
    score: winner.score,
    breaches: winner.score.breaches,
    considered: candidates.length,
  };
}

/**
 * The single next order for a soldier: the **first** command of its
 * {@link chooseTurn} plan. Because a turn's commands are `[move, act]`, the
 * first command is always legal in the current state, which makes this a safe
 * one-step-at-a-time API for a controller loop:
 *
 * ```ts
 * let battle = state;
 * while (battle.phase === "active") {
 *   const command = chooseCommand(battle, battle.currentActorId!);
 *   battle = step(battle, command).state;
 * }
 * ```
 *
 * Use {@link chooseTurn} when the whole plan (and its reasoning) is wanted.
 */
export function chooseCommand(
  state: BattleState,
  unitId: UnitId,
  options: UtilityOptions = {},
): Command {
  const plan = chooseTurn(state, unitId, options);
  return plan.commands[0] ?? { kind: "wait", unitId };
}
