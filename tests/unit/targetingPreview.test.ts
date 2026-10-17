import { describe, expect, it } from "vitest";

import {
  DEFAULT_THREAT_RANGE,
  aoePreviewFor,
  areaHitsFor,
  dangerZoneFor,
  elevationDeltaFor,
  threatRangeFor,
} from "../../src/app/targetingPreview";
import { createDemoBattle } from "../../src/app/demoScenario";
import type { ActionSpec } from "../../src/engine/actions/resolve";
import { coord, coordKey } from "../../src/engine/grid";
import { asAbilityId } from "../../src/engine/ids";
import { createTerrainMap, heightAt, withTile } from "../../src/engine/terrain";

/* --------------------------------------------------------------------------
 * T085 — Targeting UX preview helpers
 *
 * These pin the pure derivations the overlay draws from: the hostile danger
 * zone, an action's area footprint, which footprint tiles are occupied, and the
 * elevation delta under the cursor. They are presentation-only, so the tests
 * focus on determinism, purity and the exact tiles highlighted.
 * ------------------------------------------------------------------------ */

const battle = createDemoBattle();
const map = battle.map;

const keys = (tiles: readonly { x: number; y: number }[]): string[] =>
  tiles.map((at) => coordKey(at)).sort();

describe("threatRangeFor", () => {
  it("uses the longest reach in the battle catalogue", () => {
    // The demo's musket reaches 5 tiles, the longest of its three actions.
    expect(threatRangeFor(battle)).toBe(5);
  });

  it("falls back to the authored default when no actions exist", () => {
    const empty = { ...battle, abilities: {} };
    expect(threatRangeFor(empty)).toBe(DEFAULT_THREAT_RANGE);
  });
});

describe("dangerZoneFor", () => {
  it("marks tiles hostile soldiers can strike, excluding their own tile", () => {
    const zone = dangerZoneFor(battle, { range: 1 });
    const zoneKeys = new Set(zone.map((at) => coordKey(at)));

    // A tile beside the enemy at (8, 4) is in the zone; at reach 1 the enemy's
    // own tile is not (you cannot be attacked on the hostile's own square).
    expect(zoneKeys.has(coordKey(coord(7, 4)))).toBe(true);
    expect(zoneKeys.has(coordKey(coord(8, 4)))).toBe(false);
    expect(zone.length).toBeGreaterThan(0);
  });

  it("is deterministic, de-duplicated and does not mutate the battle", () => {
    const before = JSON.stringify(battle);
    const first = dangerZoneFor(battle);
    const second = dangerZoneFor(battle);
    expect(second).toEqual(first);
    expect(keys(first)).toEqual([...new Set(keys(first))].sort());
    expect(JSON.stringify(battle)).toBe(before);
  });

  it("honours an explicit reach and threatened side", () => {
    const small = dangerZoneFor(battle, { range: 1 });
    // With reach 1 only the enemies' orthogonal neighbours are threatened.
    expect(small.length).toBeLessThanOrEqual(12);

    // Threatening the enemy side instead paints the company's reach: a tile
    // beside the company is in the zone.
    const enemyZone = dangerZoneFor(battle, { side: "enemy" });
    expect(enemyZone.map((at) => coordKey(at))).toContain(coordKey(coord(4, 4)));
  });
});

describe("aoePreviewFor", () => {
  it("defaults to a single-centre footprint", () => {
    const spec: ActionSpec = {
      id: asAbilityId("test-single"),
      mpCost: 0,
      chargeTime: 0,
      range: 3,
      power: 100,
    };
    expect(aoePreviewFor(map, coord(3, 4), spec)).toEqual([coord(3, 4)]);
  });

  it("expands the authored shape around the centre", () => {
    const spec: ActionSpec = {
      id: asAbilityId("test-cross"),
      mpCost: 0,
      chargeTime: 0,
      range: 3,
      power: 100,
      aoeShape: "cross",
      aoeSize: 1,
    };
    const tiles = aoePreviewFor(map, coord(3, 4), spec);
    expect(tiles).toHaveLength(5);
    expect(tiles).toContainEqual(coord(3, 4));
    expect(tiles).toContainEqual(coord(2, 4));
    expect(tiles).toContainEqual(coord(4, 4));
    expect(tiles).toContainEqual(coord(3, 3));
    expect(tiles).toContainEqual(coord(3, 5));
  });
});

describe("areaHitsFor", () => {
  it("reports the occupied tiles of a footprint, preserving roster order", () => {
    const footprint = [coord(3, 4), coord(3, 5), coord(2, 4), coord(1, 1)];
    const hits = areaHitsFor(battle.units, footprint);
    // Sgt. Aubry stands on (3, 4) and Pvt. Marchand on (2, 4).
    expect(hits).toContainEqual(coord(3, 4));
    expect(hits).toContainEqual(coord(2, 4));
    expect(hits).not.toContainEqual(coord(1, 1));
    expect(hits).toHaveLength(2);
  });
});

describe("elevationDeltaFor", () => {
  it("measures the climb between two tiles in layers", () => {
    // The demo's hill at (8, 6) is one layer above Sgt. Aubry's start (3, 4).
    expect(elevationDeltaFor(map, coord(3, 4), coord(8, 6))).toBe(1);
    expect(elevationDeltaFor(map, coord(3, 4), coord(9, 7))).toBe(2);
    expect(elevationDeltaFor(map, coord(3, 4), coord(3, 4))).toBe(0);
    // Uphill is the negative of downhill.
    expect(elevationDeltaFor(map, coord(8, 6), coord(3, 4))).toBe(-1);
  });

  it("reads the same height layer the engine stored", () => {
    const raised = withTile(createTerrainMap(2, 2, "field"), coord(1, 0), {
      terrain: "hill",
      height: 3,
    });
    expect(elevationDeltaFor(raised, coord(0, 0), coord(1, 0))).toBe(heightAt(raised, coord(1, 0)));
  });
});
