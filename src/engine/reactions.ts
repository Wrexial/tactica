/**
 * Reaction abilities (T042) — the **trigger hooks** that let a soldier answer an
 * incoming action without spending their own Orders Tempo turn.
 *
 * FFTA gives every unit one reaction slot (an *R-Ability*). A reaction is not
 * declared by a command; it **fires on a trigger** produced by somebody else's
 * action. The retheme keeps the mechanic and renames the classic four
 * (`docs/NAPOLEONIC_MAPPING.md` §6, mapping §12):
 *
 * | FFTA | Tactica | Fiction | Trigger | Timing |
 * | ---- | ------- | ------- | ------- | ------ |
 * | Counter | **Riposte** | Answer a bayonet with the blade | hostile **Steel** hit, attacker in reach | after damage |
 * | Return Magic | **Return Fire** | Give the battery its own case shot back | hostile **Powder** hit, attacker in reach | after damage |
 * | Reflex | **Dodge** | Step inside the muzzle's arc | any hostile attack | before damage |
 * | Auto-Potion | **Field Dressing** | Slap a bandage on under fire | wounded below the dressing line | after damage |
 *
 * ## How the hooks fit the engine
 *
 * The action executor (`./actions/ability.ts`, T041) resolves an action into
 * ordered {@link BattleEvent}s — `damaged`, `missed`, and so on. A reaction
 * does not open a new turn; it *piggybacks* on those events. The combat layer
 * therefore drives reactions in two phases:
 *
 * ```text
 *   incoming = incomingTrigger(state, attacker, defender, spec)  // Dodge
 *        │  resolveReactionDefense(state, incoming, rng, options)
 *        │      └─ negated? skip the attack entirely
 *        ▼
 *   executeAbility(...)   ──► { state', events[] }               // T041
 *        │  resolveReactionResponses(state', events, rng, options)
 *        └─ Riposte / Return Fire / Field Dressing answer the damage
 * ```
 *
 * Both resolvers are pure, deterministic and **do not mutate** their inputs.
 * Offensive reactions reuse the T041 executor unchanged (so Steel/Powder maths,
 * the hit roll and conditions all behave identically to a normal action); the
 * module only decides *whether* a reaction fires and emits the
 * `reactionTriggered` event that opens it.
 *
 * ## One reaction per trigger, no chains
 *
 * {@link resolveReactionResponses} resolves at most one reaction per damaged
 * soldier per provoking event and deliberately does **not** feed the events its
 * own reactions produced back into itself. That keeps a Riposte exchange from
 * looping forever and keeps the PRNG stream bounded and reproducible
 * (`agents.md` §2).
 *
 * ## Data-driven & layered (`agents.md` §2, §7, §9)
 *
 * - **Engine purity** — no DOM, no I/O, no `Math.random`, no `Date`. The only
 *   randomness is the caller's seeded {@link Rng}.
 * - **Data-driven** — the numbers (reach, power, chance, dressing threshold)
 *   are exported balance constants, not literals buried in a branch; content
 *   may over-supply its own {@link AbilitySpec}s for the offensive reactions.
 * - **Equipped, not hard-coded** — which reaction a soldier carries arrives via
 *   {@link ReactionOptions}, mirroring FFTA's single R-Ability slot. The unit
 *   model gains that slot in T051; until then the caller (or a test) supplies a
 *   loadout.
 *
 * Reference: `docs/wiki/pages/Final_Fantasy_Tactics_Advance_reaction_abilities.md`
 * (the trigger table) and mapping §6/§12. Fiction follows
 * `docs/NAPOLEONIC_MAPPING.md` ("Counter → Riposte; Return Magic → Return Fire;
 * Reflex → Dodge; Auto-Potion → Field Dressing").
 */

import type { ElementKey } from "../data/schema";
import {
  executeAbility,
  type AbilityExecutionOptions,
  type AbilitySpec,
} from "./actions/ability";
import type { BattleState } from "./battle";
import type { BattleEvent, DamagedEvent, DamageType } from "./events";
import { manhattanDistance } from "./grid";
import { asAbilityId, type AbilityId, type UnitId } from "./ids";
import { areHostile } from "./targeting";
import type { Rng } from "./rng";
import { isOutOfAction, type Unit } from "./unit";

/* --------------------------------------------------------------------------
 * Reaction identity
 * ------------------------------------------------------------------------ */

/** The four reaction hooks the retheme keeps (mapping §6). */
export const REACTION_KINDS = ["riposte", "returnFire", "dodge", "fieldDressing"] as const;
export type ReactionKind = (typeof REACTION_KINDS)[number];

/** Runtime guard for untrusted reaction-kind strings (UI, saves). */
export function isReactionKind(value: unknown): value is ReactionKind {
  return typeof value === "string" && (REACTION_KINDS as readonly string[]).includes(value);
}

/**
 * The FFTA-shaped ability id of each reaction. They are authored as engine
 * constants because the mechanical identity is fixed; display text (name,
 * flavour) belongs to `src/data/` when the full ability catalogue lands (T089).
 */
export const REACTION_IDS: Readonly<Record<ReactionKind, AbilityId>> = {
  riposte: asAbilityId("riposte"),
  returnFire: asAbilityId("return-fire"),
  dodge: asAbilityId("dodge"),
  fieldDressing: asAbilityId("field-dressing"),
};

/** Resolve an equipped ability id to a reaction kind, or `undefined`. */
export function reactionKindOf(id: AbilityId | string): ReactionKind | undefined {
  for (const kind of REACTION_KINDS) {
    if (REACTION_IDS[kind] === id) return kind;
  }
  return undefined;
}

/* --------------------------------------------------------------------------
 * Authored balance data (Phase 13 owns the final pass)
 * ------------------------------------------------------------------------ */

/**
 * Power term of a **Riposte** counter (mapping §6). FFTA's Counter answers at
 * reduced strength; half power is the retheme's authored value, not a scraped
 * one (`agents.md` §3, §10). Content may override via
 * {@link ReactionOptions.abilities}.
 */
export const RIPOSTE_POWER = 50;

/** Reach of a Riposte in tiles — a blade counter only answers an adjacent foe. */
export const RIPOSTE_RANGE = 1;

/**
 * Power term of a **Return Fire** answer. The retheme returns the incoming
 * Powder at full strength, so it matches the original ability's power term.
 */
export const RETURN_FIRE_POWER = 100;

/** Reach of a Return Fire riposte in tiles (a firing line's own reach). */
export const RETURN_FIRE_RANGE = 4;

/** Medicine power of a **Field Dressing** bandage (T036 healing formula). */
export const FIELD_DRESSING_POWER = 100;

/**
 * Fraction of maximum hit points at or below which **Field Dressing** fires.
 * `0.5` means a soldier dresses a wound once they are at or below half strength;
 * re-authored balance data (`agents.md` §3, §10).
 */
export const FIELD_DRESSING_HP_RATIO = 0.5;

/**
 * Chance, in whole percent, that a **Dodge** completely negates an incoming
 * attack. Authored balance data — FFTA's Reflex is absolute, but an absolute
 * dodge would trivialise the game, so the retheme gives it a roll
 * (`agents.md` §3, §10). Content may override via
 * {@link ReactionOptions.dodgeChance}.
 */
export const DODGE_CHANCE = 50;

/* --------------------------------------------------------------------------
 * Default reaction abilities
 * ------------------------------------------------------------------------ */

/**
 * Build a no-cost, instant {@link AbilitySpec} for a reaction. Reactions never
 * cost Élan or Orders Tempo (they are not the unit's own action), and they
 * never charge — the trigger is the timing.
 */
function reactionSpec(
  kind: ReactionKind,
  overrides: Partial<AbilitySpec> & Pick<AbilitySpec, "target" | "effects">,
): AbilitySpec {
  return {
    id: REACTION_IDS[kind],
    mpCost: 0,
    chargeTime: 0,
    power: 0,
    range: 0,
    hitRate: 100,
    ...overrides,
  };
}

/**
 * The default {@link AbilitySpec} for each reaction, expressed through the T041
 * effect vocabulary so a reaction resolves exactly like an authored action.
 *
 * - **Riposte** — a `steel` counter at {@link RIPOSTE_POWER}.
 * - **Return Fire** — a `powder` answer at {@link RETURN_FIRE_POWER}.
 * - **Field Dressing** — a self `heal` at {@link FIELD_DRESSING_POWER}.
 * - **Dodge** — no effects; it is resolved before damage, not through the
 *   executor.
 */
export const DEFAULT_REACTION_ABILITIES: Readonly<Record<ReactionKind, AbilitySpec>> = {
  riposte: reactionSpec("riposte", {
    range: RIPOSTE_RANGE,
    power: RIPOSTE_POWER,
    target: "enemy",
    effects: [{ kind: "steel", power: RIPOSTE_POWER }],
  }),
  returnFire: reactionSpec("returnFire", {
    range: RETURN_FIRE_RANGE,
    power: RETURN_FIRE_POWER,
    target: "enemy",
    effects: [{ kind: "powder", power: RETURN_FIRE_POWER }],
  }),
  dodge: reactionSpec("dodge", {
    range: 0,
    target: "self",
    effects: [],
  }),
  fieldDressing: reactionSpec("fieldDressing", {
    range: 0,
    power: FIELD_DRESSING_POWER,
    target: "self",
    effects: [{ kind: "heal", power: FIELD_DRESSING_POWER }],
  }),
};

/* --------------------------------------------------------------------------
 * Triggers
 * ------------------------------------------------------------------------ */

/**
 * When a reaction fires relative to the incoming blow. **Dodge** is the only
 * `"beforeDamage"` hook; the answers (Riposte, Return Fire, Field Dressing)
 * need to know whether the blow landed, so they fire `"afterDamage"`.
 */
export const REACTION_PHASES = ["beforeDamage", "afterDamage"] as const;
export type ReactionPhase = (typeof REACTION_PHASES)[number];

/**
 * A provocation: everything a trigger predicate and a resolver need to decide
 * whether a soldier reacts and how. It is a plain value built from an incoming
 * attack ({@link incomingTrigger}) or a landed `damaged` event
 * ({@link triggerFromDamage}).
 */
export interface ReactionTrigger {
  /** Whether the hook runs before or after the damage is applied. */
  readonly phase: ReactionPhase;
  /** The soldier who may react — the target of the incoming action. */
  readonly reactorId: UnitId;
  /** The soldier who provoked it, when known. */
  readonly sourceId?: UnitId;
  /** The provoking ability, when known. */
  readonly abilityId?: AbilityId;
  /** Steel / Powder / none channel of the incoming action. */
  readonly channel: DamageType;
  /** Element of the incoming action, when elemental (mapping §7). */
  readonly element?: ElementKey;
  /** Whether the source is on a hostile side. */
  readonly hostile: boolean;
  /** Hit points the blow dealt (`0` before damage or on a miss). */
  readonly amount: number;
  /** The reactor's hit points after the blow (current HP before damage). */
  readonly hpAfter: number;
  /** The reactor's maximum hit points (for the dressing threshold). */
  readonly reactorMaxHp: number;
  /** Whether the blow left the reactor out of action. */
  readonly fatal: boolean;
  /** Tiles between reactor and source; `Number.POSITIVE_INFINITY` if unknown. */
  readonly distance: number;
}

/**
 * Classify the damage channel an action will deliver, from its authored effects:
 * a `powder` or HP `drain` effect is Powder; a `steel` or `weapon` effect is
 * Steel; anything else (buffs, medicine, pure conditions) is `"none"`.
 *
 * Used to build a before-damage trigger for a spec the executor has not run yet.
 */
export function damageChannelOf(spec: AbilitySpec): DamageType {
  let steel = false;
  for (const effect of spec.effects) {
    if (effect.kind === "powder") return "powder";
    if (effect.kind === "drain") return "powder";
    if (effect.kind === "steel" || effect.kind === "weapon") steel = true;
  }
  return steel ? "steel" : "none";
}

/** The first elemental property an action's effects declare, if any. */
function elementOf(spec: AbilitySpec): ElementKey | undefined {
  for (const effect of spec.effects) {
    if ("element" in effect && effect.element !== undefined) return effect.element;
  }
  return undefined;
}

/** The reactor's maximum hit points, guarded against a malformed stat block. */
function maxHpOf(unit: Unit): number {
  return Math.max(0, unit.stats.hp);
}

/**
 * Build the **before-damage** trigger for an incoming attack, so a defender's
 * Dodge hook can be consulted *before* the executor rolls and lands it. Returns
 * `undefined` when either soldier is no longer deployed.
 *
 * ```ts
 * const trigger = incomingTrigger(battle, attacker.id, defender.id, ability);
 * const defense = resolveReactionDefense(battle, trigger!, rng, { loadout });
 * if (defense.negated) return; // the shot is cleanly dodged
 * ```
 */
export function incomingTrigger(
  state: BattleState,
  attackerId: UnitId,
  defenderId: UnitId,
  ability: AbilitySpec,
): ReactionTrigger | undefined {
  const attacker = state.units.find((unit) => unit.id === attackerId);
  const defender = state.units.find((unit) => unit.id === defenderId);
  if (attacker === undefined || defender === undefined) return undefined;

  const element = elementOf(ability);

  return {
    phase: "beforeDamage",
    reactorId: defender.id,
    sourceId: attacker.id,
    abilityId: ability.id,
    channel: damageChannelOf(ability),
    ...(element === undefined ? {} : { element }),
    hostile: areHostile(attacker.side, defender.side),
    amount: 0,
    hpAfter: defender.hp,
    reactorMaxHp: maxHpOf(defender),
    fatal: false,
    distance: manhattanDistance(attacker.at, defender.at),
  };
}

/**
 * Build the **after-damage** trigger from a landed damage event, so the
 * answering reactions (Riposte, Return Fire, Field Dressing) can inspect what
 * actually happened. Returns `undefined` for a non-damage event or a soldier no
 * longer deployed.
 *
 * `phase` defaults to `"afterDamage"`; callers may build a before-damage view by
 * passing `"beforeDamage"` explicitly (used by tests and the forecast UI).
 */
export function triggerFromDamage(
  state: BattleState,
  event: BattleEvent,
  phase: ReactionPhase = "afterDamage",
): ReactionTrigger | undefined {
  if (event.kind !== "damaged") return undefined;
  const damage = event as DamagedEvent;
  const reactor = state.units.find((unit) => unit.id === damage.unitId);
  if (reactor === undefined) return undefined;

  const source =
    damage.sourceId === undefined
      ? undefined
      : state.units.find((unit) => unit.id === damage.sourceId);

  return {
    phase,
    reactorId: reactor.id,
    ...(damage.sourceId === undefined ? {} : { sourceId: damage.sourceId }),
    ...(damage.abilityId === undefined ? {} : { abilityId: damage.abilityId }),
    channel: damage.damageType,
    ...(damage.element === undefined ? {} : { element: damage.element }),
    hostile: source === undefined ? false : areHostile(source.side, reactor.side),
    amount: damage.amount,
    hpAfter: damage.hpAfter,
    reactorMaxHp: maxHpOf(reactor),
    fatal: damage.fatal,
    distance:
      source === undefined
        ? Number.POSITIVE_INFINITY
        : manhattanDistance(source.at, reactor.at),
  };
}

/* --------------------------------------------------------------------------
 * Reaction definitions (trigger predicates)
 * ------------------------------------------------------------------------ */

/**
 * The trigger predicate and metadata of one reaction. `triggers` is pure: the
 * same trigger always yields the same answer, so the forecast UI (T086) can ask
 * "would this provoke a reaction?" without touching the world.
 */
export interface ReactionDef {
  /** Which of the four hooks this is. */
  readonly kind: ReactionKind;
  /** FFTA-shaped ability id the unit equips. */
  readonly id: AbilityId;
  /** Napoleonic display name (mapping §6). */
  readonly name: string;
  /** One-line description for menus and the combat log. */
  readonly description: string;
  /** When the hook runs relative to the damage. */
  readonly phase: ReactionPhase;
  /** Whether this reaction fires for a given provocation. */
  readonly triggers: (trigger: ReactionTrigger) => boolean;
}

/**
 * **Riposte** fires after a hostile **Steel** blow lands, while the reactor is
 * still standing and the attacker is within {@link RIPOSTE_RANGE} tiles. A
 * Powder hit, a fatal blow or an out-of-reach attacker does not provoke it.
 */
export function riposteTriggers(trigger: ReactionTrigger): boolean {
  return (
    trigger.phase === "afterDamage" &&
    trigger.hostile &&
    trigger.channel === "steel" &&
    trigger.sourceId !== undefined &&
    !trigger.fatal &&
    trigger.distance <= RIPOSTE_RANGE
  );
}

/**
 * **Return Fire** fires after a hostile **Powder** blow lands, while the
 * reactor is still standing and the attacker is within
 * {@link RETURN_FIRE_RANGE} tiles. It answers the shot in kind.
 */
export function returnFireTriggers(trigger: ReactionTrigger): boolean {
  return (
    trigger.phase === "afterDamage" &&
    trigger.hostile &&
    trigger.channel === "powder" &&
    trigger.sourceId !== undefined &&
    !trigger.fatal &&
    trigger.distance <= RETURN_FIRE_RANGE
  );
}

/**
 * **Dodge** is offered before a hostile Steel or Powder attack resolves. It is
 * the only `"beforeDamage"` hook; the actual negation is a seeded roll decided
 * by {@link resolveReactionDefense}.
 */
export function dodgeTriggers(trigger: ReactionTrigger): boolean {
  return (
    trigger.phase === "beforeDamage" &&
    trigger.hostile &&
    trigger.sourceId !== undefined &&
    (trigger.channel === "steel" || trigger.channel === "powder")
  );
}

/**
 * **Field Dressing** fires after a non-fatal hostile hit leaves the reactor at
 * or below {@link FIELD_DRESSING_HP_RATIO} of full strength, so a soldier with
 * a bandage tends a wound once they are badly enough hurt.
 */
export function fieldDressingTriggers(trigger: ReactionTrigger): boolean {
  if (
    trigger.phase !== "afterDamage" ||
    !trigger.hostile ||
    trigger.fatal ||
    trigger.amount <= 0 ||
    trigger.hpAfter <= 0
  ) {
    return false;
  }
  const threshold = Math.floor(trigger.reactorMaxHp * FIELD_DRESSING_HP_RATIO);
  return trigger.hpAfter <= threshold;
}

/** The four reaction definitions, keyed by kind (mapping §6). */
export const REACTIONS: Readonly<Record<ReactionKind, ReactionDef>> = {
  riposte: {
    kind: "riposte",
    id: REACTION_IDS.riposte,
    name: "Riposte",
    description: "Answer a hostile Steel blow with a blade of your own.",
    phase: "afterDamage",
    triggers: riposteTriggers,
  },
  returnFire: {
    kind: "returnFire",
    id: REACTION_IDS.returnFire,
    name: "Return Fire",
    description: "Return an incoming Powder attack to the soldier who fired it.",
    phase: "afterDamage",
    triggers: returnFireTriggers,
  },
  dodge: {
    kind: "dodge",
    id: REACTION_IDS.dodge,
    name: "Dodge",
    description: "Slip an incoming attack entirely.",
    phase: "beforeDamage",
    triggers: dodgeTriggers,
  },
  fieldDressing: {
    kind: "fieldDressing",
    id: REACTION_IDS.fieldDressing,
    name: "Field Dressing",
    description: "Bandage your own wound the moment it is opened.",
    phase: "afterDamage",
    triggers: fieldDressingTriggers,
  },
};

/** The reaction a soldier carries, or `undefined` when the slot is empty. */
export interface ReactionOptions {
  /**
   * One equipped reaction per soldier, keyed by unit id (FFTA's single
   * R-Ability slot). Until the unit model gains that slot (T051), the caller
   * supplies it here.
   */
  readonly loadout?: Readonly<Record<string, AbilityId | ReactionKind>>;
  /** Alternative lookup; takes precedence over {@link loadout} when present. */
  readonly reactionOf?: (unit: Unit) => AbilityId | ReactionKind | undefined;
  /**
   * Override the default offensive/medical reaction specs
   * ({@link DEFAULT_REACTION_ABILITIES}) — e.g. an ability-awarded stronger
   * Riposte. Only the properties supplied are replaced.
   */
  readonly abilities?: Partial<Readonly<Record<ReactionKind, AbilitySpec>>>;
  /** Override the Dodge chance for this resolution; defaults to `DODGE_CHANCE`. */
  readonly dodgeChance?: number;
  /**
   * Hooks forwarded to the action executor (T041) for offensive reactions —
   * elemental affinities and a dedicated evasion stat. Keeps reactions
   * consistent with the rest of combat.
   */
  readonly execution?: AbilityExecutionOptions;
}

/** Coerce a loadout entry (id or kind) to a reaction kind. */
function asReactionKind(value: AbilityId | ReactionKind | undefined): ReactionKind | undefined {
  if (value === undefined) return undefined;
  return isReactionKind(value) ? value : reactionKindOf(value);
}

/** The reaction kind a soldier has equipped under `options`, if any. */
export function equippedReaction(
  unit: Unit,
  options: ReactionOptions = {},
): ReactionKind | undefined {
  const explicit = options.reactionOf?.(unit);
  if (explicit !== undefined) return asReactionKind(explicit);
  return asReactionKind(options.loadout?.[unit.id]);
}

/**
 * Every reaction kind whose **trigger** matches, in authored order. This is a
 * pure forecast helper (T086): it answers "which reactions could answer this
 * blow?" without consulting any loadout or touching the world.
 */
export function reactionKindsFor(trigger: ReactionTrigger): readonly ReactionKind[] {
  return REACTION_KINDS.filter((kind) => REACTIONS[kind].triggers(trigger));
}

/**
 * The single reaction a specific soldier would fire for `trigger`, or
 * `undefined` when their slot is empty or its trigger does not match.
 */
export function reactionForUnit(
  unit: Unit,
  trigger: ReactionTrigger,
  options: ReactionOptions = {},
): ReactionKind | undefined {
  const kind = equippedReaction(unit, options);
  if (kind === undefined || !REACTIONS[kind].triggers(trigger)) return undefined;
  return kind;
}

/* --------------------------------------------------------------------------
 * Result shapes
 * ------------------------------------------------------------------------ */

/** The outcome of the pre-damage (Dodge) hook. */
export interface ReactionDefenseResult {
  /** `true` when the incoming attack is completely avoided. */
  readonly negated: boolean;
  /** The reaction that fired, when one did. */
  readonly reactionId?: AbilityId;
  /** The battle after the hook (unchanged for a dodge — no damage landed). */
  readonly state: BattleState;
  /** The `reactionTriggered` event, when the dodge succeeded. */
  readonly events: readonly BattleEvent[];
}

/** The outcome of the post-damage (Riposte / Return Fire / Field Dressing) hooks. */
export interface ReactionResponseResult {
  /** The battle after every answering reaction landed. */
  readonly state: BattleState;
  /** Reaction events only, in resolution order (provoking events excluded). */
  readonly events: readonly BattleEvent[];
  /** The ability ids of every reaction that fired, in order. */
  readonly triggered: readonly AbilityId[];
}

/* --------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------ */

/** The `reactionTriggered` opener for a reaction at `at`. */
function reactionEvent(
  tick: number,
  unitId: UnitId,
  abilityId: AbilityId,
  at: { x: number; y: number },
  sourceId?: UnitId,
): BattleEvent {
  return {
    kind: "reactionTriggered",
    tick,
    unitId,
    abilityId,
    ...(sourceId === undefined ? {} : { sourceId }),
    at: { x: at.x, y: at.y },
  };
}

/** Merge an author-supplied spec over the default reaction spec. */
function abilityFor(kind: ReactionKind, options: ReactionOptions): AbilitySpec {
  const defaults = DEFAULT_REACTION_ABILITIES[kind];
  const override = options.abilities?.[kind];
  return override === undefined ? defaults : { ...defaults, ...override };
}

/* --------------------------------------------------------------------------
 * Pre-damage hook — Dodge
 * ------------------------------------------------------------------------ */

/**
 * Consult a defender's **Dodge** before an attack resolves. If the soldier
 * carries Dodge, the trigger is right and the seeded roll succeeds, the attack
 * is negated: the state is returned unchanged and a single `reactionTriggered`
 * event is emitted. The caller must then skip the action's effect (`agents.md`
 * §2 — the same seed always produces the same dodge).
 *
 * The roll is drawn **only** when a Dodge is actually attempted, so an army
 * without the reaction burns no PRNG values. `trigger` must be a
 * `"beforeDamage"` trigger (see {@link incomingTrigger}).
 *
 * ```ts
 * const trigger = incomingTrigger(battle, moss.id, cuirassier.id, shot);
 * const defense = resolveReactionDefense(battle, trigger!, new Rng(battle.seed), {
 *   loadout: { [cuirassier.id]: "dodge" },
 * });
 * if (defense.negated) continue; // the musket ball goes wide
 * ```
 *
 * Throws a `RangeError` when a supplied `dodgeChance` is not an integer within
 * `[0, 100]`.
 */
export function resolveReactionDefense(
  state: BattleState,
  trigger: ReactionTrigger,
  rng: Rng,
  options: ReactionOptions = {},
): ReactionDefenseResult {
  const chance = options.dodgeChance ?? DODGE_CHANCE;
  assertChance(chance, "dodgeChance");

  const reactor = state.units.find((unit) => unit.id === trigger.reactorId);
  if (reactor === undefined || isOutOfAction(reactor)) {
    return { negated: false, state, events: [] };
  }

  const kind = equippedReaction(reactor, options);
  if (kind !== "dodge" || !REACTIONS.dodge.triggers(trigger)) {
    return { negated: false, state, events: [] };
  }

  if (rng.nextInt(100) >= chance) {
    return { negated: false, state, events: [] };
  }

  return {
    negated: true,
    reactionId: REACTIONS.dodge.id,
    state,
    events: [
      reactionEvent(
        state.tempo.tick,
        reactor.id,
        REACTIONS.dodge.id,
        reactor.at,
        trigger.sourceId,
      ),
    ],
  };
}

/* --------------------------------------------------------------------------
 * Post-damage hooks — Riposte / Return Fire / Field Dressing
 * ------------------------------------------------------------------------ */

/**
 * Answer the hostile blows described by `provoking` (the events an action
 * executor just produced). Walks the events in order; for each landed `damaged`
 * event, at most one reaction fires for the wounded soldier — whichever of
 * Riposte, Return Fire or Field Dressing they carry and whose trigger matches.
 *
 * Offensive reactions (**Riposte**, **Return Fire**) run through the T041
 * executor against the original attacker; **Field Dressing** heals the soldier
 * in place. Each fired reaction prepends a `reactionTriggered` event, and the
 * returned `state` is the world after every answer landed.
 *
 * The resolver is deliberately shallow: it never re-scans the events its own
 * reactions produced, so a counter cannot provoke a counter ad infinitum. The
 * returned `events` are the reaction events only; concatenate the provoking
 * events yourself to keep the log chronological.
 *
 * ```ts
 * let battle = createBattle(seed, setup);
 * const first = executeAbility(battle, actor, blade, unitTarget(foe.id), rng);
 * battle = first.state;
 * const answers = resolveReactionResponses(battle, first.events, rng, {
 *   loadout: { [foe.id]: "riposte" },
 * });
 * battle = answers.state;
 * const log = [...first.events, ...answers.events];
 * ```
 *
 * Never mutates its inputs; throws a `RangeError` only for malformed authored
 * data (an invalid Dodge chance or reaction spec), which the executor validates.
 */
export function resolveReactionResponses(
  state: BattleState,
  provoking: readonly BattleEvent[],
  rng: Rng,
  options: ReactionOptions = {},
): ReactionResponseResult {
  let working = state;
  const events: BattleEvent[] = [];
  const triggered: AbilityId[] = [];

  for (const provokingEvent of provoking) {
    const trigger = triggerFromDamage(working, provokingEvent, "afterDamage");
    if (trigger === undefined || trigger.sourceId === undefined) continue;

    const reactor = working.units.find((unit) => unit.id === trigger.reactorId);
    if (reactor === undefined || isOutOfAction(reactor)) continue;

    const kind = equippedReaction(reactor, options);
    if (kind === undefined || kind === "dodge") continue;
    if (!REACTIONS[kind].triggers(trigger)) continue;

    const source = working.units.find((unit) => unit.id === trigger.sourceId);
    if (source === undefined) continue;

    const spec = abilityFor(kind, options);
    const target: { kind: "unit"; unitId: UnitId } | { kind: "self" } =
      kind === "fieldDressing"
        ? { kind: "self" }
        : { kind: "unit", unitId: source.id };

    const execution = executeAbility(
      working,
      reactor,
      spec,
      target,
      rng,
      options.execution ?? {},
    );
    if (!execution.ok) continue;

    events.push(
      reactionEvent(
        working.tempo.tick,
        reactor.id,
        REACTIONS[kind].id,
        reactor.at,
        source.id,
      ),
    );
    events.push(...execution.events);
    triggered.push(REACTIONS[kind].id);
    working = execution.state;
  }

  return { state: working, events, triggered };
}

/* --------------------------------------------------------------------------
 * Validation helpers
 * ------------------------------------------------------------------------ */

function assertChance(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new RangeError(
      `${label} must be an integer within [0, 100], received ${String(value)}`,
    );
  }
}
