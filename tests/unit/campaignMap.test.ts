import { describe, expect, it } from "vitest";

import {
  CAMPAIGN_MAP_MAX_DIMENSION,
  CampaignMapError,
  TRAVEL_DAYS_FALLBACK,
  TREASURE_RULE_DEFAULT_COUNT,
  canPlaceMarker,
  createCampaignMap,
  createCampaignMarker,
  createTreasureRule,
  findTreasure,
  huntTreasure,
  isCampaignMap,
  isHunted,
  isSlotEmpty,
  markerAt,
  neighbourTerrains,
  parseCampaignMap,
  placeMarker,
  placementBlockers,
  placementCount,
  placementForMarker,
  placementForRegion,
  travelCompany,
  travelDays,
  travelPlan,
  type CampaignMapState,
  type CampaignMarker,
  type CampaignMarkerInit,
  type TreasureRuleInit,
} from "../../src/engine/campaignMap";
import { createCompany, type Company } from "../../src/engine/company";
import { coord } from "../../src/engine/grid";
import { IdError, asCompanyId, asMapTokenId, asRegionId } from "../../src/engine/ids";

/* --------------------------------------------------------------------------
 * T073 — Campaign Map + Campaign Markers
 *
 * Pins the task's "done when": an **empty map grows** as **Campaign Markers**
 * are placed into slots; the company can **travel** between placed regions and
 * run a **treasure hunt**; and the **rewards depend on placement** (adjacent
 * terrain changes what a hunt finds). The tests also pin the guarantees the
 * rest of Phase 6 leans on: every transition is pure, malformed data fails at
 * the boundary and a map round-trips through `parseCampaignMap`.
 * ------------------------------------------------------------------------ */

/* --------------------------------------------------------------------------
 * Fixtures
 * ------------------------------------------------------------------------ */

function makeRule(overrides: Partial<TreasureRuleInit> = {}): TreasureRuleInit {
  return { itemId: "water-canteen", nearTerrain: null, ...overrides };
}

function makeMarker(overrides: Partial<CampaignMarkerInit> = {}): CampaignMarkerInit {
  return {
    id: asMapTokenId("start"),
    name: "Sainte-Colombe",
    terrain: "bridge",
    regionId: asRegionId("sainte-colombe"),
    ...overrides,
  };
}

/** The authored starting location of the theatre (FFTA's fixed first token). */
const START: CampaignMarker = createCampaignMarker(
  makeMarker({
    treasure: [
      makeRule({ itemId: "powder-flask" }),
      makeRule({ itemId: "water-canteen", nearTerrain: "river" }),
    ],
  }),
);

/** A wood token whose spoils change with what it is placed next to. */
const WOOD: CampaignMarker = createCampaignMarker(
  makeMarker({
    id: asMapTokenId("wood-token"),
    name: "The Blackwood",
    terrain: "wood",
    regionId: asRegionId("blackwood"),
    treasure: [
      makeRule({ itemId: "water-canteen" }),
      makeRule({ itemId: "forester-bow", nearTerrain: "wood" }),
      makeRule({ itemId: "spyglass", nearTerrain: "hill" }),
    ],
  }),
);

/** A second wood token, so a marker can be flanked by two of the same terrain. */
const WOOD_TWO: CampaignMarker = createCampaignMarker(
  makeMarker({
    id: asMapTokenId("wood-token-2"),
    name: "The Koringwood",
    terrain: "wood",
    regionId: asRegionId("koringwood"),
  }),
);

/** A rising-ground token that pays out near woods. */
const HILL: CampaignMarker = createCampaignMarker(
  makeMarker({
    id: asMapTokenId("hill-token"),
    name: "The Highlands",
    terrain: "hill",
    regionId: asRegionId("the-highlands"),
    treasure: [
      makeRule({ itemId: "spyglass", nearTerrain: "wood" }),
      makeRule({ itemId: "six-pounder", nearTerrain: "hill", count: 2 }),
    ],
  }),
);

function makeMap(
  overrides: Partial<Parameters<typeof createCampaignMap>[0]> = {},
): CampaignMapState {
  return createCampaignMap({ width: 4, height: 4, ...overrides });
}

function makeCompany(overrides: Partial<Parameters<typeof createCompany>[0]> = {}): Company {
  return createCompany({ id: asCompanyId("company-1"), name: "The Greycoats", ...overrides });
}

/* --------------------------------------------------------------------------
 * Markers & rules
 * ------------------------------------------------------------------------ */

describe("CampaignMarker — the FFTA area token, re-authored", () => {
  it("builds a marker with a default (empty) treasure table", () => {
    const marker = createCampaignMarker(makeMarker());
    expect(marker.id).toBe("start");
    expect(marker.name).toBe("Sainte-Colombe");
    expect(marker.terrain).toBe("bridge");
    expect(marker.regionId).toBe("sainte-colombe");
    expect(marker.treasure).toEqual([]);
  });

  it("defaults a treasure rule's count and terrain", () => {
    const rule = createTreasureRule({ itemId: "spyglass" });
    expect(rule.count).toBe(TREASURE_RULE_DEFAULT_COUNT);
    expect(rule.nearTerrain).toBeNull();
  });

  it("rejects malformed markers and rules", () => {
    expect(() => createCampaignMarker(makeMarker({ id: "" as never }))).toThrow(IdError);
    expect(() => createCampaignMarker(makeMarker({ name: "  " }))).toThrow(RangeError);
    expect(() => createCampaignMarker(makeMarker({ terrain: "sky" as never }))).toThrow(RangeError);
    expect(() => createCampaignMarker(makeMarker({ regionId: "" as never }))).toThrow(IdError);

    expect(() => createTreasureRule({ itemId: "" })).toThrow(IdError);
    expect(() => createTreasureRule({ itemId: "x", count: 0 })).toThrow(RangeError);
    expect(() => createTreasureRule({ itemId: "x", count: 1.5 })).toThrow(RangeError);
    expect(() => createTreasureRule({ itemId: "x", nearTerrain: "sky" as never })).toThrow(
      RangeError,
    );
  });
});

/* --------------------------------------------------------------------------
 * The map starts empty and grows
 * ------------------------------------------------------------------------ */

describe("createCampaignMap — the theatre starts (nearly) empty", () => {
  it("opens as a blank grid apart from the authored starting location", () => {
    const map = makeMap({ placements: [{ slot: coord(0, 0), marker: START }] });
    expect(map.grid).toEqual({ width: 4, height: 4 });
    expect(placementCount(map)).toBe(1);
    expect(markerAt(map, coord(0, 0))?.id).toBe("start");
    expect(isSlotEmpty(map, coord(1, 1))).toBe(true);
    expect(map.huntedSlots).toEqual([]);
  });

  it("starts with no placements at all when none are authored", () => {
    const map = makeMap();
    expect(placementCount(map)).toBe(0);
  });

  it("rejects malformed dimensions and out-of-range maps", () => {
    expect(() => createCampaignMap({ width: 0, height: 4 })).toThrow(RangeError);
    expect(() => createCampaignMap({ width: 4, height: 1.5 })).toThrow(RangeError);
    expect(() => createCampaignMap({ width: CAMPAIGN_MAP_MAX_DIMENSION + 1, height: 1 })).toThrow(
      RangeError,
    );
  });

  it("rejects out-of-bounds, duplicate-slot and duplicate-marker placements", () => {
    expect(() => makeMap({ placements: [{ slot: coord(4, 0), marker: START }] })).toThrow(
      RangeError,
    );
    expect(() =>
      makeMap({
        placements: [
          { slot: coord(0, 0), marker: START },
          { slot: coord(0, 0), marker: WOOD },
        ],
      }),
    ).toThrow(RangeError);
    expect(() =>
      makeMap({
        placements: [
          { slot: coord(0, 0), marker: START },
          { slot: coord(1, 0), marker: START },
        ],
      }),
    ).toThrow(RangeError);
  });

  it("rejects a hunted slot that is not on the map", () => {
    expect(() => makeMap({ huntedSlots: ["9,9"] })).toThrow(RangeError);
    expect(() => makeMap({ huntedSlots: ["nonsense"] })).toThrow(RangeError);
  });
});

describe("placeMarker — the map grows one token at a time", () => {
  it("places a marker into an empty slot and grows the map", () => {
    const empty = makeMap();
    expect(canPlaceMarker(empty, WOOD, coord(2, 2))).toBe(true);

    const grown = placeMarker(empty, WOOD, coord(2, 2));
    expect(placementCount(grown)).toBe(1);
    expect(markerAt(grown, coord(2, 2))?.regionId).toBe("blackwood");
    expect(placementForMarker(grown, asMapTokenId("wood-token"))?.slot).toEqual(coord(2, 2));

    // Pure: the original map is untouched (structural sharing is fine).
    expect(placementCount(empty)).toBe(0);
    expect(isSlotEmpty(empty, coord(2, 2))).toBe(true);
  });

  it("reports every reason a placement is blocked", () => {
    const map = makeMap({ placements: [{ slot: coord(0, 0), marker: START }] });
    expect(placementBlockers(map, WOOD, coord(0, 0))).toContain("slot-occupied");
    expect(placementBlockers(map, WOOD, coord(9, 9))).toContain("out-of-bounds");

    const placed = placeMarker(map, WOOD, coord(1, 0));
    expect(placementBlockers(placed, WOOD, coord(2, 0))).toContain("marker-already-placed");
    expect(canPlaceMarker(placed, WOOD, coord(2, 0))).toBe(false);
  });

  it("throws when a placement is blocked", () => {
    const map = makeMap({ placements: [{ slot: coord(0, 0), marker: START }] });
    expect(() => placeMarker(map, WOOD, coord(0, 0))).toThrow(/slot-occupied/);
    expect(() => placeMarker(map, WOOD, coord(9, 9))).toThrow(/out-of-bounds/);
    const placed = placeMarker(map, WOOD, coord(1, 0));
    expect(() => placeMarker(placed, WOOD, coord(2, 0))).toThrow(/marker-already-placed/);
  });

  it("resolves a region to the marker that established it", () => {
    const map = placeMarker(makeMap(), WOOD, coord(2, 2));
    expect(placementForRegion(map, asRegionId("blackwood"))?.slot).toEqual(coord(2, 2));
    expect(placementForRegion(map, asRegionId("nowhere"))).toBeUndefined();
  });
});

/* --------------------------------------------------------------------------
 * Travel (mapping §10)
 * ------------------------------------------------------------------------ */

describe("travel — marching the company between charted regions", () => {
  const travelled = () =>
    makeMap({
      placements: [
        { slot: coord(0, 0), marker: START },
        { slot: coord(2, 1), marker: WOOD },
      ],
    });

  it("costs one campaign day per grid step (FFTA world-map movement)", () => {
    const map = travelled();
    expect(travelDays(map, coord(0, 0), coord(2, 1))).toBe(3);
    expect(travelDays(map, coord(0, 0), coord(0, 0))).toBe(0);
    expect(() => travelDays(map, coord(0, 0), coord(9, 9))).toThrow(RangeError);
  });

  it("plans a march from the current region to a placed region", () => {
    const map = travelled();
    const plan = travelPlan(map, asRegionId("sainte-colombe"), asRegionId("blackwood"));
    expect(plan.from).toEqual(coord(0, 0));
    expect(plan.to).toEqual(coord(2, 1));
    expect(plan.days).toBe(3);
    expect(plan.toRegionId).toBe("blackwood");
  });

  it("charges a fallback day when the company is not on this map", () => {
    const map = travelled();
    expect(travelPlan(map, null, asRegionId("blackwood")).days).toBe(TRAVEL_DAYS_FALLBACK);
    expect(travelPlan(map, asRegionId("unknown"), asRegionId("blackwood")).days).toBe(
      TRAVEL_DAYS_FALLBACK,
    );
  });

  it("rejects travelling to a region that is not placed", () => {
    expect(() => travelPlan(travelled(), null, asRegionId("nowhere"))).toThrow(RangeError);
  });

  it("moves the company, charts the region and advances the clock by the march", () => {
    const map = travelled();
    const company = makeCompany({ theatre: { day: 1, regionId: asRegionId("sainte-colombe") } });
    const { company: arrived, plan } = travelCompany(company, map, asRegionId("blackwood"));

    expect(plan.days).toBe(3);
    expect(arrived.theatre.regionId).toBe("blackwood");
    expect(arrived.theatre.day).toBe(4);
    expect(arrived.theatre.knownRegionIds).toEqual(["sainte-colombe", "blackwood"]);

    // Pure: the source company is untouched.
    expect(company.theatre.day).toBe(1);
    expect(company.theatre.regionId).toBe("sainte-colombe");
  });

  it("does not advance the clock when the company is already there", () => {
    const map = travelled();
    const company = makeCompany({
      theatre: { day: 7, regionId: asRegionId("blackwood") },
    });
    const { company: arrived, plan } = travelCompany(company, map, asRegionId("blackwood"));
    expect(plan.days).toBe(0);
    expect(arrived.theatre.day).toBe(7);
    expect(arrived).toEqual(company);
  });
});

/* --------------------------------------------------------------------------
 * Treasure hunting — rewards depend on placement
 * ------------------------------------------------------------------------ */

describe("treasure hunting — placement decides the spoils", () => {
  it("always pays out an unconditional rule", () => {
    const map = placeMarker(makeMap(), WOOD, coord(0, 0));
    const finds = findTreasure(map, coord(0, 0));
    expect(finds).toEqual([
      { slot: coord(0, 0), itemId: "water-canteen", count: 1, nearTerrain: null },
    ]);
  });

  it("changes the loot when the same token is placed beside different terrain", () => {
    // Wood alone in a corner: only the unconditional canteen.
    const lonely = placeMarker(makeMap(), WOOD, coord(0, 0));
    expect(findTreasure(lonely, coord(0, 0)).map((find) => find.itemId)).toEqual(["water-canteen"]);

    // Drop a hill next door: the wood now also yields a spyglass...
    const besideHill = placeMarker(lonely, HILL, coord(1, 0));
    expect(findTreasure(besideHill, coord(0, 0)).map((find) => find.itemId)).toEqual([
      "water-canteen",
      "spyglass",
    ]);

    // ...and the hill, facing the wood, yields its own spyglass rule.
    expect(findTreasure(besideHill, coord(1, 0)).map((find) => find.itemId)).toEqual(["spyglass"]);
  });

  it("multiplies a rule by the number of matching neighbours", () => {
    // A hill whose six-pounder rule (count 2) needs an adjacent hill.
    const hillTwo = createCampaignMarker(
      makeMarker({
        id: asMapTokenId("hill-token-2"),
        name: "Second Height",
        terrain: "hill",
        regionId: asRegionId("hill-2"),
      }),
    );
    const hills = placeMarker(placeMarker(makeMap(), HILL, coord(1, 1)), hillTwo, coord(1, 2));
    const sixPounder = findTreasure(hills, coord(1, 1)).find(
      (find) => find.itemId === "six-pounder",
    );
    expect(sixPounder?.count).toBe(2); // base count 2 × one matching neighbour

    // A wood with a same-terrain rule fires once per adjacent wood.
    const woods = placeMarker(placeMarker(makeMap(), WOOD, coord(0, 0)), WOOD_TWO, coord(1, 0));
    const bow = findTreasure(woods, coord(0, 0)).find((find) => find.itemId === "forester-bow");
    expect(bow?.count).toBe(1);
  });

  it("hunts a location once and records the hunt", () => {
    const map = placeMarker(makeMap(), WOOD, coord(0, 0));
    expect(isHunted(map, coord(0, 0))).toBe(false);

    const hunt = huntTreasure(map, coord(0, 0));
    expect(hunt.finds).toHaveLength(1);
    expect(isHunted(hunt.map, coord(0, 0))).toBe(true);
    expect(isHunted(map, coord(0, 0))).toBe(false); // pure: input untouched

    expect(() => huntTreasure(hunt.map, coord(0, 0))).toThrow(/already been hunted/);
  });

  it("refuses to hunt an empty slot", () => {
    const map = makeMap();
    expect(findTreasure(map, coord(1, 1))).toEqual([]);
    expect(() => huntTreasure(map, coord(1, 1))).toThrow(/empty slot/);
  });

  it("lists adjacent terrains in facing order", () => {
    const map = placeMarker(
      placeMarker(placeMarker(makeMap(), HILL, coord(1, 0)), WOOD, coord(0, 1)),
      START,
      coord(1, 1),
    );
    // For (1,1): north = hill at (1,0), east out, south out, west = wood at (0,1).
    expect(neighbourTerrains(map, coord(1, 1))).toEqual(["hill", "wood"]);
  });
});

/* --------------------------------------------------------------------------
 * Purity & the save boundary
 * ------------------------------------------------------------------------ */

describe("Purity — transitions never mutate the input", () => {
  it("leaves the original map byte-identical after every transition", () => {
    const original = makeMap({ placements: [{ slot: coord(0, 0), marker: START }] });
    const snapshot = JSON.parse(JSON.stringify(original)) as CampaignMapState;

    placeMarker(original, WOOD, coord(1, 0));
    huntTreasure(original, coord(0, 0));
    findTreasure(original, coord(0, 0));
    neighbourTerrains(original, coord(0, 0));

    expect(JSON.parse(JSON.stringify(original))).toEqual(snapshot);
  });
});

describe("parseCampaignMap — the save boundary", () => {
  it("round-trips a grown map through JSON and preserves its content", () => {
    const original = huntTreasure(
      placeMarker(
        makeMap({ placements: [{ slot: coord(0, 0), marker: START }] }),
        WOOD,
        coord(1, 0),
      ),
      coord(0, 0),
    ).map;

    const parsed = parseCampaignMap(JSON.parse(JSON.stringify(original)) as unknown);
    expect(parsed).toEqual(original);
    expect(isCampaignMap(original)).toBe(true);
    expect(placementCount(parsed)).toBe(2);
    expect(isHunted(parsed, coord(0, 0))).toBe(true);
  });

  it("rejects values that are not a campaign map", () => {
    expect(() => parseCampaignMap(null)).toThrow(CampaignMapError);
    expect(() => parseCampaignMap([])).toThrow(CampaignMapError);
    expect(() => parseCampaignMap({ grid: { width: 0, height: 1 } })).toThrow(CampaignMapError);
    expect(isCampaignMap({ grid: { width: 1, height: 1 }, placements: [{}] })).toBe(false);
    expect(isCampaignMap({ nope: true })).toBe(false);
  });
});
