/**
 * Targeting preview helpers (T085) — pure derivations for the battle overlay.
 *
 * The Pixi overlay (`src/render/overlay.ts`) owns only drawing: it is handed
 * lists of tiles and paints them. This module is the app-layer seam that turns
 * engine values into those lists — **which** tiles an action can reach, what
 * area its footprint covers, which tiles hostile soldiers can strike, and how
 * the ground rises beneath the cursor. It sits in `src/app` because it reasons
 * about the whole {@link BattleState} but belongs to presentation, not the
 * simulation (`agents.md` §7).
 *
 * Contract (`agents.md` §2, §7, §9):
 * - **Pure and deterministic** — reads the battle, returns fresh arrays, never
 *   mutates state and never samples randomness. The same battle yields the same
 *   preview every frame, so the overlay is stable and screenshot-friendly.
 * - **Data-driven** — reach and footprint come from the battle's `ActionSpec`
 *   catalogue (T024); no range is hard-coded per ability.
 * - **Presentation, not rules** — these helpers never decide whether an order is
 *   legal. They describe what the aiming UI should *show*; the engine still
 *   validates the confirmed command (T028, T022).
 *
 * Vocabulary follows the retheme (mapping §12): a hostile reach is a **danger
 * zone**, an area effect is a **footprint**, and the terrain lift is
 * **Elevation**.
 */

import type { AoeShape } from "../data/schema";
import type { ActionSpec } from "../engine/actions/resolve";
import type { BattleState } from "../engine/battle";
import { coordKey, type Coord } from "../engine/grid";
import { heightAt, type TerrainMap } from "../engine/terrain";
import {
  aoeTiles,
  areHostile,
  tilesInRange,
  unitsInAoe,
  type PositionedTarget,
  type RangeProfile,
} from "../engine/targeting";
import { isOutOfAction, type UnitSide } from "../engine/unit";

/* --------------------------------------------------------------------------
 * Danger zones
 * ------------------------------------------------------------------------ */

/**
 * Fallback reach (in tiles) for a danger zone when a battle authors no actions.
 * A named constant so the overlay's tuning lives here, never inline in logic
 * (`agents.md` §9).
 */
export const DEFAULT_THREAT_RANGE = 4;

/** The longest reach any action in the battle can bring to bear. */
export function threatRangeFor(state: BattleState): number {
  let reach = 0;
  for (const spec of Object.values(state.abilities)) {
    if (spec.range > reach) reach = spec.range;
  }
  return reach > 0 ? reach : DEFAULT_THREAT_RANGE;
}

/** Options for {@link dangerZoneFor}. */
export interface DangerZoneOptions {
  /** The side being threatened; the other hostile side paints the zone. */
  readonly side?: UnitSide;
  /** Override the reach in tiles (defaults to the battle's longest action). */
  readonly range?: number;
}

/**
 * Every tile a hostile soldier could strike, as a deterministic, de-duplicated
 * set. The zone is the union of each enemy's reach (`tilesInRange`), so terrain
 * and elevation shadows are respected exactly as they are when aiming.
 *
 * This is the classic "danger zone": move the free company into the red and it
 * can be hit next turn. It is presentation only — a tile in the zone is not
 * illegal, merely exposed.
 */
export function dangerZoneFor(state: BattleState, options: DangerZoneOptions = {}): Coord[] {
  const threatened = options.side ?? "company";
  const range = options.range ?? threatRangeFor(state);
  const profile: RangeProfile = { min: 1, max: range, requiresLineOfSight: true };

  const seen = new Set<string>();
  const tiles: Coord[] = [];
  for (const unit of state.units) {
    if (isOutOfAction(unit) || !areHostile(unit.side, threatened)) continue;
    for (const at of tilesInRange(state.map, unit.at, profile)) {
      const key = coordKey(at);
      if (seen.has(key)) continue;
      seen.add(key);
      tiles.push({ x: at.x, y: at.y });
    }
  }

  tiles.sort((a, b) => a.y - b.y || a.x - b.x);
  return tiles;
}

/* --------------------------------------------------------------------------
 * Area-of-effect preview
 * ------------------------------------------------------------------------ */

/** The footprint an action's authored area covers when centred on `center`. */
export function aoePreviewFor(map: TerrainMap, center: Coord, spec: ActionSpec): Coord[] {
  const shape: AoeShape = spec.aoeShape ?? "single";
  const size = spec.aoeSize ?? 0;
  return aoeTiles(map, center, shape, size);
}

/**
 * The tiles of a footprint that hold a soldier, so the overlay can brighten the
 * units an area would actually catch. Occupancy is by tile identity (mapping
 * §12); the result preserves roster order.
 */
export function areaHitsFor<T extends PositionedTarget>(
  units: readonly T[],
  tiles: readonly Coord[],
): Coord[] {
  return unitsInAoe(units, tiles).map((unit) => ({ x: unit.at.x, y: unit.at.y }));
}

/* --------------------------------------------------------------------------
 * Elevation preview
 * ------------------------------------------------------------------------ */

/**
 * How much higher (`> 0`) or lower (`< 0`) `to` stands than `from`, in
 * elevation layers. `0` is level ground. Used by the overlay's up/down chevron
 * and the HUD readout to preview the climb before a march commits.
 */
export function elevationDeltaFor(map: TerrainMap, from: Coord, to: Coord): number {
  return heightAt(map, to) - heightAt(map, from);
}
