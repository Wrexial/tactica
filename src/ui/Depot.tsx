/**
 * Quartermaster's Stores (T075) — the **depot** screen where the company buys
 * and sells **kit** for **Crowns** (mapping §1, §2, §10).
 *
 * FFTA's shops sell the town's dominant race's gear cheap and other races'
 * gear dear. The retheme keeps that rule and renames the shop a **Depot**, the
 * town a **region** and the shopkeeper's race the depot's **power**. This screen
 * is a thin view over the pure pricing, gating and transaction helpers in
 * `src/engine/depot.ts`; it holds the latest immutable company and kit reserve.
 *
 * ```
 *   DEMO_DEPOTS ─┐
 *                ├─► priceTier / buyPrice / sellPrice
 *   Company ─────┤        (all pure, src/engine/depot.ts)
 *   DepotInventory┘ └─► buyKit / sellKit
 * ```
 *
 * ## What this screen owns
 *
 * - The **depot list**: one store per region, each run by a power. Only the
 *   depot in the company's **region** is open — the rest show "march there
 *   first", which is the region gate.
 * - The **shelf**: the depot's stock with its **price tier** (favoured /
 *   standard / foreign) and the Crowns it charges, plus a buy button.
 * - The **reserve**: the company's owned kit with the Crowns a sale fetches,
 *   plus a sell button.
 * - A short **ledger** of what the last trades did.
 *
 * ## Contract (`agents.md` §2, §7, §9)
 *
 * - **Presentation only.** No price, discount or gate is computed here; every
 *   number and check comes from the engine module.
 * - **Pure & deterministic.** No randomness, no clock, no I/O. The same company,
 *   depot and clicks always render the same screen.
 * - **Data-driven.** Item names, costs and powers come from
 *   `src/data/equipment.ts`; the demos below are prototype scaffolding until
 *   the campaign authors the real depots.
 *
 * Reference: mapping §1 (Shop → Quartermaster's Stores, Gil → Crowns), §2
 * (depot discounts per power) and §10 (Shops + race discount → Depots).
 */

import { useMemo, useState } from "react";

import { EQUIPMENT_LIST, getEquipment, isEquipmentKey } from "../data/equipment";
import { locationsForRegion } from "../data/maps";
import type { PowerKey } from "../data/schema";

import { createCompany, type Company } from "../engine/company";
import {
  buyBlockers,
  buyKit,
  buyPrice,
  canBuy,
  canSell,
  createDepot,
  createDepotInventory,
  inventoryCount,
  priceTier,
  sellBlockers,
  sellKit,
  sellPrice,
  type Depot,
  type DepotInventory,
  type PriceTier,
} from "../engine/depot";
import { asCompanyId, asDepotId, asRegionId } from "../engine/ids";
import { useTranslation, type MessageKey, type Translator } from "../i18n";

/* --------------------------------------------------------------------------
 * Prototype depots (authored inline until the campaign owns a depot table)
 * ------------------------------------------------------------------------ */

/**
 * One depot per region, each run by the power that dominates it. Stock favours
 * the depot's own kit plus a little neutral gear, exactly as FFTA towns do.
 */
const DEMO_DEPOTS: readonly Depot[] = [
  createDepot({
    id: asDepotId("depot-sainte-colombe"),
    name: "Sainte-Colombe Quartermaster",
    regionId: asRegionId("sainte-colombe"),
    power: "france",
    stock: [
      "charleville-musket",
      "cavalry-sabre",
      "horse-pistol",
      "line-uniform",
      "shako",
      "pocket-watch",
      "water-canteen",
    ],
  }),
  createDepot({
    id: asDepotId("depot-blackwood"),
    name: "Blackwood Sutler",
    regionId: asRegionId("blackwood"),
    power: "britain",
    stock: [
      "baker-rifle",
      "congreve-rocket",
      "spyglass",
      "forester-bow",
      "campaign-shirt",
      "water-canteen",
    ],
  }),
  createDepot({
    id: asDepotId("depot-crossroads"),
    name: "Crossroads Magazine",
    regionId: asRegionId("crossroads"),
    power: "prussia",
    stock: ["grenadier-broadsword", "uhlan-lance", "cuirass", "bearskin", "pavise-shield"],
  }),
  createDepot({
    id: asDepotId("depot-coast-road"),
    name: "Coast Road Stores",
    regionId: asRegionId("the-coast-road"),
    power: "austria",
    stock: ["light-carbine", "hunting-horn", "forage-cap", "campaign-shirt", "water-canteen"],
  }),
  createDepot({
    id: asDepotId("depot-highlands"),
    name: "Highland Ordnance",
    regionId: asRegionId("the-highlands"),
    power: "russia",
    stock: ["six-pounder", "signal-staff", "sappers-tools", "greatcoat"],
  }),
];

/**
 * A deterministic company for the prototype, standing in for the campaign
 * roster until the save layer (T100/T101) supplies a real one. It opens in
 * Sainte-Colombe with enough Crowns to demonstrate both discounts.
 */
const DEMO_COMPANY: Company = createCompany({
  id: asCompanyId("company-greycoats"),
  name: "The Greycoats",
  crowns: 1400,
  honours: 3,
  theatre: { day: 12, regionId: asRegionId("sainte-colombe") },
});

/** A few items already in the reserve, so the sell side has something to show. */
const DEMO_INVENTORY: DepotInventory = createDepotInventory({
  "baker-rifle": 1,
  "forester-bow": 2,
  "water-canteen": 3,
});

/* --------------------------------------------------------------------------
 * Display helpers
 * ------------------------------------------------------------------------ */

const POWER_LABEL_KEYS: Readonly<Record<PowerKey, MessageKey>> = {
  france: "power.france",
  britain: "power.britain",
  prussia: "power.prussia",
  russia: "power.russia",
  austria: "power.austria",
};

const TIER_LABEL_KEYS: Readonly<Record<PriceTier, MessageKey>> = {
  favoured: "depot.tier.favoured",
  standard: "depot.tier.standard",
  foreign: "depot.tier.foreign",
};

/** A Crowns amount (`250 Crowns`). */
function crownsLabel(amount: number, t: Translator): string {
  return t("common.crownsAmount", { count: amount });
}

/** Player-facing name for an equipment id (falls back to the raw id). */
function itemLabel(itemId: string): string {
  return isEquipmentKey(itemId) ? getEquipment(itemId).name : itemId;
}

/** Look up authored kit by its canonical id, exploding on a bad id. */
function equipmentOf(itemId: string) {
  if (!isEquipmentKey(itemId)) {
    throw new RangeError(`unknown equipment: ${itemId}`);
  }
  return getEquipment(itemId);
}

/** The Napoleonic name of the region a depot stands in (falls back to the id). */
function regionLabel(regionId: string): string {
  return locationsForRegion(regionId)[0]?.name ?? regionId;
}

/* --------------------------------------------------------------------------
 * Props
 * ------------------------------------------------------------------------ */

/** Props for {@link Depot}. */
export interface DepotProps {
  /** The company trading. Defaults to the deterministic demo company. */
  readonly company?: Company;
  /** The company's reserve of owned kit. Defaults to the demo reserve. */
  readonly inventory?: DepotInventory;
  /** The depots available in the theatre. Defaults to {@link DEMO_DEPOTS}. */
  readonly depots?: readonly Depot[];
  /** Called after a purchase, with the item and Crowns paid. */
  readonly onBuy?: (itemId: string, paid: number) => void;
  /** Called after a sale, with the item and Crowns received. */
  readonly onSell?: (itemId: string, paid: number) => void;
}

/* --------------------------------------------------------------------------
 * Component
 * ------------------------------------------------------------------------ */

/**
 * The Quartermaster's Stores screen. Read the depot in the company's region,
 * buy its stock at the power-adjusted price and sell kit from the reserve.
 */
export function Depot({
  company: companyProp,
  inventory: inventoryProp,
  depots = DEMO_DEPOTS,
  onBuy,
  onSell,
}: DepotProps) {
  const { t } = useTranslation();
  const [company, setCompany] = useState<Company>(companyProp ?? DEMO_COMPANY);
  const [inventory, setInventory] = useState<DepotInventory>(inventoryProp ?? DEMO_INVENTORY);
  const [selectedDepotId, setSelectedDepotId] = useState<string>(depots[0]?.id ?? "");
  const [log, setLog] = useState<readonly string[]>([]);

  const selectedDepot = depots.find((depot) => depot.id === selectedDepotId) ?? depots[0];

  /** The company's owned kit, in canonical authoring order. */
  const reserve = useMemo(
    () => EQUIPMENT_LIST.filter((item) => inventoryCount(inventory, item.id) > 0),
    [inventory],
  );

  if (selectedDepot === undefined) {
    return (
      <section className="depot-screen" data-testid="depot-screen" aria-label={t("depot.label")}>
        <p className="muted">{t("depot.noneOpen")}</p>
      </section>
    );
  }

  const depotOpen = company.theatre.regionId === selectedDepot.regionId;

  const pushLog = (message: string): void => {
    setLog((current) => [message, ...current].slice(0, 8));
  };

  /** Buy one copy of an item from the selected depot. */
  const handleBuy = (itemId: string): void => {
    if (!canBuy(company, selectedDepot, itemId)) return;
    const trade = buyKit(company, inventory, selectedDepot, itemId);
    setCompany(trade.company);
    setInventory(trade.inventory);
    pushLog(t("depot.boughtLog", { item: itemLabel(itemId), price: crownsLabel(trade.paid, t) }));
    onBuy?.(itemId, trade.paid);
  };

  /** Sell one copy of an item to the selected depot. */
  const handleSell = (itemId: string): void => {
    if (!canSell(company, inventory, selectedDepot, itemId)) return;
    const trade = sellKit(company, inventory, selectedDepot, itemId);
    setCompany(trade.company);
    setInventory(trade.inventory);
    pushLog(t("depot.soldLog", { item: itemLabel(itemId), price: crownsLabel(-trade.paid, t) }));
    onSell?.(itemId, -trade.paid);
  };

  return (
    <section
      className="depot-screen"
      data-testid="depot-screen"
      aria-label={t("depot.storesLabel")}
    >
      <header className="depot-screen__header">
        <div>
          <p className="kicker">{t("depot.kicker")}</p>
          <h2>{t("depot.title")}</h2>
          <p className="muted">{t("depot.blurb")}</p>
        </div>
        <dl className="depot-screen__company" data-testid="depot-company">
          <div>
            <dt>{t("common.company")}</dt>
            <dd data-testid="depot-company-name">{company.name}</dd>
          </div>
          <div>
            <dt>{t("common.crowns")}</dt>
            <dd data-testid="depot-company-crowns">{company.crowns}</dd>
          </div>
          <div>
            <dt>{t("common.region")}</dt>
            <dd data-testid="depot-company-region">
              {company.theatre.regionId === null
                ? t("common.betweenPostings")
                : regionLabel(company.theatre.regionId)}
            </dd>
          </div>
        </dl>
      </header>

      <nav className="depot-list" aria-label={t("depot.depotsLabel")}>
        {depots.map((depot) => {
          const here = depot.regionId === company.theatre.regionId;
          return (
            <button
              key={depot.id}
              type="button"
              className={depot.id === selectedDepot.id ? "depot-chip is-active" : "depot-chip"}
              data-testid={`depot-select-${depot.id}`}
              data-open={here}
              aria-pressed={depot.id === selectedDepot.id}
              onClick={() => setSelectedDepotId(depot.id)}
            >
              <span className="depot-chip__name">{depot.name}</span>
              <span className="depot-chip__power">
                {t("depot.powerRegion", {
                  power: t(POWER_LABEL_KEYS[depot.power]),
                  region: regionLabel(depot.regionId),
                })}
              </span>
              {!here && <span className="depot-chip__closed">{t("depot.marchThereFirst")}</span>}
            </button>
          );
        })}
      </nav>

      {!depotOpen && (
        <p className="depot-closed" data-testid="depot-closed">
          {regionLabel(selectedDepot.regionId)}{" "}
          {t("depot.marchAway", {
            region:
              company.theatre.regionId === null
                ? t("depot.theRoad")
                : regionLabel(company.theatre.regionId),
          })}
        </p>
      )}

      <div className="depot-screen__body">
        <section className="depot-panel" aria-label={t("depot.stockLabel")}>
          <h3>{selectedDepot.name}</h3>
          <table className="depot-table" data-testid="depot-stock">
            <thead>
              <tr>
                <th scope="col">{t("depot.kit")}</th>
                <th scope="col">{t("depot.tier")}</th>
                <th scope="col">{t("depot.buyHeader")}</th>
                <th scope="col">{t("common.owned")}</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {selectedDepot.stock.map((itemId) => {
                const item = equipmentOf(itemId);
                const tier = priceTier(selectedDepot, item);
                const price = buyPrice(selectedDepot, item);
                const owned = inventoryCount(inventory, itemId);
                const blockers = buyBlockers(company, selectedDepot, itemId);
                const enabled = blockers.length === 0;

                return (
                  <tr key={itemId} data-testid={`depot-stock-row-${itemId}`}>
                    <th scope="row">{item.name}</th>
                    <td>
                      <span
                        className={`depot-tier depot-tier--${tier}`}
                        data-testid={`depot-tier-${itemId}`}
                      >
                        {t(TIER_LABEL_KEYS[tier])}
                      </span>
                    </td>
                    <td data-testid={`depot-price-${itemId}`}>
                      {price === null ? t("common.none") : crownsLabel(price, t)}
                    </td>
                    <td data-testid={`depot-owned-${itemId}`}>{owned}</td>
                    <td>
                      <button
                        type="button"
                        className="button"
                        data-testid={`depot-buy-${itemId}`}
                        disabled={!enabled}
                        title={enabled ? undefined : blockers.join(", ")}
                        onClick={() => handleBuy(itemId)}
                      >
                        {t("common.buy")}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section className="depot-panel" aria-label={t("depot.reserveLabel")}>
          <h3>{t("depot.reserve")}</h3>
          {reserve.length === 0 ? (
            <p className="muted" data-testid="depot-reserve-empty">
              {t("depot.reserveEmpty")}
            </p>
          ) : (
            <table className="depot-table" data-testid="depot-reserve">
              <thead>
                <tr>
                  <th scope="col">{t("depot.kit")}</th>
                  <th scope="col">{t("common.owned")}</th>
                  <th scope="col">{t("depot.sellHeader")}</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {reserve.map((item) => {
                  const price = sellPrice(selectedDepot, item);
                  const owned = inventoryCount(inventory, item.id);
                  const blockers = sellBlockers(company, inventory, selectedDepot, item.id);
                  const enabled = blockers.length === 0;

                  return (
                    <tr key={item.id} data-testid={`depot-reserve-row-${item.id}`}>
                      <th scope="row">{item.name}</th>
                      <td data-testid={`depot-reserve-count-${item.id}`}>{owned}</td>
                      <td data-testid={`depot-sell-price-${item.id}`}>
                        {price === null ? t("common.none") : crownsLabel(price, t)}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="button button--ghost"
                          data-testid={`depot-sell-${item.id}`}
                          disabled={!enabled}
                          title={enabled ? undefined : blockers.join(", ")}
                          onClick={() => handleSell(item.id)}
                        >
                          {t("common.sell")}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <section className="depot-panel" aria-label={t("depot.ledgerLabel")}>
        <h3>{t("depot.ledger")}</h3>
        {log.length === 0 ? (
          <p className="muted">{t("depot.noTrades")}</p>
        ) : (
          <ol className="depot-log" data-testid="depot-log">
            {log.map((entry, index) => (
              <li key={`${index}-${entry}`}>{entry}</li>
            ))}
          </ol>
        )}
      </section>
    </section>
  );
}
