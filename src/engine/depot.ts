/**
 * Depots (T075) — the **quartermaster's stores** where the company buys and
 * sells **kit** for **Crowns** (mapping §1, §2, §10).
 *
 * FFTA's shops are the model: every town has a shopkeeper of the **dominant
 * race**, and that shop's **prices** favour the town's own kit while other
 * races' gear is sold at a premium
 * (`docs/wiki/pages/Shop.md` § *Final Fantasy Tactics Advance*):
 *
 * > "Shops exist on every town that have their own set prices, giving
 * > discounts on weapons usable by the town's dominant race while other
 * > weapons are sold at higher prices."
 *
 * The retheme keeps that contract exactly and renames the pieces: a town is a
 * **region**, its shopkeeper's race is the depot's **power**, and the shop is a
 * **Depot**. Gear authored with a `power` (the military school that makes it,
 * `EquipmentDef.power`, T050) is **favoured** in a depot of the same power and
 * **foreign** anywhere else; neutral kit (no `power`) is always **standard**.
 *
 * ```
 *   buy  : Company.crowns ──► spendCrowns(buyPrice)  ──► DepotInventory +1
 *   sell : DepotInventory  ──► removeStored          ──► addCrowns(sellPrice)
 *
 *   price tier = depot.power === item.power ? favoured
 *              : item.power === undefined    ? standard
 *              :                                foreign
 * ```
 *
 * ## What this module owns
 *
 * - {@link Depot} — a store standing in one **region** and run by one
 *   **power**, with the {@link Depot.stock} list it sells.
 * - {@link DepotInventory} — the company's reserve of owned kit (FFTA's item
 *   bag): a plain item-id → count record the depot writes to on a purchase and
 *   reads from on a sale. It travels beside the {@link Company} until T101
 *   folds it into the save.
 * - The **pricing** ({@link priceTier}, {@link buyPrice}, {@link sellPrice}),
 *   the **region gating** ({@link buyBlockers}, {@link sellBlockers}) and the
 *   pure **transactions** ({@link buyKit}, {@link sellKit}).
 *
 * ## Contract (`agents.md` §2, §3, §7, §9)
 *
 * - **Engine purity & determinism** — framework-free, DOM-free TypeScript with
 *   no `Math.random` and no `Date`. Prices are integer arithmetic on authored
 *   data, so the same company, depot and order of trades always produce the
 *   same result.
 * - **State in, state out** — every transition returns a **new** company and
 *   inventory; inputs are never mutated. Structural sharing is fine.
 * - **Data-driven** — item costs and powers come from `src/data/equipment.ts`;
 *   only the *policy* (the discount percentages) lives here as named tunables
 *   for the Phase 13 balance pass.
 * - **Trust boundary** — {@link createDepot}, {@link createDepotInventory} and
 *   {@link parseDepot} validate every field, so a bad fixture or save fails
 *   loudly instead of skewing the economy.
 *
 * Reference: mapping §1 (Shop → Quartermaster's Stores, Gil → Crowns), §2
 * (every power keeps **depot discounts**) and §10 (Shops + race discount →
 * Depots, power-specific discounts). This is original fiction inspired by the
 * Napoleonic Wars, not a port of FFTA's shop data.
 */

import { getEquipment, isEquipmentKey } from "../data/equipment";
import type { EquipmentDef, PowerKey } from "../data/schema";

import { addCrowns, canAfford, spendCrowns, type Company } from "./company";
import { assertId, asEquipmentId, type DepotId, type EquipmentId, type RegionId } from "./ids";
import { isPowerKey } from "./unit";

/** Look up authored kit by its canonical key, throwing on an unknown id. */
function equipmentDef(itemId: string): EquipmentDef {
  if (!isEquipmentKey(itemId)) {
    throw new RangeError(`unknown equipment: ${String(itemId)}`);
  }
  return getEquipment(itemId);
}

/* --------------------------------------------------------------------------
 * Tunables (Phase 13 owns the final balance pass)
 * ------------------------------------------------------------------------ */

/**
 * Percentage of an item's authored `cost` paid when it is the depot's own
 * power's kit (**favoured**). Re-authored for detachment-scale play; FFTA's
 * towns simply had "cheaper" prices without a quoted multiplier.
 */
export const DEPOT_FAVOURED_BUY_PERCENT = 80;

/** Percentage paid for neutral kit (no `power`) in any depot. */
export const DEPOT_STANDARD_BUY_PERCENT = 100;

/** Percentage paid for another power's kit (**foreign**), sold at a premium. */
export const DEPOT_FOREIGN_BUY_PERCENT = 120;

/** Percentage of an item's authored `cost` received when selling favoured kit home. */
export const DEPOT_FAVOURED_SELL_PERCENT = 60;

/** Percentage received when selling neutral kit. */
export const DEPOT_STANDARD_SELL_PERCENT = 50;

/** Percentage received when selling another power's kit abroad. */
export const DEPOT_FOREIGN_SELL_PERCENT = 40;

/**
 * Floor on a sale price once an item has a cost, so a cheap neutral item is
 * still worth at least one Crown. FFTA's half-price resale never rounds a
 * sold item to nothing.
 */
export const DEPOT_MIN_SELL_PRICE = 1;

/** Longest a depot name may be, so the UI never has to truncate mid-word. */
export const DEPOT_NAME_MAX = 48;

/* --------------------------------------------------------------------------
 * Price tiers
 * ------------------------------------------------------------------------ */

/**
 * How a depot prices one piece of kit.
 *
 * | Tier       | When                                  | Buy    | Sell   |
 * | ---------- | ------------------------------------- | ------ | ------ |
 * | `favoured` | `item.power === depot.power`          | cheap  | dear   |
 * | `standard` | the item names no `power`             | list   | half   |
 * | `foreign`  | the item names another `power`        | dear   | cheap  |
 */
export type PriceTier = "favoured" | "standard" | "foreign";

/** The percentage of `cost` charged for a tier when **buying**. */
export function buyPercentForTier(tier: PriceTier): number {
  switch (tier) {
    case "favoured":
      return DEPOT_FAVOURED_BUY_PERCENT;
    case "standard":
      return DEPOT_STANDARD_BUY_PERCENT;
    case "foreign":
      return DEPOT_FOREIGN_BUY_PERCENT;
  }
}

/** The percentage of `cost` returned for a tier when **selling**. */
export function sellPercentForTier(tier: PriceTier): number {
  switch (tier) {
    case "favoured":
      return DEPOT_FAVOURED_SELL_PERCENT;
    case "standard":
      return DEPOT_STANDARD_SELL_PERCENT;
    case "foreign":
      return DEPOT_FOREIGN_SELL_PERCENT;
  }
}

/* --------------------------------------------------------------------------
 * Depots
 * ------------------------------------------------------------------------ */

/**
 * A **Quartermaster's Stores** (FFTA shop): a store standing in one region and
 * run by one great-power school, whose **stock** it favours.
 */
export interface Depot {
  /** Stable, branded identity. */
  readonly id: DepotId;
  /** Player-facing Napoleonic name (mapping §14, D6). */
  readonly name: string;
  /** The region the depot stands in; the company must be here to trade. */
  readonly regionId: RegionId;
  /** The dominant power whose kit this depot discounts. */
  readonly power: PowerKey;
  /** The kit the depot sells, in authoring order. */
  readonly stock: readonly EquipmentId[];
}

/** Authoring input for {@link createDepot}. */
export interface DepotInit {
  readonly id: DepotId;
  readonly name: string;
  readonly regionId: RegionId;
  readonly power: PowerKey;
  readonly stock?: readonly string[];
}

/** Thrown when an untrusted value is not a well-formed depot (see `parseDepot`). */
export class DepotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DepotError";
  }
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RangeError(`${label} must be a non-empty string`);
  }
}

/**
 * Validate and normalise a depot. Stock ids are branded and de-duplicated
 * (first occurrence wins), and every id must name authored kit, so a mistyped
 * item fails at the boundary rather than at the shop counter.
 *
 * @throws RangeError on a malformed id/name/region, an unknown power, or a
 *   stock entry that is not a canonical equipment key.
 */
export function createDepot(init: DepotInit): Depot {
  assertId(init.id, "depot.id");
  assertNonEmptyString(init.name, "depot.name");
  if (init.name.length > DEPOT_NAME_MAX) {
    throw new RangeError(
      `depot.name must be at most ${DEPOT_NAME_MAX} characters, received ${String(init.name.length)}`,
    );
  }
  assertId(init.regionId, "depot.regionId");
  if (!isPowerKey(init.power)) {
    throw new RangeError(
      `depot.power must be a great-power school, received ${String(init.power)}`,
    );
  }

  const stock: EquipmentId[] = [];
  const seen = new Set<string>();
  const supplied = init.stock ?? [];
  for (let index = 0; index < supplied.length; index++) {
    const id = supplied[index] as string;
    if (!isEquipmentKey(id)) {
      throw new RangeError(`depot.stock[${index}] is not authored kit: ${String(id)}`);
    }
    if (seen.has(id)) continue;
    seen.add(id);
    stock.push(asEquipmentId(id));
  }

  return { id: init.id, name: init.name, regionId: init.regionId, power: init.power, stock };
}

/**
 * Validate an untrusted value and return it as a fresh {@link Depot}. This is
 * the trust boundary for a save or fixture; it throws {@link DepotError} when
 * the shape is wrong.
 */
export function parseDepot(value: unknown, label = "depot"): Depot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DepotError(`${label} must be an object`);
  }
  const record = value as Record<string, unknown>;
  try {
    return createDepot({
      id: record.id as DepotId,
      name: record.name as string,
      regionId: record.regionId as RegionId,
      power: record.power as PowerKey,
      stock: (record.stock as readonly string[] | undefined) ?? [],
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new DepotError(`${label} is not a well-formed depot: ${reason}`);
  }
}

/** `true` when `value` round-trips through {@link parseDepot}. */
export function isDepot(value: unknown): value is Depot {
  try {
    parseDepot(value);
    return true;
  } catch {
    return false;
  }
}

/** `true` when `itemId` appears in the depot's authored stock. */
export function isStocked(depot: Depot, itemId: string): boolean {
  return depot.stock.some((id) => id === itemId);
}

/** The depot's stock as parsed kit defs, in authoring order (skips nothing). */
export function stockedDefs(depot: Depot): readonly EquipmentDef[] {
  return depot.stock.map((id) => equipmentDef(id));
}

/* --------------------------------------------------------------------------
 * Pricing
 * ------------------------------------------------------------------------ */

/**
 * How `depot` prices `item`: its own power's kit is **favoured**, neutral kit
 * is **standard**, and any other power's kit is **foreign**.
 */
export function priceTier(depot: Depot, item: EquipmentDef): PriceTier {
  if (item.power === undefined) return "standard";
  return item.power === depot.power ? "favoured" : "foreign";
}

function applyPercent(cost: number, percent: number): number {
  return Math.floor((cost * percent) / 100);
}

/**
 * The Crowns `depot` charges to sell `item` to the company, or `null` when the
 * item is unique/quest kit (`cost === null`) and therefore not for sale.
 * Integer arithmetic keeps the price deterministic.
 */
export function buyPrice(depot: Depot, item: EquipmentDef): number | null {
  if (item.cost === null) return null;
  return applyPercent(item.cost, buyPercentForTier(priceTier(depot, item)));
}

/**
 * The Crowns `depot` pays for `item`, or `null` when it has no authored cost.
 * Selling favoured kit to its home store pays best; foreign kit pays least.
 */
export function sellPrice(depot: Depot, item: EquipmentDef): number | null {
  if (item.cost === null) return null;
  const raw = applyPercent(item.cost, sellPercentForTier(priceTier(depot, item)));
  return Math.max(raw, DEPOT_MIN_SELL_PRICE);
}

/** Convenience: {@link buyPrice} for a canonical item id. */
export function buyPriceOf(depot: Depot, itemId: string): number | null {
  return buyPrice(depot, equipmentDef(itemId));
}

/** Convenience: {@link sellPrice} for a canonical item id. */
export function sellPriceOf(depot: Depot, itemId: string): number | null {
  return sellPrice(depot, equipmentDef(itemId));
}

/* --------------------------------------------------------------------------
 * Depot inventory — the company's reserve of kit (FFTA item bag)
 * ------------------------------------------------------------------------ */

/**
 * The company's owned kit, as an item-id → count record. A plain, serialisable
 * value (zero counts are dropped) so a purchase or sale is a trivial immutable
 * update and a save round-trips cleanly.
 */
export type DepotInventory = Readonly<Record<string, number>>;

/** Authoring input for {@link createDepotInventory}. */
export type DepotInventoryInit = Readonly<Record<string, number>>;

/**
 * Validate and normalise an inventory. Every count must be a positive integer
 * and every key must name authored kit; zero counts are dropped so the value is
 * canonical.
 *
 * @throws RangeError when a key or count is malformed.
 */
export function createDepotInventory(init: DepotInventoryInit = {}): DepotInventory {
  const inventory: Record<string, number> = {};
  for (const [itemId, count] of Object.entries(init)) {
    if (!isEquipmentKey(itemId)) {
      throw new RangeError(`inventory key is not authored kit: ${String(itemId)}`);
    }
    if (!Number.isInteger(count) || count < 0) {
      throw new RangeError(
        `inventory[${itemId}] must be a non-negative integer, received ${String(count)}`,
      );
    }
    if (count > 0) inventory[itemId] = count;
  }
  return inventory;
}

/** How many copies of `itemId` the company holds; `0` when none. */
export function inventoryCount(inventory: DepotInventory, itemId: string): number {
  return inventory[itemId] ?? 0;
}

/** `true` when the company holds at least one copy of `itemId`. */
export function hasInInventory(inventory: DepotInventory, itemId: string): boolean {
  return inventoryCount(inventory, itemId) > 0;
}

function addStored(inventory: DepotInventory, itemId: string, delta: number): DepotInventory {
  const next = { ...inventory };
  const count = (next[itemId] ?? 0) + delta;
  if (count <= 0) delete next[itemId];
  else next[itemId] = count;
  return next;
}

/** Add `count` copies of `itemId` to the reserve. */
export function addToInventory(
  inventory: DepotInventory,
  itemId: EquipmentId,
  count = 1,
): DepotInventory {
  if (!isEquipmentKey(itemId)) {
    throw new RangeError(`cannot store unauthored kit: ${String(itemId)}`);
  }
  if (!Number.isInteger(count) || count <= 0) {
    throw new RangeError(`count must be a positive integer, received ${String(count)}`);
  }
  return addStored(inventory, itemId, count);
}

/**
 * Remove `count` copies of `itemId` from the reserve.
 *
 * @throws RangeError when the reserve does not hold that many copies.
 */
export function removeFromInventory(
  inventory: DepotInventory,
  itemId: EquipmentId,
  count = 1,
): DepotInventory {
  if (!Number.isInteger(count) || count <= 0) {
    throw new RangeError(`count must be a positive integer, received ${String(count)}`);
  }
  if (inventoryCount(inventory, itemId) < count) {
    throw new RangeError(`inventory does not hold ${count} × ${itemId}`);
  }
  return addStored(inventory, itemId, -count);
}

/* --------------------------------------------------------------------------
 * Region gating & blockers
 * ------------------------------------------------------------------------ */

/** Why a depot will not sell kit to the company right now (empty ⇒ it can). */
export type BuyBlocker = "wrong-region" | "not-stocked" | "not-for-sale" | "insufficient-crowns";

/** Why a depot will not buy kit from the company right now (empty ⇒ it can). */
export type SellBlocker = "wrong-region" | "not-for-sale" | "not-in-inventory";

/**
 * Every reason `itemId` cannot be bought at `depot`, in a stable order. An
 * empty array means {@link buyKit} will succeed.
 *
 * | Blocker               | Rule                                            |
 * | --------------------- | ----------------------------------------------- |
 * | `wrong-region`        | the company is not in the depot's region         |
 * | `not-stocked`         | the depot does not carry the item                |
 * | `not-for-sale`        | the item is unique/quest kit (`cost === null`)   |
 * | `insufficient-crowns` | the war chest cannot cover {@link buyPrice}      |
 */
export function buyBlockers(company: Company, depot: Depot, itemId: string): readonly BuyBlocker[] {
  const blockers: BuyBlocker[] = [];
  if (company.theatre.regionId !== depot.regionId) blockers.push("wrong-region");
  if (!isStocked(depot, itemId)) blockers.push("not-stocked");
  const price = buyPriceOf(depot, itemId);
  if (price === null) blockers.push("not-for-sale");
  else if (!canAfford(company, price)) blockers.push("insufficient-crowns");
  return blockers;
}

/** `true` when {@link buyKit} would sell `itemId` to the company. */
export function canBuy(company: Company, depot: Depot, itemId: string): boolean {
  return buyBlockers(company, depot, itemId).length === 0;
}

/**
 * Every reason `itemId` cannot be sold at `depot`, in a stable order. Selling
 * needs no stock check (FFTA buys anything the clan owns) but still requires
 * the company to be present.
 *
 * | Blocker          | Rule                                             |
 * | ---------------- | ------------------------------------------------ |
 * | `wrong-region`   | the company is not in the depot's region          |
 * | `not-for-sale`   | the item is unique/quest kit (`cost === null`)    |
 * | `not-in-inventory` | the company does not own a copy                 |
 */
export function sellBlockers(
  company: Company,
  inventory: DepotInventory,
  depot: Depot,
  itemId: string,
): readonly SellBlocker[] {
  const blockers: SellBlocker[] = [];
  if (company.theatre.regionId !== depot.regionId) blockers.push("wrong-region");
  if (sellPriceOf(depot, itemId) === null) blockers.push("not-for-sale");
  if (!hasInInventory(inventory, itemId)) blockers.push("not-in-inventory");
  return blockers;
}

/** `true` when {@link sellKit} would buy `itemId` from the company. */
export function canSell(
  company: Company,
  inventory: DepotInventory,
  depot: Depot,
  itemId: string,
): boolean {
  return sellBlockers(company, inventory, depot, itemId).length === 0;
}

/* --------------------------------------------------------------------------
 * Transactions
 * ------------------------------------------------------------------------ */

/** The result of a depot trade: the updated company and its kit reserve. */
export interface DepotTrade {
  readonly company: Company;
  readonly inventory: DepotInventory;
  /** Crowns that changed hands (positive for a purchase, negative for a sale). */
  readonly paid: number;
}

/**
 * Buy one copy of `itemId` from `depot`: pay {@link buyPrice} out of the war
 * chest and add it to the reserve. Both the company and the inventory are
 * immutable values; the originals are untouched.
 *
 * @throws RangeError when any {@link BuyBlocker} applies.
 */
export function buyKit(
  company: Company,
  inventory: DepotInventory,
  depot: Depot,
  itemId: string,
): DepotTrade {
  const blockers = buyBlockers(company, depot, itemId);
  if (blockers.length > 0) {
    throw new RangeError(`cannot buy ${itemId} at ${depot.name}: ${blockers.join(", ")}`);
  }
  const price = buyPriceOf(depot, itemId) as number;
  return {
    company: spendCrowns(company, price),
    inventory: addStored(inventory, itemId, 1),
    paid: price,
  };
}

/**
 * Sell one copy of `itemId` to `depot`: receive {@link sellPrice} into the war
 * chest and remove it from the reserve.
 *
 * @throws RangeError when any {@link SellBlocker} applies.
 */
export function sellKit(
  company: Company,
  inventory: DepotInventory,
  depot: Depot,
  itemId: string,
): DepotTrade {
  const blockers = sellBlockers(company, inventory, depot, itemId);
  if (blockers.length > 0) {
    throw new RangeError(`cannot sell ${itemId} at ${depot.name}: ${blockers.join(", ")}`);
  }
  const price = sellPriceOf(depot, itemId) as number;
  return {
    company: addCrowns(company, price),
    inventory: addStored(inventory, itemId, -1),
    paid: -price,
  };
}
