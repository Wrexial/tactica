/**
 * Battle forecast (T086) — the confirm-prompt readout.
 *
 * The engine can already tell a player everything about an order before it
 * lands: the pure projection in `./forecast.ts` mirrors targeting, the hit roll,
 * the Steel/Powder/Medicine formulas and the reaction triggers. This component
 * is the thin DOM face of that projection — a small panel above the Orders menu
 * that shows **expected damage, hit chance and reaction risk** so the player can
 * weigh a gamble before confirming (mapping §12, the FFTA "move + act" turn).
 *
 * ## Contract (`agents.md` §2, §7, §9)
 *
 * - **Presentation only.** Reads an immutable {@link BattleState}; never mutates
 *   it and never rolls dice. The projection lives in `./forecast.ts`, so this
 *   file only maps plain values to DOM.
 * - **Deterministic.** The same battle, ability and target always paint the
 *   same panel; the component consumes no randomness and no clock.
 * - **Thin.** No rules live here; a change to how a blow resolves belongs in
 *   the engine, not in this component.
 */

import { useMemo } from "react";

import { findAbility } from "../data/abilities";

import type { BattleState } from "../engine/battle";
import type { Target } from "../engine/commands";
import type { UnitId } from "../engine/ids";
import type { RelativeFacing } from "../engine/rules/hit";
import { useTranslation, type MessageKey, type Translator } from "../i18n";
import {
  forecastAbility,
  type BattleForecast,
  type ForecastAbilitySpec,
  type ForecastOptions,
  type ForecastTarget,
} from "./battleForecast";

/** Catalog keys for the front/side/rear classification (mapping §12). */
const FACING_LABEL_KEYS: Readonly<Record<RelativeFacing, MessageKey>> = {
  front: "facing.front",
  side: "facing.side",
  rear: "facing.rear",
};

/** Props for {@link Forecast}. */
export interface ForecastProps {
  /** The battle the order will resolve against. */
  readonly battle: BattleState;
  /** The soldier who would take the order. */
  readonly actorId: UnitId;
  /** The aimed ability (a minimal `ActionSpec` works; a full spec is exact). */
  readonly spec: ForecastAbilitySpec;
  /** What the order is aimed at (self / a soldier / a tile). */
  readonly target: Target;
  /** Optional affinity/evasion/reaction-loadout hooks. */
  readonly options?: ForecastOptions;
}

/** Format a target's HP band as `before → after`. */
function hpBand(target: ForecastTarget): string {
  return `${target.hpBefore} → ${target.hpAfter}`;
}

/** The damage line, showing the rolled figure and its hit-weighted value. */
function damageLine(target: ForecastTarget, t: Translator): string {
  if (target.damage === 0) return t("common.none");
  if (!target.rollsToHit) return `${target.damage}`;
  return `${target.damage} (≈${target.expectedDamage})`;
}

/** One row for a caught soldier, with their odds, damage and HP band. */
function TargetRow({ target, index }: { readonly target: ForecastTarget; readonly index: number }) {
  const { t } = useTranslation();
  return (
    <li
      className="forecast__target"
      data-testid={`forecast-target-${index}`}
      data-hostile={target.hostile}
      data-lethal={target.lethal}
    >
      <div className="forecast__target-head">
        <span className="forecast__name">{target.name}</span>
        {target.lethal && (
          <span className="forecast__badge forecast__badge--lethal" data-testid="forecast-lethal">
            {t("forecast.outOfAction")}
          </span>
        )}
      </div>
      <dl className="forecast__stats">
        <div>
          <dt>{t("forecast.hit")}</dt>
          <dd data-testid={`forecast-target-${index}-hit`}>
            {target.rollsToHit ? `${target.hitChance}%` : t("common.none")}
          </dd>
        </div>
        <div>
          <dt>{t("forecast.damage")}</dt>
          <dd data-testid={`forecast-target-${index}-damage`}>{damageLine(target, t)}</dd>
        </div>
        {target.healing > 0 && (
          <div>
            <dt>{t("forecast.medicine")}</dt>
            <dd data-testid={`forecast-target-${index}-healing`}>{target.healing}</dd>
          </div>
        )}
        <div>
          <dt>{t("forecast.strength")}</dt>
          <dd data-testid={`forecast-target-${index}-hp`}>{hpBand(target)}</dd>
        </div>
        {target.facing !== null && (
          <div>
            <dt>{t("forecast.facing")}</dt>
            <dd data-testid={`forecast-target-${index}-facing`}>
              {t(FACING_LABEL_KEYS[target.facing])}
            </dd>
          </div>
        )}
      </dl>
    </li>
  );
}

/** The reaction-risk list, labelled by equipped status. */
function ReactionRisk({ forecast }: { readonly forecast: BattleForecast }) {
  const { t } = useTranslation();
  if (forecast.reactions.length === 0) {
    return (
      <p className="forecast__quiet" data-testid="forecast-reactions">
        {t("forecast.noReaction")}
      </p>
    );
  }
  return (
    <ul className="forecast__reactions" data-testid="forecast-reactions">
      {forecast.reactions.map((reaction, index) => (
        <li
          key={`${reaction.unitId}-${reaction.kind}-${index}`}
          data-testid={`forecast-reaction-${index}`}
          data-kind={reaction.kind}
          data-equipped={reaction.equipped}
          data-phase={reaction.phase}
        >
          <span className="forecast__reaction-name">{reaction.label}</span>
          <span className="forecast__reaction-owner">
            {reaction.unitName}
            {reaction.equipped ? "" : ` ${t("forecast.possible")}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The confirm-prompt forecast panel: one line per caught soldier, plus the
 * aggregated reaction risk. Renders a quiet state when nobody is in the
 * footprint so the panel never claims a hit that cannot happen.
 */
export function Forecast({ battle, actorId, spec, target, options }: ForecastProps) {
  const { t } = useTranslation();
  const forecast = useMemo(() => {
    const attacker = battle.units.find((unit) => unit.id === actorId);
    if (attacker === undefined) return null;
    return forecastAbility(battle, attacker, spec, target, options ?? {});
  }, [battle, actorId, spec, target, options]);

  if (forecast === null) {
    return (
      <section className="forecast" data-testid="battle-forecast" aria-label={t("forecast.label")}>
        <p className="forecast__quiet">{t("forecast.noSoldier")}</p>
      </section>
    );
  }

  return (
    <section
      className="forecast"
      data-testid="battle-forecast"
      data-ok={forecast.ok}
      aria-label={t("forecast.label")}
    >
      <header className="forecast__header">
        <h3>{t("forecast.title")}</h3>
        <span className="forecast__ability" data-testid="forecast-ability">
          {findAbility(forecast.abilityId)?.name ?? forecast.abilityId}
        </span>
      </header>

      {!forecast.ok && (
        <p className="forecast__rejection" data-testid="forecast-rejection">
          {forecast.reason ?? t("forecast.rejectionFallback")}
        </p>
      )}

      {forecast.targets.length === 0 ? (
        <p className="forecast__quiet" data-testid="forecast-empty">
          {t("forecast.noTarget")}
        </p>
      ) : (
        <ul className="forecast__targets" data-testid="forecast-targets">
          {forecast.targets.map((entry, index) => (
            <TargetRow key={entry.unitId} target={entry} index={index} />
          ))}
        </ul>
      )}

      <div className="forecast__risk">
        <h4>{t("forecast.reactionRisk")}</h4>
        <ReactionRisk forecast={forecast} />
      </div>
    </section>
  );
}
