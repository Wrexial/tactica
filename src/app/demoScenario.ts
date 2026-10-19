/**
 * Placeholder battle scenario for the app shell (T030).
 *
 * Until the campaign, contracts and content pipeline land (Phase 4+), the shell
 * needs a small, **deterministic** detachment action to drive the input
 * controller, move range and path preview. This module is authored content, not
 * engine rules: it builds a terrain map, deploys a handful of soldiers and
 * hands them a few {@link ActionSpec}s, then returns a normal
 * {@link BattleState} through `createBattle`.
 *
 * Contract (`agents.md` §2, §3):
 * - No randomness, no clock, no DOM — the same battle every reload, so the e2e
 *   suite and manual play both see an identical board.
 * - Names are original Napoleonic fiction (a French free company vs. British
 *   irregular pickets on a bridged river), never FFTA prose.
 * - Balance values are ours; the FFTA move/jump model merely inspired the
 *   shape.
 */

import type { StatBlock } from "../data/schema";
import type { ActionSpec } from "../engine/actions/resolve";
import { createBattle, type BattleState } from "../engine/battle";
import { coord, type Coord } from "../engine/grid";
import { asAbilityId, asPostId, asUnitId } from "../engine/ids";
import { createTerrainMap, withTile, type TerrainMap, type TerrainType } from "../engine/terrain";
import { createUnit, type Unit, type UnitSide } from "../engine/unit";
import {
  advanceFieldBattle,
  fieldAiHoldsTurn,
  runFieldAiTurn,
  type FieldAiUpdate,
} from "./skirmishScenario";

/** Fixed seed for the demo action, so replays and screenshots are stable. */
export const DEMO_SEED = 1809;

/** A line infantryman: sturdy, average pace. */
const LINE_STATS: StatBlock = {
  hp: 60,
  mp: 24,
  atk: 12,
  def: 8,
  mag: 4,
  res: 6,
  spd: 28,
  move: 4,
  jump: 2,
};

/** A skirmisher: faster, longer stride, better climber. */
const SKIRMISHER_STATS: StatBlock = {
  ...LINE_STATS,
  spd: 34,
  move: 5,
  jump: 3,
};

/** An irregular picket: slower, holds the ground. */
const IRREGULAR_STATS: StatBlock = {
  ...LINE_STATS,
  spd: 22,
};

/** The actions the demo detachment can resolve (T024 catalogue). */
export const DEMO_ACTIONS: readonly ActionSpec[] = [
  { id: asAbilityId("musket-fire"), mpCost: 4, chargeTime: 0, range: 5, power: 100 },
  { id: asAbilityId("bayonet-charge"), mpCost: 0, chargeTime: 0, range: 1, power: 90 },
  {
    id: asAbilityId("dress-ranks"),
    mpCost: 3,
    chargeTime: 0,
    range: 3,
    power: 60,
    aoeShape: "cross",
    aoeSize: 1,
  },
];

/**
 * A 12×9 field split by a river at `x = 5`, crossable only at the bridge
 * `(5, 4)`. A copse and a low rise give the move range and elevation some
 * texture; the placement is a pure pattern (no `Math.random`).
 */
function buildDemoMap(): TerrainMap {
  let map = createTerrainMap(12, 9, "field");
  const place = (x: number, y: number, terrain: TerrainType, height = 0): void => {
    map = withTile(map, coord(x, y), { terrain, height });
  };

  for (let y = 0; y < 9; y++) {
    if (y !== 4) place(5, y, "river");
  }
  place(5, 4, "bridge");

  place(2, 2, "wood");
  place(3, 2, "wood");
  place(2, 3, "wood");

  place(8, 6, "hill", 1);
  place(9, 6, "hill", 1);
  place(9, 7, "hill", 2);

  place(8, 1, "village");
  place(9, 1, "village");

  return map;
}

/** Build one soldier from the demo roster. */
function makeSoldier(
  id: string,
  name: string,
  postId: string,
  at: Coord,
  stats: StatBlock,
  side: UnitSide = "company",
): Unit {
  return createUnit({
    id: asUnitId(id),
    name,
    power: "france",
    postId: asPostId(postId),
    side,
    level: 1,
    at,
    stats,
  });
}

/**
 * The demo detachment action. Sgt. Aubry has the highest Speed, so the Orders
 * Tempo scheduler deterministically grants the first turn — the shell opens
 * with a controllable soldier selected in all but name.
 */
export function createDemoBattle(): BattleState {
  return createBattle(DEMO_SEED, {
    map: buildDemoMap(),
    units: [
      makeSoldier("unit-aubry", "Sgt. Aubry", "fusilier", coord(3, 4), {
        ...LINE_STATS,
        spd: 42,
      }),
      makeSoldier("unit-lefevre", "Cpl. Lefèvre", "voltigeur", coord(3, 6), SKIRMISHER_STATS),
      makeSoldier("unit-marchand", "Pvt. Marchand", "surgeon", coord(2, 4), {
        ...LINE_STATS,
        spd: 26,
      }),
      makeSoldier("unit-hedge", "Hedge Picket", "irregular", coord(8, 4), IRREGULAR_STATS, "enemy"),
      makeSoldier("unit-copse", "Copse Picket", "irregular", coord(8, 2), IRREGULAR_STATS, "enemy"),
      makeSoldier("unit-ford", "Ford Watch", "irregular", coord(7, 7), IRREGULAR_STATS, "enemy"),
    ],
    abilities: DEMO_ACTIONS,
  });
}

/* --------------------------------------------------------------------------
 * Driving the hostile pickets (T143)
 * ------------------------------------------------------------------------ */

/**
 * The shared Field-AI update shape. The sandbox demo deliberately uses the same
 * driver as Quick Battle and the campaign, so the opening Field cannot silently
 * skip the hostile phase.
 */
export type DemoUpdate = FieldAiUpdate;

/** Whether the demo action is waiting on an AI-controlled picket. */
export function demoAiHoldsTurn(battle: BattleState): boolean {
  return fieldAiHoldsTurn(battle);
}

/** Take every consecutive hostile picket's turn, then hand back to the company. */
export function advanceDemoBattle(battle: BattleState): DemoUpdate | null {
  return advanceFieldBattle(battle);
}

/** Take exactly one hostile picket's turn, for paced Field playback. */
export function runDemoTurn(battle: BattleState): DemoUpdate | null {
  return runFieldAiTurn(battle);
}
