/**
 * Orders Tempo tray (T083) — the upcoming turn order, visualised.
 *
 * The engine already answers "whose turn is next?" deterministically through
 * `previewTurns` (T019, `engine/turn.ts`): it projects the next N actors without
 * advancing the caller's battle. This component renders that projection — see
 * the pure `upcomingTurnOrder` in `./tempoOrder.ts` — as a horizontal **tray**
 * across the foot of the field, so the player can read the tempo at a glance.
 * This is the Napoleonic retheme of FFTA's turn-order strip (mapping §12,
 * "Charge Time Battle" → **Orders Tempo**).
 *
 * ## What it shows
 *
 * One chip per upcoming turn, in order. Each chip carries the things the
 * battlefield presents (T081) so the tray and the field agree:
 *
 * - the **soldier's name**;
 * - the **power** (military school) as a uniform swatch — `powerUniform`
 *   gives the same coat colour `render/scene.ts` paints on the field (mapping
 *   §2);
 * - the **role family** from the post id — `roleCategory`, the same coarse
 *   silhouette class the placeholder figures use (mapping §3);
 * - the effective **Speed** that produced the order, plus the **side**;
 * - the soldier's **current Orders Tempo charge** as a bar (T131, peer lesson
 *   L13), read straight from the scheduler so the "charge clock" is visible
 *   without the tray recomputing any tempo maths.
 *
 * The first chip is the soldier taking the current turn (`data-current`), so a
 * glance tells you who is acting and who follows.
 *
 * ## Contract (`agents.md` §2, §7, §9)
 *
 * - **Presentation only.** The component reads an immutable {@link BattleState}
 *   and never mutates it; clicking an entry only asks the caller to focus that
 *   soldier (`onSelect`).
 * - **Deterministic.** The order comes from the seeded scheduler; the same
 *   battle always paints the same tray. No randomness, no clock, no I/O.
 * - **Thin.** The projection lives in `./tempoOrder.ts`; this file only maps it
 *   to DOM.
 *
 * Reference: `docs/wiki/pages/Charge_time.md` (CTB turn order) and
 * `docs/wiki/pages/Battle_system.md`.
 */

import { useMemo } from "react";

import type { BattleState } from "../engine/battle";
import type { UnitId } from "../engine/ids";
import { powerUniform, roleCategory } from "../render/units";
import { useTranslation } from "../i18n";
import { Tooltip } from "./Tooltip";
import { UnitInfo } from "./UnitInfo";
import { POWER_LABEL_KEYS, ROLE_LABEL_KEYS, SIDE_LABEL_KEYS } from "./unitLabels";
import { DEFAULT_TEMPO_PREVIEW, upcomingTurnOrder } from "./tempoOrder";

/** A numeric Pixi colour (`0x2f5fa8`) as a CSS hex string (`#2f5fa8`). */
function cssColor(color: number): string {
  return `#${(color & 0xffffff).toString(16).padStart(6, "0")}`;
}

/* --------------------------------------------------------------------------
 * Props and component
 * ------------------------------------------------------------------------ */

/** Props for {@link TempoTray}. */
export interface TempoTrayProps {
  /** The battle whose Orders Tempo order to display. */
  readonly battle: BattleState;
  /** How many upcoming turns to show. Defaults to {@link DEFAULT_TEMPO_PREVIEW}. */
  readonly count?: number;
  /** Called with a soldier's id when the player clicks their chip. */
  readonly onSelect?: (unitId: UnitId) => void;
}

/**
 * The Orders Tempo tray: an ordered strip of the upcoming turns, with the
 * acting soldier highlighted. Read-only unless an `onSelect` handler is given.
 */
export function TempoTray({ battle, count = DEFAULT_TEMPO_PREVIEW, onSelect }: TempoTrayProps) {
  const { t } = useTranslation();
  const entries = useMemo(() => upcomingTurnOrder(battle, count), [battle, count]);

  return (
    <section className="tempo-tray" data-testid="tempo-tray" aria-label={t("tempo.title")}>
      <header className="tempo-tray__header">
        <h3>{t("tempo.title")}</h3>
        <p className="muted">{t("tempo.upcoming")}</p>
      </header>

      {entries.length === 0 ? (
        <p className="tempo-tray__empty" data-testid="tempo-tray-empty">
          {t("tempo.noneReady")}
        </p>
      ) : (
        <ol className="tempo-order" data-testid="tempo-order">
          {entries.map((entry, index) => {
            const role = roleCategory(entry.unit.postId);
            const coat = cssColor(powerUniform(entry.unit.power).coat);
            const className = [
              "tempo-entry",
              `tempo-entry--${entry.unit.side}`,
              entry.isCurrent ? "tempo-entry--current" : "",
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <li
                key={`${entry.unitId}-${entry.rank}`}
                className={className}
                data-testid={`tempo-entry-${index}`}
                data-unit-id={entry.unitId}
                data-side={entry.unit.side}
                data-power={entry.unit.power}
                data-current={entry.isCurrent}
              >
                <Tooltip
                  side="top"
                  bubbleTestId={`tempo-info-${index}`}
                  label={<UnitInfo unit={entry.unit} />}
                >
                  <button
                    type="button"
                    className="tempo-entry__card"
                    // Keep the tray out of the battle keyboard loop (T030): the
                    // canvas owns arrow/Enter navigation, so these chips must not
                    // steal focus (T087 will add deliberate tray navigation).
                    tabIndex={-1}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={onSelect === undefined ? undefined : () => onSelect(entry.unitId)}
                    aria-label={`${t("tempo.entryAria", {
                      rank: entry.rank,
                      name: entry.unit.name,
                      role: t(ROLE_LABEL_KEYS[role]),
                      power: t(POWER_LABEL_KEYS[entry.unit.power]),
                    })}, ${t("tempo.entryCharge", {
                      charge: entry.charge,
                      threshold: entry.threshold,
                    })}${entry.isCurrent ? `, ${t("tempo.onTurn")}` : ""}`}
                  >
                    <span className="tempo-entry__rank" aria-hidden="true">
                      {entry.rank}
                    </span>
                    <span
                      className="tempo-entry__swatch"
                      style={{ backgroundColor: coat }}
                      aria-hidden="true"
                    />
                    <span className="tempo-entry__body">
                      <span className="tempo-entry__name">{entry.unit.name}</span>
                      <span className="tempo-entry__meta">
                        {t("tempo.entryMeta", {
                          role: t(ROLE_LABEL_KEYS[role]),
                          power: t(POWER_LABEL_KEYS[entry.unit.power]),
                          speed: entry.unit.stats.spd,
                          side: t(SIDE_LABEL_KEYS[entry.unit.side]),
                        })}
                      </span>
                      {/* The charge clock (T131, L13): a thin bar toward the
                          next Orders Tempo turn. The fraction is computed in
                          the pure projection; the view only paints it. */}
                      <progress
                        className="tempo-entry__charge"
                        data-testid={`tempo-entry-${index}-charge`}
                        data-charge={entry.charge}
                        data-threshold={entry.threshold}
                        max={1}
                        value={entry.chargeRatio}
                        aria-hidden="true"
                      />
                    </span>
                    {entry.isCurrent && (
                      <span className="tempo-entry__now" data-testid={`tempo-entry-${index}-now`}>
                        {t("tempo.onTurn")}
                      </span>
                    )}
                  </button>
                </Tooltip>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
