/**
 * Orders Tempo order projection (T083) — the pure view model behind the tray.
 *
 * Kept separate from {@link TempoTray} so the React component file exports only
 * components (fast-refresh friendly) and this projection can be unit-tested in
 * Node without importing React at all.
 *
 * The work is a thin read of the engine's deterministic `previewTurns`
 * (T019, `engine/turn.ts`): take a battle, project the next N actors and
 * resolve each scheduled `UnitId` to its deployed `Unit`.
 */

import { battleSpeedOf, findUnit, type BattleState } from "../engine/battle";
import type { UnitId } from "../engine/ids";
import { previewTurns } from "../engine/turn";
import type { Unit } from "../engine/unit";

/** How many upcoming turns the tray shows by default. */
export const DEFAULT_TEMPO_PREVIEW = 8;

/**
 * One row of the projected turn order. A plain value (no React, no engine
 * handles) so the projection is trivial to assert against in a unit test.
 * `rank` is the 1-based scheduler position, which — unlike the unit id — is
 * unique even when a fast soldier appears several times in the window.
 */
export interface TempoEntry {
  /** The soldier taking this projected turn. */
  readonly unitId: UnitId;
  /** The full soldier, for name / power / post / stats. */
  readonly unit: Unit;
  /** 1-based position in the projected order. */
  readonly rank: number;
  /** Whether this is the turn currently in progress (the first entry). */
  readonly isCurrent: boolean;
}

/**
 * Project the next `count` turns of `battle` into display rows. Thin over
 * {@link previewTurns}: it resolves each scheduled {@link UnitId} to its
 * deployed {@link Unit} and flags the head of the order as the current turn.
 *
 * `count` is clamped to a non-negative whole number; a stalled order (nobody
 * can ever act) yields an empty list rather than an error.
 */
export function upcomingTurnOrder(battle: BattleState, count: number): TempoEntry[] {
  const wanted = Math.max(0, Math.trunc(count));
  const ids = previewTurns(battle.tempo, battleSpeedOf(battle), wanted);

  return ids.flatMap((unitId, index) => {
    const unit = findUnit(battle, unitId);
    // The scheduler only tracks deployed soldiers, so a miss is defensive.
    if (unit === undefined) return [];
    return [
      {
        unitId,
        unit,
        rank: index + 1,
        isCurrent: index === 0 && unitId === battle.currentActorId,
      },
    ];
  });
}
