import { describe, expect, it } from "vitest";

import { CONTRACTS } from "../../src/data/contracts";
import {
  BATTLE_MAP_KEYS,
  BATTLE_MAP_LIST,
  BATTLE_MAPS,
  BattleMapDefSchema,
  ELEVATION_CHARS,
  JSON_BATTLE_MAP_KEYS,
  LOCATION_KEYS,
  LOCATION_LIST,
  LOCATIONS,
  LocationDefSchema,
  MAP_MAX_DIMENSION,
  MAP_MAX_HEIGHT,
  MAP_MIN_HEIGHT,
  MAP_TERRAIN_CHARS,
  MapBundleSchema,
  TERRAIN_CHAR_FOR,
  TERRAIN_KEYS,
  battleMapObjective,
  battleMapToTerrainMap,
  battleMapsForContract,
  battleMapsForLocation,
  expandBattleMap,
  getBattleMap,
  getLocation,
  heightFromChar,
  isBattleMapKey,
  isLocationKey,
  locationsForChapter,
  terrainFromChar,
  type BattleMapDef,
} from "../../src/data/maps";
import { createBattle } from "../../src/engine/battle";
import { coord } from "../../src/engine/grid";
import { asAbilityId, asPostId, asUnitId } from "../../src/engine/ids";
import { assertObjective } from "../../src/engine/objectives";
import { findPath } from "../../src/engine/pathfinding";
import {
  MAX_HEIGHT,
  MIN_HEIGHT,
  TERRAIN_TYPES,
  getTerrainDef,
  heightAt,
  terrainAt,
} from "../../src/engine/terrain";
import { createUnit, type Unit } from "../../src/engine/unit";
import type { StatBlock } from "../../src/data/schema";

/* --------------------------------------------------------------------------
 * T074 — Locations & battle maps data
 *
 * Pins the task's "done when": the **location/terrain data** and the **battle
 * map definitions** validate. Beyond the Zod parse, these tests hold the
 * integration edges the rest of Phase 6 leans on:
 *
 *   - the data-side `TERRAIN_KEYS` mirror T014's engine `TERRAIN_TYPES`;
 *   - every battle map expands to a `TerrainMap`-shaped board the engine can
 *     actually fight on (pinned by building a real battle);
 *   - every cross-reference (location ↔ map ↔ contract) resolves, so the
 *     tables cannot drift apart;
 *   - malformed boards fail loudly at the schema boundary.
 * ------------------------------------------------------------------------ */

const PLACEHOLDER_PATTERNS: ReadonlyArray<RegExp> = [
  /\bTBD\b/i,
  /\bTBC\b/i,
  /\bTODO\b/i,
  /\bFIXME\b/i,
  /\bXXX\b/i,
  /\bplaceholder\b/i,
  /lorem\s+ipsum/i,
  /\?{3,}/,
];

/** Every display definition must carry authored, placeholder-free prose. */
function expectAuthoredDisplay(def: {
  id: string;
  name: string;
  description: string;
  flavour: string;
}) {
  for (const field of ["name", "description", "flavour"] as const) {
    const text = def[field];
    expect(text.trim(), `${def.id}.${field} must be non-empty`).not.toBe("");
    for (const pattern of PLACEHOLDER_PATTERNS) {
      expect(pattern.test(text), `${def.id}.${field} contains a placeholder`).toBe(false);
    }
  }
}

const STATS: StatBlock = {
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

function makeUnit(id: string, at: ReturnType<typeof coord>): Unit {
  return createUnit({
    id: asUnitId(id),
    name: id,
    power: "france",
    postId: asPostId("fusilier"),
    side: id.startsWith("enemy") ? "enemy" : "company",
    level: 1,
    at,
    stats: STATS,
  });
}

/* --------------------------------------------------------------------------
 * Terrain key mirror (T014 ↔ T074)
 * ------------------------------------------------------------------------ */

describe("terrain key mirror (T014 ↔ T074)", () => {
  it("restates the engine's terrain set exactly, in the same order", () => {
    expect([...TERRAIN_KEYS]).toEqual([...TERRAIN_TYPES]);
  });

  it("matches the engine's elevation range", () => {
    expect(MAP_MIN_HEIGHT).toBe(MIN_HEIGHT);
    expect(MAP_MAX_HEIGHT).toBe(MAX_HEIGHT);
  });

  it("gives every terrain exactly one authoring character", () => {
    const chars = Object.values(MAP_TERRAIN_CHARS);
    expect(new Set(chars).size).toBe(chars.length);
    for (const terrain of TERRAIN_KEYS) {
      const char = TERRAIN_CHAR_FOR[terrain];
      expect(typeof char).toBe("string");
      expect(terrainFromChar(char)).toBe(terrain);
    }
    expect(chars).toHaveLength(TERRAIN_KEYS.length);
  });

  it("resolves elevation characters across the full engine range", () => {
    expect(ELEVATION_CHARS).toHaveLength(MAP_MAX_HEIGHT + 1);
    for (let height = MAP_MIN_HEIGHT; height <= MAP_MAX_HEIGHT; height++) {
      expect(heightFromChar(ELEVATION_CHARS[height] as string)).toBe(height);
    }
    expect(heightFromChar("!")).toBeUndefined();
    expect(terrainFromChar("!")).toBeUndefined();
  });

  it("keeps the map dimension cap within the campaign map's bound", () => {
    expect(MAP_MAX_DIMENSION).toBeGreaterThan(0);
  });
});

/* --------------------------------------------------------------------------
 * Locations
 * ------------------------------------------------------------------------ */

describe("location data (T074)", () => {
  it("authors every canonical key, once each", () => {
    expect(new Set(LOCATION_KEYS).size).toBe(LOCATION_KEYS.length);
    expect(Object.keys(LOCATIONS)).toHaveLength(LOCATION_KEYS.length);
    expect(LOCATION_LIST.map((location) => location.id)).toEqual([...LOCATION_KEYS]);
  });

  it("validates every location and carries authored display prose", () => {
    for (const key of LOCATION_KEYS) {
      const parsed = LocationDefSchema.parse(LOCATIONS[key]);
      expect(parsed.id).toBe(key);
      expectAuthoredDisplay(parsed);
    }
  });

  it("ties each location to a campaign region and existing battle maps", () => {
    for (const location of LOCATION_LIST) {
      expect(location.regionId.length).toBeGreaterThan(0);
      for (const mapId of location.battleMapIds) {
        expect(isBattleMapKey(mapId), `${location.id} → ${mapId}`).toBe(true);
        expect(getBattleMap(mapId as (typeof BATTLE_MAP_KEYS)[number]).locationId).toBe(
          location.id,
        );
      }
    }
  });

  it("marks the highlands as No-Man's Land", () => {
    expect(getLocation("the-highlands").isNoMansLand).toBe(true);
    expect(getLocation("sainte-colombe").isNoMansLand).toBe(false);
  });

  it("looks locations up and gates them by chapter", () => {
    expect(isLocationKey("blackwood")).toBe(true);
    expect(isLocationKey("atlantis")).toBe(false);
    expect(getLocation("blackwood").name).toBe("The Blackwood");
    expect(() => getLocation("atlantis" as never)).toThrow(RangeError);

    // The chapter-1 location is open at chapter 1; the chapter-5 pass is not.
    const early = locationsForChapter(1).map((location) => location.id);
    expect(early).toContain("sainte-colombe");
    expect(early).not.toContain("the-highlands");
    expect(locationsForChapter(5).map((location) => location.id)).toContain("the-highlands");
  });
});

/* --------------------------------------------------------------------------
 * Battle maps
 * ------------------------------------------------------------------------ */

describe("battle map data (T074)", () => {
  it("authors every canonical key, once each", () => {
    expect(new Set(BATTLE_MAP_KEYS).size).toBe(BATTLE_MAP_KEYS.length);
    expect(Object.keys(BATTLE_MAPS)).toHaveLength(BATTLE_MAP_KEYS.length);
    expect(BATTLE_MAP_LIST.map((map) => map.id)).toEqual([...BATTLE_MAP_KEYS]);
  });

  it("validates every map and carries authored display prose", () => {
    for (const key of BATTLE_MAP_KEYS) {
      const parsed = BattleMapDefSchema.parse(BATTLE_MAPS[key]);
      expect(parsed.id).toBe(key);
      expect(parsed.layout).toHaveLength(parsed.height);
      expectAuthoredDisplay(parsed);
    }
  });

  it("authors terrain and elevation layers with the map's exact shape", () => {
    for (const map of BATTLE_MAP_LIST) {
      for (const [y, row] of map.layout.entries()) {
        expect(row, `${map.id} layout row ${y}`).toHaveLength(map.width);
        for (const char of row) {
          expect(terrainFromChar(char), `${map.id} layout "${char}"`).toBeDefined();
        }
      }
      if (map.elevation !== undefined) {
        expect(map.elevation).toHaveLength(map.height);
        for (const [y, row] of map.elevation.entries()) {
          expect(row, `${map.id} elevation row ${y}`).toHaveLength(map.width);
          for (const char of row) {
            expect(heightFromChar(char), `${map.id} elevation "${char}"`).toBeDefined();
          }
        }
      }
    }
  });

  it("deploys each side on passable tiles inside the grid", () => {
    for (const map of BATTLE_MAP_LIST) {
      expect(map.deployment.length).toBeGreaterThan(0);
      for (const zone of map.deployment) {
        for (const tile of zone.tiles) {
          expect(tile.x).toBeGreaterThanOrEqual(0);
          expect(tile.x).toBeLessThan(map.width);
          expect(tile.y).toBeGreaterThanOrEqual(0);
          expect(tile.y).toBeLessThan(map.height);
          const terrain = terrainFromChar(map.layout[tile.y]?.[tile.x] ?? "");
          expect(terrain).toBeDefined();
          expect(
            getTerrainDef(terrain as never).passable,
            `${map.id} deploy ${tile.x},${tile.y}`,
          ).toBe(true);
        }
      }
    }
  });

  it("points each objective at a tile inside the grid", () => {
    for (const map of BATTLE_MAP_LIST) {
      const objective = map.objective;
      if ("at" in objective) {
        expect(objective.at.x).toBeGreaterThanOrEqual(0);
        expect(objective.at.x).toBeLessThan(map.width);
        expect(objective.at.y).toBeGreaterThanOrEqual(0);
        expect(objective.at.y).toBeLessThan(map.height);
      }
    }
  });

  it("resolves every cross-reference (location ↔ map ↔ contract)", () => {
    const contractIds = new Set(Object.keys(CONTRACTS));
    for (const map of BATTLE_MAP_LIST) {
      expect(isLocationKey(map.locationId), `${map.id} location`).toBe(true);
      expect(battleMapsForLocation(map.locationId)).toContain(map);
      if (map.contractId !== undefined) {
        expect(contractIds.has(map.contractId), `${map.id} contract ${map.contractId}`).toBe(true);
      }
    }
  });

  it("looks maps up and filters by location and contract", () => {
    expect(isBattleMapKey("highland-pass")).toBe(true);
    expect(isBattleMapKey("moon")).toBe(false);
    expect(getBattleMap("crossroads-skirmish").name).toBe("The Crossroads Stand");
    expect(() => getBattleMap("moon" as never)).toThrow(RangeError);

    expect(battleMapsForLocation("blackwood").map((map) => map.id)).toEqual([
      "blackwood-picket",
      "guerrilla-camp",
    ]);
    expect(battleMapsForContract("break-the-bridge").map((map) => map.id)).toEqual([
      "sainte-colombe-bridge",
    ]);
    expect(battleMapObjective("blackwood-picket")).toEqual({ kind: "rout", defeated: 3 });
  });

  it("maps every objective kind onto a structurally valid engine objective", () => {
    for (const map of BATTLE_MAP_LIST) {
      expect(() => assertObjective(map.objective, map.id)).not.toThrow();
    }
  });
});

/* --------------------------------------------------------------------------
 * Layout expansion — the bridge from authoring format to engine tiles
 * ------------------------------------------------------------------------ */

describe("battle map layout expansion (T074)", () => {
  it("expands row-major, matching the authored codes", () => {
    for (const map of BATTLE_MAP_LIST) {
      const tiles = expandBattleMap(map);
      expect(tiles).toHaveLength(map.width * map.height);
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          const tile = tiles[y * map.width + x];
          expect(tile?.terrain).toBe(terrainFromChar(map.layout[y]?.[x] ?? ""));
          const expectedHeight =
            map.elevation === undefined ? 0 : heightFromChar(map.elevation[y]?.[x] ?? "");
          expect(tile?.height).toBe(expectedHeight);
        }
      }
    }
  });

  it("returns a value assignable to the engine's TerrainMap", () => {
    const map = getBattleMap("highland-pass");
    const terrain = battleMapToTerrainMap(map);
    expect(terrain.grid).toEqual({ width: map.width, height: map.height });

    // The engine reads the expanded board without any cast: proof the data
    // layer's shapes line up with `TerrainMap`.
    expect(terrainAt(terrain, coord(0, 0))).toBe("hill");
    expect(heightAt(terrain, coord(0, 0))).toBe(2);
    expect(heightAt(terrain, coord(4, 4))).toBe(0);

    const flat = battleMapToTerrainMap(getBattleMap("sainte-colombe-bridge"));
    expect(terrainAt(flat, coord(5, 4))).toBe("bridge");
    expect(terrainAt(flat, coord(5, 3))).toBe("river");
  });

  it("can be handed straight to createBattle as a real battlefield", () => {
    const map = getBattleMap("sainte-colombe-bridge");
    const battle = createBattle(1815, {
      map: battleMapToTerrainMap(map),
      units: [makeUnit("company-1", coord(1, 4)), makeUnit("enemy-1", coord(10, 4))],
      abilities: [
        { id: asAbilityId("musket-fire"), mpCost: 4, chargeTime: 0, range: 5, power: 100 },
      ],
      objective: map.objective,
    });
    expect(battle.map.tiles).toHaveLength(map.width * map.height);
    expect(battle.phase).toBe("active");
  });
});

/* --------------------------------------------------------------------------
 * The schema boundary rejects malformed boards
 * ------------------------------------------------------------------------ */

describe("battle map schema rejection (T074)", () => {
  const base = {
    name: "Test Field",
    description: "A test board.",
    flavour: "A board for testing.",
    locationId: "sainte-colombe",
    width: 3,
    height: 2,
    layout: ["...", "..."],
    objective: { kind: "annihilation" },
  };

  it("accepts the minimal flat board", () => {
    const parsed = BattleMapDefSchema.parse({ id: "test", ...base });
    expect(parsed.elevation).toBeUndefined();
    expect(parsed.deployment).toEqual([]);
    expect(parsed.recommendedLevel).toBe(1);
  });

  it("rejects a ragged layout", () => {
    expect(
      BattleMapDefSchema.safeParse({ id: "test", ...base, layout: ["...", ".."] }).success,
    ).toBe(false);
    expect(BattleMapDefSchema.safeParse({ id: "test", ...base, layout: ["..."] }).success).toBe(
      false,
    );
    expect(
      BattleMapDefSchema.safeParse({ id: "test", ...base, layout: ["...", "...", "..."] }).success,
    ).toBe(false);
  });

  it("rejects an unknown terrain character", () => {
    expect(
      BattleMapDefSchema.safeParse({ id: "test", ...base, layout: ["..Z", "..."] }).success,
    ).toBe(false);
  });

  it("rejects a malformed elevation layer", () => {
    expect(
      BattleMapDefSchema.safeParse({ id: "test", ...base, elevation: ["000", "00"] }).success,
    ).toBe(false);
    expect(
      BattleMapDefSchema.safeParse({ id: "test", ...base, elevation: ["000", "00g"] }).success,
    ).toBe(false);
  });

  it("rejects out-of-bounds deployment and objective tiles", () => {
    expect(
      BattleMapDefSchema.safeParse({
        id: "test",
        ...base,
        deployment: [{ side: "company", tiles: [{ x: 3, y: 0 }] }],
      }).success,
    ).toBe(false);
    expect(
      BattleMapDefSchema.safeParse({
        id: "test",
        ...base,
        objective: { kind: "capture", at: { x: 0, y: 5 } },
      }).success,
    ).toBe(false);
  });

  it("rejects unknown objective kinds and missing display fields", () => {
    expect(
      BattleMapDefSchema.safeParse({ id: "test", ...base, objective: { kind: "conquer" } }).success,
    ).toBe(false);
    const missingFlavour: Record<string, unknown> = { ...base };
    delete missingFlavour.flavour;
    expect(BattleMapDefSchema.safeParse({ id: "test", ...missingFlavour }).success).toBe(false);
  });
});

/* --------------------------------------------------------------------------
 * T092 — The battle map catalogue
 *
 * T074 laid down the schemas, the location table and a first handful of
 * boards. T092 grows the catalogue to a full slate of 10–20 varied battle
 * maps, adding JSON-authored grids for the larger fields. These tests pin the
 * acceptance criteria: enough maps, objectives that cover every engine kind,
 * boards that genuinely differ, and every JSON file loaded and validated.
 * ------------------------------------------------------------------------ */

describe("battle map catalogue (T092)", () => {
  it("authors between 10 and 20 varied battle maps", () => {
    expect(BATTLE_MAP_LIST.length).toBeGreaterThanOrEqual(10);
    expect(BATTLE_MAP_LIST.length).toBeLessThanOrEqual(20);
    expect(new Set(BATTLE_MAP_LIST.map((map) => map.id)).size).toBe(BATTLE_MAP_LIST.length);
  });

  it("covers every objective kind the engine can score", () => {
    const kinds = new Set(BATTLE_MAP_LIST.map((map) => map.objective.kind));
    expect([...kinds].sort()).toEqual(["annihilation", "capture", "defend", "rout", "survive"]);
  });

  it("varies board sizes and recommendations across the slate", () => {
    const areas = new Set(BATTLE_MAP_LIST.map((map) => map.width * map.height));
    expect(areas.size).toBeGreaterThanOrEqual(5);
    expect(new Set(BATTLE_MAP_LIST.map((map) => map.recommendedLevel)).size).toBeGreaterThan(1);
  });

  it("loads every JSON-authored board and pins its id to its key", () => {
    expect(JSON_BATTLE_MAP_KEYS.length).toBeGreaterThan(0);
    for (const key of JSON_BATTLE_MAP_KEYS) {
      const map = BATTLE_MAPS[key];
      expect(map.id).toBe(key);
      expect(BATTLE_MAP_KEYS).toContain(key);
      expect(map.deployment.length).toBeGreaterThan(0);
      expect(map.recommendedLevel).toBeGreaterThan(0);
      expect(map.objective).toBeDefined();
    }
  });

  it("keeps every JSON board on the engine's playable ground", () => {
    for (const key of JSON_BATTLE_MAP_KEYS) {
      const map = BATTLE_MAPS[key];
      const terrain = battleMapToTerrainMap(map);
      for (const zone of map.deployment) {
        for (const tile of zone.tiles) {
          expect(terrain.grid.width).toBe(map.width);
          expect(terrain.grid.height).toBe(map.height);
          expect(
            getTerrainDef(terrainAt(terrain, coord(tile.x, tile.y))).passable,
            `${map.id} deploy ${tile.x},${tile.y}`,
          ).toBe(true);
        }
      }
    }
  });

  it("gives each new map an authored location whose handle resolves", () => {
    for (const key of JSON_BATTLE_MAP_KEYS) {
      const map = BATTLE_MAPS[key];
      expect(isLocationKey(map.locationId), `${map.id} → ${map.locationId}`).toBe(true);
      expect(getLocation(map.locationId as never).battleMapIds).toContain(key);
    }
  });
});

/* --------------------------------------------------------------------------
 * T144 — Elevation authoring for the authored boards
 *
 * The isometric renderer, the climb premium and the high-ground range rule all
 * read a tile's `height`, but a missing `elevation` layer silently expands to a
 * level board. These tests pin the audit: the Quick Battle farmhouse carries a
 * real terrace (low approach → orchard bank → raised core), its deployment and
 * capture tiles stay valid and reachable, and the deliberately level boards
 * say so by staying flat.
 * ------------------------------------------------------------------------ */

describe("battle map elevation (T144)", () => {
  /** Boards whose terrain is deliberately level; see their descriptions. */
  const FLAT_BOARDS: ReadonlySet<string> = new Set(["crossroads-skirmish", "duel-at-dawn"]);

  it("raises the quick-battle farmhouse into three height bands", () => {
    const map = getBattleMap("farmhouse-assault");
    expect(map.elevation, "farmhouse-assault must author an elevation layer").toBeDefined();

    const heights = [...new Set(expandBattleMap(map).map((tile) => tile.height))].sort(
      (a, b) => a - b,
    );
    expect(heights).toEqual([0, 1, 2]);

    const terrain = battleMapToTerrainMap(map);
    // Low approach, readable orchard bank, raised farmhouse core.
    expect(heightAt(terrain, coord(0, 3))).toBe(0);
    expect(heightAt(terrain, coord(4, 0))).toBe(1);
    expect(heightAt(terrain, coord(6, 4))).toBe(2);
  });

  it("keeps the quick-battle deployment tiles and capture objective passable", () => {
    const map = getBattleMap("farmhouse-assault");
    const terrain = battleMapToTerrainMap(map);
    const objective = map.objective;
    if (objective.kind !== "capture") {
      throw new Error("the quick-battle farmhouse must be a capture objective");
    }

    expect(objective.at).toEqual({ x: 6, y: 4 });
    expect(
      getTerrainDef(terrainAt(terrain, coord(objective.at.x, objective.at.y))).passable,
      "farmhouse capture objective must stand on passable ground",
    ).toBe(true);

    for (const zone of map.deployment) {
      for (const tile of zone.tiles) {
        expect(
          getTerrainDef(terrainAt(terrain, coord(tile.x, tile.y))).passable,
          `farmhouse ${zone.side} deploy ${tile.x},${tile.y}`,
        ).toBe(true);
      }
    }
  });

  it("makes the capture objective reachable from every quick-battle deployment tile", () => {
    const map = getBattleMap("farmhouse-assault");
    const terrain = battleMapToTerrainMap(map);
    const objective = map.objective;
    if (objective.kind !== "capture") {
      throw new Error("the quick-battle farmhouse must be a capture objective");
    }
    const target = coord(objective.at.x, objective.at.y);

    // The quick battle's slowest climbers have Climb 2 (`skirmishScenario`), so
    // a route at that limit proves the raised core is not cut off.
    for (const zone of map.deployment) {
      for (const tile of zone.tiles) {
        const path = findPath(terrain, coord(tile.x, tile.y), target, { climb: 2 });
        expect(path.found, `farmhouse ${zone.side} ${tile.x},${tile.y} → objective`).toBe(
          true,
        );
        expect(path.path[0]).toEqual(tile);
        expect(path.path.at(-1)).toEqual(objective.at);
      }
    }
  });

  it("leaves only the deliberately level boards flat", () => {
    for (const map of BATTLE_MAP_LIST) {
      if (FLAT_BOARDS.has(map.id)) {
        expect(map.elevation, `${map.id} is deliberately flat`).toBeUndefined();
        continue;
      }
      expect(map.elevation, `${map.id} implies relief and must author it`).toBeDefined();
      const heights = new Set(expandBattleMap(map).map((tile) => tile.height));
      expect(heights.size, `${map.id} needs more than one height`).toBeGreaterThan(1);
    }
  });

  it("keeps every authored elevation step within a Climb-2 stride", () => {
    for (const map of BATTLE_MAP_LIST) {
      if (map.elevation === undefined) continue;
      const tiles = expandBattleMap(map);
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          const here = tiles[y * map.width + x]!;
          if (!getTerrainDef(here.terrain).passable) continue;
          for (const [dx, dy] of [
            [1, 0],
            [0, 1],
          ] as const) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= map.width || ny >= map.height) continue;
            const next = tiles[ny * map.width + nx]!;
            if (!getTerrainDef(next.terrain).passable) continue;
            expect(
              Math.abs(next.height - here.height),
              `${map.id} step ${x},${y} → ${nx},${ny}`,
            ).toBeLessThanOrEqual(2);
          }
        }
      }
    }
  });
});

/* --------------------------------------------------------------------------
 * Bundle
 * ------------------------------------------------------------------------ */

describe("map bundle (T074)", () => {
  it("parses the whole authored theatre in one pass", () => {
    const bundle = MapBundleSchema.parse({
      locations: LOCATION_LIST,
      battleMaps: BATTLE_MAP_LIST,
    });
    expect(bundle.locations).toHaveLength(LOCATION_KEYS.length);
    expect(bundle.battleMaps).toHaveLength(BATTLE_MAP_KEYS.length);
  });

  it("defaults both collections to empty", () => {
    const bundle = MapBundleSchema.parse({});
    expect(bundle.locations).toEqual([]);
    expect(bundle.battleMaps).toEqual([]);
  });

  it("round-trips a parsed battle map through JSON unchanged", () => {
    const map: BattleMapDef = getBattleMap("guerrilla-camp");
    const roundTripped = BattleMapDefSchema.parse(JSON.parse(JSON.stringify(map)));
    expect(roundTripped).toEqual(map);
  });
});
