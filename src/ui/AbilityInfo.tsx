/**
 * Ability info (UX) — the rules text behind an Orders entry.
 *
 * The Orders menu names an action and its Élan cost; everything else a player
 * needs to judge it (what it does, how far it reaches, what it rolls against)
 * lives in the authored {@link AbilityDef}. This component renders that data as
 * a rich tooltip body so the menu stays compact but nothing is hidden.
 *
 * Pure presentation: it looks up the definition, formats the numbers and maps
 * each enum to its catalog key. Unknown ids (the sandbox's placeholder actions)
 * fall back to the engine spec, so a demo entry still explains itself.
 */

import { findAbility } from "../data/abilities";
import { ELEMENTS } from "../data/elements";
import type { AbilityClass, AbilityTarget } from "../data/schema";
import type { ActionSpec } from "../engine/actions/resolve";
import { useTranslation, type MessageKey } from "../i18n";

/** Catalog keys for the five target affiliations. */
const TARGET_KEYS: Readonly<Record<AbilityTarget, MessageKey>> = {
  self: "ability.target.self",
  ally: "ability.target.ally",
  enemy: "ability.target.enemy",
  any: "ability.target.any",
  tile: "ability.target.tile",
};

/** Catalog keys for the four ability classes. */
const CLASS_KEYS: Readonly<Record<AbilityClass, MessageKey>> = {
  action: "ability.class.action",
  reaction: "ability.class.reaction",
  support: "ability.class.support",
  combo: "ability.class.combo",
};

/** Props for {@link AbilityInfo}. */
export interface AbilityInfoProps {
  /** The action's stable id (a key of `src/data/abilities`). */
  readonly abilityId: string;
  /** The engine spec the battle will resolve. */
  readonly spec: ActionSpec;
}

/** One `label: value` row of the tooltip's stat grid. */
function Row({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/** The rich tooltip body for one Orders action. */
export function AbilityInfo({ abilityId, spec }: AbilityInfoProps) {
  const { t } = useTranslation();
  const ability = findAbility(abilityId);
  const element = ability?.element === undefined ? null : ELEMENTS[ability.element];
  const target = spec.target ?? "enemy";

  return (
    <span className="tip__content">
      <strong className="tip__title">{ability?.name ?? abilityId}</strong>
      {ability !== undefined && <span className="tip__text">{ability.description}</span>}
      {ability !== undefined && <span className="tip__flavour">{ability.flavour}</span>}
      <dl className="tip__stats">
        <Row label={t("ability.class")} value={t(CLASS_KEYS[ability?.abilityClass ?? "action"])} />
        <Row label={t("ability.cost")} value={`${t("common.elan")} ${spec.mpCost}`} />
        <Row label={t("ability.range")} value={String(spec.range)} />
        <Row label={t("ability.target")} value={t(TARGET_KEYS[target])} />
        {spec.power > 0 && <Row label={t("ability.power")} value={String(spec.power)} />}
        {spec.chargeTime > 0 && (
          <Row
            label={t("ability.charge")}
            value={t("ability.chargeValue", { ticks: spec.chargeTime })}
          />
        )}
        {element !== null && <Row label={t("ability.element")} value={element.name} />}
      </dl>
    </span>
  );
}
