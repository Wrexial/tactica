/**
 * Unit labels & stat chips (T134) — the pure, DOM-free data behind the
 * per-character battlefield card.
 *
 * The battlefield HUD shows a card for the soldier under the cursor, the
 * selected soldier, or whichever soldier holds the Orders Tempo turn (peer
 * lesson L16, FFT Blue's `BattleScene.showUnitInfo`). The card's *content* is
 * entirely a function of the engine {@link Unit} plus the i18n catalog, so the
 * mapping lives here rather than in the React view: `UnitCard.tsx` paints it,
 * `StatChips.tsx` paints the vitals, and `tests/unit/unitLabels.test.ts` pins
 * the transfer in Node without a canvas.
 *
 * ## Contract (`agents.md` §2, §7, §9)
 *
 * - **Presentation only.** These helpers read a unit and return display keys /
 *   values; they never mutate engine state and invent no rules.
 * - **Data, not branches.** A new great power, role family or condition needs a
 *   catalog entry or a `src/data/` row, never a new `if` here.
 * - **Napoleonic fiction.** Player-facing strings are catalog keys; the maps
 *   mirror the vocabulary in `docs/NAPOLEONIC_MAPPING.md` (military school,
 *   post, side, conditions).
 */

import { CONDITIONS, type ConditionKey } from "../data/conditions";
import type { PowerKey } from "../data/schema";
import type { Unit, UnitSide } from "../engine/unit";
import type { MessageKey } from "../i18n";
import { roleCategory, type RoleCategory } from "../render/units";

/* --------------------------------------------------------------------------
 * Label keys (presentation only; no balance values)
 * ------------------------------------------------------------------------ */

/** Catalog keys for the five great-power military schools (mapping §2). */
export const POWER_LABEL_KEYS: Readonly<Record<PowerKey, MessageKey>> = {
  france: "power.france",
  britain: "power.britain",
  prussia: "power.prussia",
  russia: "power.russia",
  austria: "power.austria",
};

/** Catalog keys for the coarse role families (mapping §3). */
export const ROLE_LABEL_KEYS: Readonly<Record<RoleCategory, MessageKey>> = {
  line: "role.line",
  skirmisher: "role.skirmisher",
  cavalry: "role.cavalry",
  artillery: "role.artillery",
  medical: "role.medical",
  command: "role.command",
  engineer: "role.engineer",
  irregular: "role.irregular",
};

/** Catalog keys for the three field sides (mapping §1, §9). */
export const SIDE_LABEL_KEYS: Readonly<Record<UnitSide, MessageKey>> = {
  company: "side.company",
  enemy: "side.enemy",
  neutral: "side.neutral",
};

/** The catalog key for a post's coarse role family. */
export function unitRoleLabelKey(postId: string): MessageKey {
  return ROLE_LABEL_KEYS[roleCategory(postId)];
}

/* --------------------------------------------------------------------------
 * Stat chips
 * ------------------------------------------------------------------------ */

/**
 * One vitals chip on the card: a catalog label plus the current value, and an
 * optional maximum for gauges like strength and Élan (`12/40`).
 */
export interface UnitChip {
  /** Stable id, used as the React key and the `data-chip` attribute. */
  readonly id: string;
  /** The catalog key for the chip's label. */
  readonly labelKey: MessageKey;
  /** The current value the engine holds. */
  readonly value: number;
  /** The maximum, when the value is a gauge; omitted for flat stats. */
  readonly max?: number;
}

/**
 * The vitals the card shows, in a fixed order that mirrors the
 * {@link import("./UnitInfo").UnitInfo} tooltip: strength (HP), Élan (morale),
 * Speed, Move and Climb (jump). Every number is read straight from the unit —
 * the card never derives or rebalances anything.
 */
export function unitChips(unit: Unit): readonly UnitChip[] {
  return [
    { id: "hp", labelKey: "stat.hp", value: unit.hp, max: unit.stats.hp },
    { id: "elan", labelKey: "stat.mp", value: unit.mp, max: unit.stats.mp },
    { id: "spd", labelKey: "stat.spd", value: unit.stats.spd },
    { id: "move", labelKey: "stat.move", value: unit.stats.move },
    { id: "jump", labelKey: "stat.jump", value: unit.stats.jump },
  ];
}

/* --------------------------------------------------------------------------
 * Conditions
 * ------------------------------------------------------------------------ */

/** The humanitarian name of a condition id, or the raw id when unauthored. */
export function unitConditionName(conditionId: string): string {
  const definition = CONDITIONS[conditionId as ConditionKey];
  return definition === undefined ? conditionId : definition.name;
}

/** Every active condition's display name, in the engine's order. */
export function unitConditionNames(unit: Unit): readonly string[] {
  return unit.conditions.map((condition) => unitConditionName(condition.conditionId));
}
