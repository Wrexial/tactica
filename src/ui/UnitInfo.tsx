/**
 * Unit info (UX) — the stat line behind a soldier.
 *
 * The Orders Tempo tray shows a name, coat and Speed; this component renders the
 * fuller picture (health, Élan, movement, conditions) as a tooltip body so a
 * player can read a soldier before committing to a plan. Presentation only.
 */

import { CONDITIONS, type ConditionKey } from "../data/conditions";
import type { Unit } from "../engine/unit";
import { useTranslation } from "../i18n";

/** The human name of a condition id, or the raw id when unauthored. */
function conditionName(conditionId: string): string {
  const def = CONDITIONS[conditionId as ConditionKey];
  return def === undefined ? conditionId : def.name;
}

/** Props for {@link UnitInfo}. */
export interface UnitInfoProps {
  readonly unit: Unit;
}

/** The rich tooltip body for one soldier. */
export function UnitInfo({ unit }: UnitInfoProps) {
  const { t } = useTranslation();
  return (
    <span className="tip__content">
      <strong className="tip__title">{unit.name}</strong>
      <dl className="tip__stats">
        <div>
          <dt>{t("stat.hp")}</dt>
          <dd>
            {unit.hp} / {unit.stats.hp}
          </dd>
        </div>
        <div>
          <dt>{t("stat.mp")}</dt>
          <dd>
            {unit.mp} / {unit.stats.mp}
          </dd>
        </div>
        <div>
          <dt>{t("stat.spd")}</dt>
          <dd>{unit.stats.spd}</dd>
        </div>
        <div>
          <dt>{t("stat.move")}</dt>
          <dd>{unit.stats.move}</dd>
        </div>
        <div>
          <dt>{t("stat.jump")}</dt>
          <dd>{unit.stats.jump}</dd>
        </div>
      </dl>
      {unit.conditions.length > 0 && (
        <span className="tip__text">
          {t("unit.conditions")}: {unit.conditions.map((c) => conditionName(c.conditionId)).join(", ")}
        </span>
      )}
    </span>
  );
}
