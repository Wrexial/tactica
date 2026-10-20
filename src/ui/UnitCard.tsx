/**
 * Unit card (T134) — the per-character battlefield HUD for the soldier in focus.
 *
 * Modelled on FFT Blue's `BattleScene.showUnitInfo` (peer lesson L16) for its
 * *content*, but docked instead of anchored: the card sits in the bottom-left
 * corner of the field, stacked above the compact field readout and the Orders
 * band inside `.field-dock`, so it never parks itself over the tiles the player
 * is inspecting or aiming at. The card is **on demand**: it is not drawn for the
 * acting soldier merely because the Orders Tempo turn is theirs, and it is
 * dismissed while an order is being aimed.
 *
 * ## Contract (`agents.md` §2, §7, §9)
 *
 * - **Presentation only.** It reads an engine {@link Unit} and never mutates
 *   state.
 * - **Layer-clean.** No Pixi/`Scene` dependency: the dock lays the card out in
 *   CSS, so no camera projection is involved.
 */

import type { Unit } from "../engine/unit";
import { useTranslation } from "../i18n";
import { StatChips } from "./StatChips";
import {
  POWER_LABEL_KEYS,
  SIDE_LABEL_KEYS,
  unitConditionNames,
  unitRoleLabelKey,
} from "./unitLabels";

/** Which of the focus cases a card is showing (for styling/tests). */
export type UnitCardRole = "hovered" | "selected" | "actor";

/** Props for {@link UnitCard}. */
export interface UnitCardProps {
  /** The soldier the card describes (hovered, selected or acting). */
  readonly unit: Unit;
  /** Why this soldier is in focus; carried onto the card as `data-role`. */
  readonly role: UnitCardRole;
}

/**
 * The docked soldier card. The root carries `unit-card` and the vitals strip
 * carries `hud-chips`, both part of the battlefield HUD's test contract.
 */
export function UnitCard({ unit, role }: UnitCardProps) {
  const { t } = useTranslation();

  const conditions = unitConditionNames(unit);

  return (
    <section
      className="unit-card"
      data-testid="unit-card"
      data-role={role}
      data-unit-side={unit.side}
      aria-label={t("unit.cardLabel", { name: unit.name })}
    >
      <header className="unit-card__head">
        <strong className="unit-card__name">{unit.name}</strong>
        <span className={`unit-card__side unit-card__side--${unit.side}`}>
          {t(SIDE_LABEL_KEYS[unit.side])}
        </span>
      </header>
      <p className="unit-card__meta">
        {t(POWER_LABEL_KEYS[unit.power])} · {t(unitRoleLabelKey(unit.postId))}
      </p>
      <StatChips unit={unit} />
      {conditions.length > 0 && (
        <p className="unit-card__conditions">
          <span className="unit-card__conditions-label">{t("unit.conditions")}:</span>{" "}
          {conditions.join(", ")}
        </p>
      )}
    </section>
  );
}
