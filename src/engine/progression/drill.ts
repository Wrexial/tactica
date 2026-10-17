/**
 * Drill learning from kit (T048) — FFTA's **AP-by-equipment** loop, rethemed.
 *
 * In FFTA an ability is not bought from a menu: it is **bound to a piece of
 * equipment** and learned by drilling with that gear in battle. When a mission
 * ends the unit's AP reward is credited to the abilities it is currently trying
 * to learn, and once the authored AP cost is met the ability is **mastered** —
 * permanently usable even after the teaching item is removed
 * (`docs/wiki/pages/Final_Fantasy_Tactics_Advance.md`: "characters will receive
 * Ability Points (AP) distributed over their currently equipped abilities …
 * Once a target amount of AP has been accumulated for a given ability, the
 * character will master it"; `docs/wiki/raw/Ability_Points.wiki`: "Ability
 * Points are credited towards any unmastered abilities a unit is trying to
 * learn"). The retheme calls AP **Drill** (mapping §1, §5, §10).
 *
 * ```
 *   EquipmentDef.teaches ──► equippedTeaches(unit) ──► DrillProgress[]
 *                                    │                      (drill / required)
 *                                    ▼
 *   battle award ──► awardDrill(unit, amount, tick) ──► { unit', events[] }
 *                                    │
 *                                    ├─ drillGained  (one per trained ability)
 *                                    └─ abilityLearned (on each mastery)
 * ```
 *
 * ## What "distributed" means here
 *
 * FFTA credits the mission's AP to **every** equipped, unmastered ability, not
 * a split of a pool: equipping several teaching items lets them be learned in
 * parallel, and a duplicate teaching does not double the rate. This module
 * keeps that rule (`awardDrill` gives each distinct ability the full award) and
 * deduplicates kit that teaches the same ability, so the outcome depends only
 * on which abilities are equipped, never on how many copies are.
 *
 * ## Mastery is permanent
 *
 * Progress lives on the {@link Unit} as {@link LearnedAbility} entries
 * (`src/engine/unit.ts`), and {@link learnAbility} makes mastery **sticky**: a
 * later award never clears it, and an ability stays mastered once the teaching
 * item is removed. Partial progress is preserved the same way — re-equipping a
 * part-drilled item resumes from the banked Drill rather than starting over.
 *
 * ## Contract (`agents.md` §2, §3, §7, §9)
 *
 * - **Pure & deterministic** — no DOM, no I/O, no `Math.random`, no `Date`.
 *   Time is the integer Orders Tempo tick; the same unit, award and tick always
 *   produce a byte-identical unit and ordered event list.
 * - **State in, state out** — the input unit is never mutated; every helper
 *   returns a **new** unit plus the ordered {@link BattleEvent}s describing the
 *   change.
 * - **Data-driven** — the abilities and their Drill costs are authored on the
 *   kit (`EquipmentDef.teaches`, `src/data/equipment.ts`); no balance constant
 *   or ability id is baked into this logic.
 * - **Fail fast at the boundary** — malformed awards and ticks are rejected
 *   rather than silently rounded. Unknown/foreign equipment ids are skipped (a
 *   unit may carry fixture kit the data registry does not know), never thrown.
 *
 * Reference: `docs/wiki/pages/Ability_Points.md`,
 * `docs/wiki/raw/Ability_Points.wiki` and
 * `docs/wiki/pages/Final_Fantasy_Tactics_Advance.md`. The per-ability Drill
 * costs themselves are re-authored balance data on the items (mapping §3,
 * `agents.md` §10).
 */

import { getEquipment, isEquipmentKey } from "../../data/equipment";
import { EQUIP_SLOTS, type EquipSlot } from "../../data/schema";
import type { BattleEvent } from "../events";
import { asAbilityId, type AbilityId, type EquipmentId } from "../ids";
import { learnAbility, type LearnedAbility, type Unit } from "../unit";

/* --------------------------------------------------------------------------
 * Shapes
 * ------------------------------------------------------------------------ */

/**
 * One ability currently bound to a unit's kit: what it teaches, where it came
 * from and the Drill required to master it. This is the "equipped, unmastered
 * ability" the battle award is distributed to.
 */
export interface EquippedTeach {
  /** The ability being learned. */
  readonly abilityId: AbilityId;
  /** Drill required to master it from this kit (`EquipmentTeach.ap`). */
  readonly requiredDrill: number;
  /** The item that teaches it. */
  readonly equipmentId: EquipmentId;
  /** The slot that item fills. */
  readonly slot: EquipSlot;
}

/**
 * A snapshot of one equipped ability's Drill progress, for the post-change
 * screen (T052) and barracks UI. `drill` never exceeds `requiredDrill`; a
 * mastered ability sits at the cap.
 */
export interface DrillProgress extends EquippedTeach {
  /** Drill banked toward mastery so far. */
  readonly drill: number;
  /** `true` once `drill >= requiredDrill`; permanent (T048). */
  readonly mastered: boolean;
}

/** The outcome of {@link awardDrill}. */
export interface DrillAwardResult {
  /** The soldier after the award: new Drill totals and any masteries. */
  readonly unit: Unit;
  /** The award credited to each trained ability (the input amount). */
  readonly gained: number;
  /** How many distinct equipped, unmastered abilities received the award. */
  readonly trained: number;
  /** How many abilities this award mastered (`0..trained`). */
  readonly mastered: number;
  /** `drillGained` per trained ability, then `abilityLearned` on each mastery. */
  readonly events: readonly BattleEvent[];
}

/* --------------------------------------------------------------------------
 * Kit bindings
 * ------------------------------------------------------------------------ */

/**
 * Every ability currently bound to the unit's equipment, deduplicated by
 * ability and in a deterministic order: the canonical slot order
 * (`weapon`, `offhand`, `armour`, `head`, `accessory`), then each item's
 * authored `teaches` order. An empty slot, a non-teaching item and an item the
 * data registry does not know all contribute nothing.
 *
 * ```ts
 * equippedTeaches(soldier).map((teach) => teach.abilityId);
 * // ["volley-fire", "parry", "range-the-ground"]
 * ```
 */
export function equippedTeaches(unit: Unit): readonly EquippedTeach[] {
  const teaches: EquippedTeach[] = [];
  const seen = new Set<string>();

  for (const slot of EQUIP_SLOTS) {
    const equipmentId = unit.equipment[slot];
    if (equipmentId === null) continue;
    if (!isEquipmentKey(equipmentId)) continue; // fixture/unknown kit teaches nothing

    for (const teach of getEquipment(equipmentId).teaches) {
      if (seen.has(teach.abilityId)) continue; // duplicate kit does not stack
      seen.add(teach.abilityId);
      teaches.push({
        abilityId: asAbilityId(teach.abilityId),
        requiredDrill: teach.ap,
        equipmentId,
        slot,
      });
    }
  }

  return teaches;
}

/** Whether `abilityId` is already permanently mastered by `unit`. */
export function isMastered(unit: Unit, abilityId: AbilityId): boolean {
  return unit.abilities.some(
    (learned) => learned.abilityId === abilityId && learned.mastered,
  );
}

/** The unit's Drill record for `abilityId`, or `undefined` when never drilled. */
export function learnedAbilityOf(unit: Unit, abilityId: AbilityId): LearnedAbility | undefined {
  return unit.abilities.find((learned) => learned.abilityId === abilityId);
}

/**
 * Every equipped ability that is **not yet mastered** — the set a battle's
 * Drill award is credited to. Mastered abilities are excluded even when their
 * kit is still worn, so Drill never accrues past mastery.
 */
export function unmasteredEquippedTeaches(unit: Unit): readonly EquippedTeach[] {
  return equippedTeaches(unit).filter((teach) => !isMastered(unit, teach.abilityId));
}

/**
 * Drill progress for every ability currently bound to the unit's kit, including
 * ones already mastered (they show at their cap). Abilities mastered from other
 * sources but no longer equipped are not listed — this is a view of the kit.
 */
export function drillProgress(unit: Unit): readonly DrillProgress[] {
  return equippedTeaches(unit).map((teach) => {
    const learned = learnedAbilityOf(unit, teach.abilityId);
    const mastered = learned?.mastered ?? false;
    const drill = mastered
      ? teach.requiredDrill
      : Math.min(learned?.drill ?? 0, teach.requiredDrill);
    return { ...teach, drill, mastered };
  });
}

/* --------------------------------------------------------------------------
 * Awarding Drill
 * ------------------------------------------------------------------------ */

/**
 * Credit a battle's Drill award to every equipped, unmastered ability and apply
 * each mastery the award completes.
 *
 * Each distinct ability receives the **full** `amount` (FFTA learns equipped
 * abilities in parallel; see the module header), so a single call can master
 * several abilities at once. Events are emitted in the deterministic teach
 * order: a `drillGained` per trained ability, followed immediately by an
 * `abilityLearned` when that ability crossed its cost. Progress is capped at
 * the required Drill once mastered.
 *
 * ```ts
 * const { unit: veteran, events } = awardDrill(recruit, 80, tick);
 * // every equipped ability gains 80 Drill; those reaching their cost are learned.
 * ```
 *
 * @throws RangeError when `amount` is not a non-negative integer or `tick` is
 *   not a non-negative integer.
 */
export function awardDrill(unit: Unit, amount: number, tick = 0): DrillAwardResult {
  assertNonNegativeInteger(amount, "drill.amount");
  assertTick(tick);

  if (amount === 0) {
    return { unit, gained: 0, trained: 0, mastered: 0, events: [] };
  }

  const teachings = unmasteredEquippedTeaches(unit);
  if (teachings.length === 0) {
    return { unit, gained: 0, trained: 0, mastered: 0, events: [] };
  }

  let current = unit;
  let masteredCount = 0;
  const events: BattleEvent[] = [];

  for (const teach of teachings) {
    const before = learnedAbilityOf(current, teach.abilityId)?.drill ?? 0;
    const raw = before + amount;
    const mastered = raw >= teach.requiredDrill;
    const drillAfter = mastered ? teach.requiredDrill : raw;

    current = learnAbility(current, {
      abilityId: teach.abilityId,
      drill: drillAfter,
      mastered,
    });
    events.push({
      kind: "drillGained",
      tick,
      unitId: unit.id,
      abilityId: teach.abilityId,
      amount,
      drillAfter,
      mastered,
    });
    if (mastered) {
      masteredCount += 1;
      events.push({
        kind: "abilityLearned",
        tick,
        unitId: unit.id,
        abilityId: teach.abilityId,
      });
    }
  }

  return {
    unit: current,
    gained: amount,
    trained: teachings.length,
    mastered: masteredCount,
    events,
  };
}

/**
 * Award the same battle Drill to a whole party, one {@link DrillAwardResult} per
 * soldier in the order supplied. A convenience for the mission-reward step
 * (T079): each unit learns from its own kit independently, and no state is
 * shared between soldiers.
 */
export function awardBattleDrill(
  units: readonly Unit[],
  amount: number,
  tick = 0,
): readonly DrillAwardResult[] {
  return units.map((unit) => awardDrill(unit, amount, tick));
}

/* --------------------------------------------------------------------------
 * Validation helpers
 * ------------------------------------------------------------------------ */

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer, received ${String(value)}`);
  }
}

function assertTick(tick: number): void {
  if (!Number.isInteger(tick) || tick < 0) {
    throw new RangeError(
      `drill.tick must be a non-negative integer, received ${String(tick)}`,
    );
  }
}
