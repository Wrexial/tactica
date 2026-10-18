/**
 * Campaign Map screen (T073) — the **Theatre** the company shapes by placing
 * **Campaign Markers** (FFTA "area tokens", mapping §1, §10).
 *
 * The engine (`src/engine/campaignMap.ts`) owns the rules: an empty map grows
 * as markers are placed into slots, the company marches between placed regions,
 * and a **treasure hunt** reveals items whose quantity depends on what the
 * location was placed next to. This screen is a thin React view over those pure
 * transitions — it holds the latest immutable map and company, and every click
 * calls an engine helper and stores the new value.
 *
 * ```
 *   DEMO_MARKERS ─┐
 *                 ├─► placeMarker / travelCompany / huntTreasure
 *   CampaignMap   ┘            (all pure, src/engine/campaignMap.ts)
 * ```
 *
 * ## What this screen owns
 *
 * - The **map grid**: every slot is a button; empty slots accept the selected
 *   marker, placed slots can be inspected.
 * - The **palette**: the markers still unplaced (FFTA awards them after
 *   missions; T074/T077 author the real set, this is the prototype scaffolding).
 * - The **location panel**: for a placed region, its terrain, its region id and
 *   the **March** and **Treasure hunt** actions.
 * - A short **dispatch log** of what the last actions did.
 *
 * ## Contract (`agents.md` §2, §7, §9)
 *
 * - **Presentation only.** No campaign rule is hard-coded here; placement,
 *   travel and hunts all go through the engine module.
 * - **Deterministic.** No randomness, no clock, no I/O. The same map, company
 *   and clicks always render the same screen.
 * - **Data-driven.** Marker names, terrains and treasure rules are authored as
 *   plain values below; T074 owns the finished content.
 *
 * Reference: mapping §10 (world map + area tokens → Campaign Map + Markers,
 * "place tiles, shape the theatre, treasure hunts") and
 * `docs/wiki/pages/Final_Fantasy_Tactics_Advance.md` (area tokens / treasure
 * hunting).
 */

import { useMemo, useState } from "react";

import { getEquipment, isEquipmentKey } from "../data/equipment";
import {
  CAMPAIGN_MAP_DEFAULT_DIMENSION,
  canPlaceMarker,
  createCampaignMap,
  createCampaignMarker,
  huntTreasure,
  isHunted,
  isSlotEmpty,
  markerAt,
  placeMarker,
  placementCount,
  placementForMarker,
  travelCompany,
  type CampaignMapState,
  type CampaignMarker,
  type TreasureFind,
} from "../engine/campaignMap";
import { createCompany, type Company } from "../engine/company";
import { coord, coordEquals, iterateCoords, type Coord } from "../engine/grid";
import {
  asCompanyId,
  asMapTokenId,
  asRegionId,
  type MapTokenId,
  type RegionId,
} from "../engine/ids";
import { getTerrainDef } from "../engine/terrain";
import { useTranslation, type Translator } from "../i18n";

/* --------------------------------------------------------------------------
 * Authored campaign markers (prototype scaffolding until T074/T077)
 * ------------------------------------------------------------------------ */

/** The company's home: the one location that starts on the map. */
const SAINTE_COLOMBE = createCampaignMarker({
  id: asMapTokenId("sainte-colombe"),
  name: "Sainte-Colombe",
  terrain: "bridge",
  regionId: asRegionId("sainte-colombe"),
  treasure: [{ itemId: "powder-flask" }, { itemId: "water-canteen", nearTerrain: "river" }],
});

/** A wood that pays out a bow when planted beside more woodland. */
const BLACKWOOD = createCampaignMarker({
  id: asMapTokenId("blackwood"),
  name: "The Blackwood",
  terrain: "wood",
  regionId: asRegionId("blackwood"),
  treasure: [
    { itemId: "water-canteen" },
    { itemId: "forester-bow", nearTerrain: "wood" },
    { itemId: "spyglass", nearTerrain: "hill" },
  ],
});

/** A road junction whose treasure improves beside a village. */
const CROSSROADS = createCampaignMarker({
  id: asMapTokenId("crossroads"),
  name: "The Crossroads",
  terrain: "road",
  regionId: asRegionId("crossroads"),
  treasure: [{ itemId: "cavalry-sabre" }, { itemId: "horse-pistol", nearTerrain: "village" }],
});

/** A coastal road that hides rockets near an earthwork. */
const COAST_ROAD = createCampaignMarker({
  id: asMapTokenId("the-coast-road"),
  name: "The Coast Road",
  terrain: "road",
  regionId: asRegionId("the-coast-road"),
  treasure: [{ itemId: "water-canteen" }, { itemId: "congreve-rocket", nearTerrain: "redoubt" }],
});

/** Rising ground that rewards a gun battery when the heights cluster. */
const HIGHLANDS = createCampaignMarker({
  id: asMapTokenId("the-highlands"),
  name: "The Highlands",
  terrain: "hill",
  regionId: asRegionId("the-highlands"),
  treasure: [
    { itemId: "spyglass", nearTerrain: "wood" },
    { itemId: "six-pounder", nearTerrain: "hill", count: 2 },
  ],
});

/** Every marker the prototype can award (T074 completes this table). */
const CAMPAIGN_MARKERS: readonly CampaignMarker[] = [
  SAINTE_COLOMBE,
  BLACKWOOD,
  CROSSROADS,
  COAST_ROAD,
  HIGHLANDS,
];

/* --------------------------------------------------------------------------
 * Demo state
 * ------------------------------------------------------------------------ */

/** The blank theatre, grown from a single starting location. */
const INITIAL_MAP: CampaignMapState = createCampaignMap({
  width: CAMPAIGN_MAP_DEFAULT_DIMENSION,
  height: CAMPAIGN_MAP_DEFAULT_DIMENSION,
  placements: [{ slot: coord(0, 0), marker: SAINTE_COLOMBE }],
});

/** A deterministic company for the prototype until the save layer (T100) lands. */
const DEMO_COMPANY: Company = createCompany({
  id: asCompanyId("company-greycoats"),
  name: "The Greycoats",
  crowns: 900,
  honours: 3,
  theatre: { day: 12, regionId: asRegionId("sainte-colombe") },
});

/* --------------------------------------------------------------------------
 * Display helpers
 * ------------------------------------------------------------------------ */

/** Player-facing name for an equipment id (falls back to the raw id). */
function itemLabel(itemId: string): string {
  return isEquipmentKey(itemId) ? getEquipment(itemId).name : itemId;
}

/** A human-readable summary of one hunt's spoils. */
function spoilsLabel(finds: readonly TreasureFind[], t: Translator): string {
  if (finds.length === 0) return t("campaign.nothingFound");
  return finds.map((find) => `${itemLabel(find.itemId)} ×${find.count}`).join(", ");
}

/** A Crowns amount for the header. */
function crownsLabel(amount: number, t: Translator): string {
  return t("common.crownsAmount", { count: amount });
}

/* --------------------------------------------------------------------------
 * Props
 * ------------------------------------------------------------------------ */

/** Props for {@link CampaignMap}. */
export interface CampaignMapProps {
  /** The company marching the map. Defaults to the deterministic demo company. */
  readonly company?: Company;
  /** The campaign map to shape. Defaults to the prototype's starting map. */
  readonly map?: CampaignMapState;
  /** The markers that can still be placed. Defaults to {@link CAMPAIGN_MARKERS}. */
  readonly markers?: readonly CampaignMarker[];
  /** Called after a marker is placed into a slot. */
  readonly onPlace?: (marker: CampaignMarker, at: Coord) => void;
  /** Called after the company marches to a placed region. */
  readonly onTravel?: (regionId: RegionId) => void;
  /** Called after a treasure hunt, with what it found. */
  readonly onHunt?: (at: Coord, finds: readonly TreasureFind[]) => void;
}

/* --------------------------------------------------------------------------
 * Component
 * ------------------------------------------------------------------------ */

/**
 * The Campaign Map screen: place markers, march the company and hunt for
 * treasure. All campaign rules live in `src/engine/campaignMap.ts`; this
 * component only holds the latest immutable state.
 */
export function CampaignMap({
  company: companyProp,
  map: mapProp,
  markers = CAMPAIGN_MARKERS,
  onPlace,
  onTravel,
  onHunt,
}: CampaignMapProps) {
  const { t } = useTranslation();
  const [company, setCompany] = useState<Company>(companyProp ?? DEMO_COMPANY);
  const [map, setMap] = useState<CampaignMapState>(mapProp ?? INITIAL_MAP);
  const [selectedMarkerId, setSelectedMarkerId] = useState<MapTokenId | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<Coord | null>(null);
  const [log, setLog] = useState<readonly string[]>([]);

  const cells = useMemo(() => [...iterateCoords(map.grid)], [map.grid]);
  const selectedMarker =
    selectedMarkerId === null
      ? undefined
      : markers.find((marker) => marker.id === selectedMarkerId);

  /** The markers not yet placed, i.e. still in the palette. */
  const availableMarkers = useMemo(
    () => markers.filter((marker) => placementForMarker(map, marker.id) === undefined),
    [map, markers],
  );

  const selectedLocation = selectedSlot === null ? undefined : markerAt(map, selectedSlot);

  const pushLog = (message: string): void => {
    setLog((current) => [message, ...current].slice(0, 8));
  };

  /** A click on a slot either places the selected marker or inspects the slot. */
  const handleSlot = (at: Coord): void => {
    if (
      isSlotEmpty(map, at) &&
      selectedMarker !== undefined &&
      canPlaceMarker(map, selectedMarker, at)
    ) {
      setMap(placeMarker(map, selectedMarker, at));
      pushLog(
        t("campaign.placedLog", {
          marker: selectedMarker.name,
          terrain: getTerrainDef(selectedMarker.terrain).name,
        }),
      );
      setSelectedMarkerId(null);
      setSelectedSlot(at);
      onPlace?.(selectedMarker, at);
      return;
    }
    setSelectedSlot(at);
  };

  /** March the company to the selected placed region. */
  const handleTravel = (): void => {
    if (selectedLocation === undefined) return;
    const regionId = selectedLocation.regionId;
    const { company: arrived, plan } = travelCompany(company, map, regionId);
    setCompany(arrived);
    pushLog(
      plan.days === 0
        ? t("campaign.alreadyAtLog", { name: selectedLocation.name })
        : t("campaign.marchedLog", { count: plan.days, name: selectedLocation.name }),
    );
    onTravel?.(regionId);
  };

  /** Treasure-hunt the selected placed region (once). */
  const handleHunt = (): void => {
    if (selectedSlot === null || selectedLocation === undefined) return;
    if (isHunted(map, selectedSlot)) return;
    const result = huntTreasure(map, selectedSlot);
    setMap(result.map);
    pushLog(
      t("campaign.huntLog", {
        name: selectedLocation.name,
        spoils: spoilsLabel(result.finds, t),
      }),
    );
    onHunt?.(selectedSlot, result.finds);
  };

  return (
    <section className="map-screen" data-testid="campaign-map-screen" aria-label={t("campaign.label")}>
      <header className="map-screen__header">
        <div>
          <p className="kicker">{t("campaign.kicker")}</p>
          <h2>{t("campaign.title")}</h2>
          <p className="muted">{t("campaign.blurb")}</p>
        </div>
        <dl className="map-screen__company" data-testid="campaign-map-company">
          <div>
            <dt>{t("common.company")}</dt>
            <dd data-testid="campaign-map-company-name">{company.name}</dd>
          </div>
          <div>
            <dt>{t("common.crowns")}</dt>
            <dd data-testid="campaign-map-company-crowns">{crownsLabel(company.crowns, t)}</dd>
          </div>
          <div>
            <dt>{t("common.honours")}</dt>
            <dd data-testid="campaign-map-company-honours">{company.honours}</dd>
          </div>
          <div>
            <dt>{t("common.day")}</dt>
            <dd data-testid="campaign-map-company-day">{company.theatre.day}</dd>
          </div>
          <div>
            <dt>{t("common.region")}</dt>
            <dd data-testid="campaign-map-company-region">
              {company.theatre.regionId ?? t("common.betweenPostings")}
            </dd>
          </div>
          <div>
            <dt>{t("campaign.placed")}</dt>
            <dd data-testid="campaign-map-placed-count">
              {t("campaign.placedCount", {
                placed: placementCount(map),
                total: map.grid.width * map.grid.height,
              })}
            </dd>
          </div>
        </dl>
      </header>

      <div className="map-screen__body">
        <section className="map-board" aria-label={t("campaign.slotsLabel")}>
          <h3>{t("campaign.slots")}</h3>
          <div
            className="map-grid"
            data-testid="campaign-map-grid"
            style={{ gridTemplateColumns: `repeat(${map.grid.width}, minmax(0, 1fr))` }}
          >
            {cells.map((at) => {
              const marker = markerAt(map, at);
              const hunted = marker !== undefined && isHunted(map, at);
              const isSelected = selectedSlot !== null && coordEquals(selectedSlot, at);
              const placeable =
                marker === undefined &&
                selectedMarker !== undefined &&
                canPlaceMarker(map, selectedMarker, at);
              const classes = [
                "map-cell",
                marker === undefined ? "map-cell--empty" : "map-cell--placed",
                isSelected ? "is-selected" : "",
                placeable ? "is-placeable" : "",
                hunted ? "is-hunted" : "",
              ]
                .filter(Boolean)
                .join(" ");

              return (
                <button
                  key={`${at.x},${at.y}`}
                  type="button"
                  className={classes}
                  data-testid={`campaign-slot-${at.x}-${at.y}`}
                  data-marker={marker?.id ?? ""}
                  aria-label={
                    marker === undefined
                      ? t("campaign.emptySlotAria", { x: at.x, y: at.y })
                      : t("campaign.markerAria", { name: marker.name, x: at.x, y: at.y })
                  }
                  onClick={() => handleSlot(at)}
                >
                  {marker === undefined ? (
                    <span className="map-cell__empty">+</span>
                  ) : (
                    <>
                      <span className="map-cell__name">{marker.name}</span>
                      <span className="map-cell__terrain">
                        {getTerrainDef(marker.terrain).name}
                      </span>
                      {hunted && <span className="map-cell__flag">{t("campaign.hunted")}</span>}
                    </>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        <aside className="map-side">
          <section className="map-panel" aria-label={t("campaign.availableMarkers")}>
            <h3>{t("campaign.markers")}</h3>
            {availableMarkers.length === 0 ? (
              <p className="muted">{t("campaign.allPlaced")}</p>
            ) : (
              <ul className="marker-palette" data-testid="campaign-marker-palette">
                {availableMarkers.map((marker) => (
                  <li key={marker.id}>
                    <button
                      type="button"
                      className={
                        selectedMarkerId === marker.id ? "marker-chip is-active" : "marker-chip"
                      }
                      data-testid={`campaign-marker-${marker.id}`}
                      aria-pressed={selectedMarkerId === marker.id}
                      onClick={() =>
                        setSelectedMarkerId((current) => (current === marker.id ? null : marker.id))
                      }
                    >
                      <span className="marker-chip__name">{marker.name}</span>
                      <span className="marker-chip__terrain">
                        {getTerrainDef(marker.terrain).name}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="map-panel" aria-label={t("campaign.selectedLabel")}>
            <h3>{t("campaign.selectedLocation")}</h3>
            {selectedSlot === null ? (
              <p className="muted">{t("campaign.chooseSlot")}</p>
            ) : selectedLocation === undefined ? (
              <p className="muted" data-testid="campaign-selected-empty">
                {t("campaign.emptySlotAria", { x: selectedSlot.x, y: selectedSlot.y })}
                {selectedMarker === undefined
                  ? t("campaign.pickMarker")
                  : t("campaign.placeMarker")}
              </p>
            ) : (
              <div className="location-card" data-testid="campaign-selected-location">
                <p className="location-card__name">{selectedLocation.name}</p>
                <dl className="location-card__meta">
                  <div>
                    <dt>{t("common.terrain")}</dt>
                    <dd>{getTerrainDef(selectedLocation.terrain).name}</dd>
                  </div>
                  <div>
                    <dt>{t("common.region")}</dt>
                    <dd data-testid="campaign-selected-region">{selectedLocation.regionId}</dd>
                  </div>
                  <div>
                    <dt>{t("campaign.treasure")}</dt>
                    <dd>
                      {isHunted(map, selectedSlot) ? t("campaign.hunted") : t("common.unsearched")}
                    </dd>
                  </div>
                </dl>
                <div className="location-card__actions">
                  <button
                    type="button"
                    className="button"
                    data-testid="campaign-travel"
                    onClick={handleTravel}
                  >
                    {t("campaign.marchHere")}
                  </button>
                  <button
                    type="button"
                    className="button button--ghost"
                    data-testid="campaign-hunt"
                    disabled={isHunted(map, selectedSlot)}
                    onClick={handleHunt}
                  >
                    {isHunted(map, selectedSlot)
                      ? t("campaign.alreadyHunted")
                      : t("campaign.treasureHunt")}
                  </button>
                </div>
              </div>
            )}
          </section>

          <section className="map-panel" aria-label={t("campaign.dispatchLogLabel")}>
            <h3>{t("campaign.dispatchLog")}</h3>
            {log.length === 0 ? (
              <p className="muted">{t("campaign.noOrders")}</p>
            ) : (
              <ol className="dispatch-log" data-testid="campaign-log">
                {log.map((entry, index) => (
                  <li key={`${index}-${entry}`}>{entry}</li>
                ))}
              </ol>
            )}
          </section>
        </aside>
      </div>
    </section>
  );
}
