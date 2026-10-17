import { describe, expect, it } from "vitest";

import { EQUIPMENT, getEquipment } from "../../src/data/equipment";
import type { EquipmentDef } from "../../src/data/schema";

import { createCompany, travelTo, type Company } from "../../src/engine/company";
import {
  DepotError,
  addToInventory,
  buyBlockers,
  buyKit,
  buyPrice,
  buyPriceOf,
  canBuy,
  canSell,
  createDepot,
  createDepotInventory,
  hasInInventory,
  inventoryCount,
  isDepot,
  parseDepot,
  priceTier,
  removeFromInventory,
  sellBlockers,
  sellKit,
  sellPrice,
  sellPriceOf,
  type Depot,
} from "../../src/engine/depot";
import { asCompanyId, asDepotId, asEquipmentId, asRegionId } from "../../src/engine/ids";

/* --------------------------------------------------------------------------
 * T075 — Depots (shops)
 *
 * The depot must **buy/sell** with **power-specific discounts** and **region
 * gating**, preserving FFTA's shop rule that a town's dominant race makes its
 * own kit cheaper while foreign gear is dearer. These tests pin the pricing
 * tiers, the gate blockers and the pure transactions (company + inventory).
 * ------------------------------------------------------------------------ */

const REGION = asRegionId("sainte-colombe");

function makeDepot(overrides: Partial<Depot> = {}): Depot {
  return createDepot({
    id: asDepotId("depot-sainte-colombe"),
    name: "Sainte-Colombe Quartermaster",
    regionId: REGION,
    power: "france",
    stock: ["charleville-musket", "forester-bow", "baker-rifle", "spyglass"],
    ...overrides,
  });
}

function makeCompany(crowns = 5000, regionId = REGION): Company {
  return createCompany({
    id: asCompanyId("company-greycoats"),
    name: "The Greycoats",
    crowns,
    theatre: { regionId },
  });
}

/** A synthetic unique/quest item with no authored cost. */
const UNIQUE_KIT: EquipmentDef = { ...EQUIPMENT["baker-rifle"], id: "relic", cost: null };

describe("createDepot — trust boundary", () => {
  it("brands the stock and de-duplicates it in authoring order", () => {
    const depot = createDepot({
      id: asDepotId("depot-1"),
      name: "Test Stores",
      regionId: REGION,
      power: "britain",
      stock: ["baker-rifle", "baker-rifle", "forester-bow"],
    });
    expect(depot.stock).toEqual(["baker-rifle", "forester-bow"]);
  });

  it("rejects unknown kit, powers and malformed fields", () => {
    expect(() =>
      createDepot({
        id: asDepotId("depot-1"),
        name: "Test Stores",
        regionId: REGION,
        power: "france",
        stock: ["not-a-thing"],
      }),
    ).toThrow(RangeError);

    expect(() =>
      createDepot({
        id: asDepotId("depot-1"),
        name: "Test Stores",
        regionId: REGION,
        // A school that does not exist in the five-power mapping.
        power: "spain" as never,
      }),
    ).toThrow(RangeError);

    expect(() =>
      createDepot({ id: asDepotId("depot-1"), name: "", regionId: REGION, power: "france" }),
    ).toThrow(RangeError);
  });

  it("round-trips through parseDepot and rejects malformed values", () => {
    const depot = makeDepot();
    expect(parseDepot(depot)).toEqual(depot);
    expect(isDepot(depot)).toBe(true);
    expect(isDepot({})).toBe(false);
    expect(() => parseDepot(null)).toThrow(DepotError);
  });
});

describe("priceTier — power-specific favour", () => {
  const depot = makeDepot({ power: "france" });

  it("favours the depot's own power", () => {
    expect(priceTier(depot, getEquipment("charleville-musket"))).toBe("favoured");
  });

  it("treats neutral kit as standard", () => {
    expect(getEquipment("forester-bow").power).toBeUndefined();
    expect(priceTier(depot, getEquipment("forester-bow"))).toBe("standard");
  });

  it("treats another power's kit as foreign", () => {
    expect(priceTier(depot, getEquipment("baker-rifle"))).toBe("foreign");
    expect(priceTier(depot, getEquipment("spyglass"))).toBe("foreign");
  });
});

describe("buyPrice / sellPrice", () => {
  const depot = makeDepot({ power: "france" });

  it("discounts favoured kit and surcharges foreign kit", () => {
    // Charleville Musket (france, 400): 80% buy, 60% sell.
    expect(buyPrice(depot, getEquipment("charleville-musket"))).toBe(320);
    expect(sellPrice(depot, getEquipment("charleville-musket"))).toBe(240);

    // Forester's Bow (neutral, 120): 100% buy, 50% sell.
    expect(buyPrice(depot, getEquipment("forester-bow"))).toBe(120);
    expect(sellPrice(depot, getEquipment("forester-bow"))).toBe(60);

    // Baker Rifle (britain, 900): 120% buy, 40% sell.
    expect(buyPrice(depot, getEquipment("baker-rifle"))).toBe(1080);
    expect(sellPrice(depot, getEquipment("baker-rifle"))).toBe(360);
  });

  it("prices the same item differently by the depot's power", () => {
    const france = makeDepot({ power: "france" });
    const britain = makeDepot({ power: "britain" });

    // The rifle is favoured in a British depot and foreign in a French one.
    expect(buyPriceOf(britain, "baker-rifle")).toBe(720);
    expect(buyPriceOf(france, "baker-rifle")).toBe(1080);
    expect(sellPriceOf(britain, "baker-rifle")).toBe(540);
    expect(sellPriceOf(france, "baker-rifle")).toBe(360);
  });

  it("refuses to price unique kit and floors a sale at one Crown", () => {
    expect(buyPrice(depot, UNIQUE_KIT)).toBeNull();
    expect(sellPrice(depot, UNIQUE_KIT)).toBeNull();

    const cheap: EquipmentDef = { ...EQUIPMENT["forester-bow"], cost: 1 };
    expect(buyPrice(depot, cheap)).toBe(1);
    expect(sellPrice(depot, cheap)).toBe(1);
  });
});

describe("region gating", () => {
  it("blocks trade when the company is not in the depot's region", () => {
    const depot = makeDepot();
    const company = makeCompany(5000, asRegionId("blackwood"));

    expect(buyBlockers(company, depot, "charleville-musket")).toContain("wrong-region");
    expect(canBuy(company, depot, "charleville-musket")).toBe(false);

    const inventory = createDepotInventory({ "charleville-musket": 1 });
    expect(sellBlockers(company, inventory, depot, "charleville-musket")).toContain("wrong-region");
    expect(canSell(company, inventory, depot, "charleville-musket")).toBe(false);
  });

  it("opens trade once the company is present", () => {
    const depot = makeDepot();
    const company = travelTo(makeCompany(5000, asRegionId("blackwood")), depot.regionId);
    expect(buyBlockers(company, depot, "charleville-musket")).toEqual([]);
    expect(canBuy(company, depot, "charleville-musket")).toBe(true);
  });

  it("gates stock and cost", () => {
    const depot = makeDepot();
    const company = makeCompany(5000);

    // Not carried by this depot.
    expect(buyBlockers(company, depot, "cuirass")).toContain("not-stocked");

    // Present but unaffordable.
    const poor = makeCompany(100);
    expect(buyBlockers(poor, depot, "baker-rifle")).toContain("insufficient-crowns");
    expect(canBuy(poor, depot, "baker-rifle")).toBe(false);
  });

  it("gates selling on ownership and unique kit", () => {
    const depot = makeDepot();
    const company = makeCompany(5000);

    const empty = createDepotInventory();
    expect(sellBlockers(company, empty, depot, "charleville-musket")).toContain("not-in-inventory");

    const owned = createDepotInventory({ "charleville-musket": 1 });
    expect(sellBlockers(company, owned, depot, "charleville-musket")).toEqual([]);
    expect(canSell(company, owned, depot, "charleville-musket")).toBe(true);
  });
});

describe("buyKit / sellKit — pure transactions", () => {
  it("buys at the favoured price and adds a copy to the reserve", () => {
    const depot = makeDepot();
    const company = makeCompany(1000);
    const before = createDepotInventory();

    const trade = buyKit(company, before, depot, "charleville-musket");
    expect(trade.paid).toBe(320);
    expect(trade.company.crowns).toBe(680);
    expect(inventoryCount(trade.inventory, "charleville-musket")).toBe(1);

    // Inputs are untouched.
    expect(company.crowns).toBe(1000);
    expect(inventoryCount(before, "charleville-musket")).toBe(0);
  });

  it("sells favoured kit home for the best price", () => {
    const depot = makeDepot();
    const company = makeCompany(1000);
    const inventory = createDepotInventory({ "charleville-musket": 2 });

    const trade = sellKit(company, inventory, depot, "charleville-musket");
    expect(trade.paid).toBe(-240);
    expect(trade.company.crowns).toBe(1240);
    expect(inventoryCount(trade.inventory, "charleville-musket")).toBe(1);
    expect(inventoryCount(inventory, "charleville-musket")).toBe(2);
  });

  it("throws rather than trade through a closed gate", () => {
    const depot = makeDepot();
    const away = makeCompany(5000, asRegionId("blackwood"));
    expect(() => buyKit(away, {}, depot, "charleville-musket")).toThrow(RangeError);

    const poor = makeCompany(10);
    expect(() => buyKit(poor, {}, depot, "baker-rifle")).toThrow(RangeError);

    expect(() => sellKit(makeCompany(0), {}, depot, "charleville-musket")).toThrow(RangeError);
  });
});

describe("depot inventory helpers", () => {
  it("normalises counts, dropping zeros and rejecting junk", () => {
    const inventory = createDepotInventory({ "baker-rifle": 2, "forester-bow": 0 });
    expect(inventory).toEqual({ "baker-rifle": 2 });

    expect(() => createDepotInventory({ "not-a-thing": 1 })).toThrow(RangeError);
    expect(() => createDepotInventory({ "baker-rifle": 1.5 })).toThrow(RangeError);
  });

  it("adds and removes copies immutably", () => {
    const start = createDepotInventory();
    const one = addToInventory(start, asEquipmentId("baker-rifle"), 1);
    const two = addToInventory(one, asEquipmentId("baker-rifle"), 1);
    expect(hasInInventory(one, "baker-rifle")).toBe(true);
    expect(inventoryCount(two, "baker-rifle")).toBe(2);

    const back = removeFromInventory(two, asEquipmentId("baker-rifle"), 2);
    expect(back).toEqual({});
    expect(() => removeFromInventory(one, asEquipmentId("baker-rifle"), 2)).toThrow(RangeError);
  });
});
