/**
 * Stat chips (T134) — the compact vitals strip on the per-character unit card.
 *
 * A tactics player reads a soldier's strength, Élan, Speed, Move and Climb at a
 * glance; the card presents them as small `label value` chips so the exact
 * figures are always visible without opening a tooltip. The values come from
 * the pure {@link import("./unitLabels").unitChips} projection, so the view
 * holds no stats logic of its own.
 *
 * Presentation only (`agents.md` §2, §7): it reads the unit handed in and never
 * mutates it.
 */

import type { Unit } from "../engine/unit";
import { useTranslation } from "../i18n";
import { unitChips } from "./unitLabels";

/** Props for {@link StatChips}. */
export interface StatChipsProps {
  /** The soldier whose vitals to show. */
  readonly unit: Unit;
}

/** The vitals strip: one chip per stat, exact figures included. */
export function StatChips({ unit }: StatChipsProps) {
  const { t } = useTranslation();

  return (
    <ul className="unit-chips" data-testid="hud-chips" aria-label={t("unit.vitals")}>
      {unitChips(unit).map((chip) => (
        <li className="unit-chip" key={chip.id} data-chip={chip.id}>
          <span className="unit-chip__label">{t(chip.labelKey)}</span>
          <span className="unit-chip__value" data-chip-value={chip.id}>
            {chip.max === undefined ? String(chip.value) : `${chip.value}/${chip.max}`}
          </span>
        </li>
      ))}
    </ul>
  );
}
