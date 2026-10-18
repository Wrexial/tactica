/**
 * Saves (T102) — the **camp keep**, where a campaign is autosaved, filed into
 * named slots and carried in or out as JSON (mapping §10, D15).
 *
 * The persistence contract was laid down by T100 (`SaveStore`) and T101
 * (`CampaignSave`): a whole campaign is a validated, JSON-safe value that can
 * be written to a named slot and read back through the engine's own factories.
 * This screen is the player-facing surface over that contract and owns nothing
 * but presentation and the tiny amount of UI state a screen needs:
 *
 * ```
 *   SavedCampaign ─┐
 *                  ├─► saveCampaign / loadCampaignMigrated ─► SaveStore slot
 *   campaign state ┘
 *                  ├─► serializeCampaign   ─► export JSON
 *                  └─► deserializeCampaignMigrated ─► import JSON
 * ```
 *
 * ## What this screen owns
 *
 * - An **autosave**: a rolling save, written automatically to
 *   {@link AUTOSAVE_SLOT} whenever the working campaign changes (and on demand
 *   with the *Autosave now* order), so there is always a restore point.
 * - **Slots**: three named filing slots, each with its label and the time it was
 *   written. A slot may be **saved**, **loaded** or **struck** (deleted).
 * - **JSON export / import**: the canonical campaign text can be exported (and
 *   downloaded as a `.json` file) and pasted back in to be validated and
 *   restored. A rejected import leaves the working campaign untouched.
 *
 * ## Contract (`agents.md` §2, §3, §7, §9)
 *
 * - **Presentation only, at the edge.** Every rule — versioning, validation,
 *   serialisation — lives in `src/persist/`; no campaign data is authored here
 *   except the deterministic demo the screen opens with.
 * - **Engine stays pure.** This module imports the persistence layer and the
 *   immutable engine factories; it never reaches into the simulation to mutate
 *   state. Loading/advancing builds a fresh {@link CampaignSave} value.
 * - **Deterministic.** No `Math.random`; the demo campaign is authored with a
 *   fixed seed and day so the screen renders and tests identically every time.
 *
 * This is original fiction inspired by the Napoleonic Wars, not a port of
 * FFTA's save data (mapping §3, §14 D6).
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { createCalendar } from "../engine/calendar";
import { createCampaignMap } from "../engine/campaignMap";
import { advanceDay, createCompany } from "../engine/company";
import { createDepotInventory } from "../engine/depot";
import { coord } from "../engine/grid";
import {
  asCompanyId,
  asContractId,
  asMapTokenId,
  asPostId,
  asRegionId,
  asUnitId,
} from "../engine/ids";
import { createPostAssignment, derivePostStats } from "../engine/progression/posts";
import { createUnit } from "../engine/unit";
import {
  AUTOSAVE_SLOT,
  createCampaignProgress,
  createCampaignSave,
  createIndexedDbSaveStore,
  createMemorySaveStore,
  deserializeCampaignMigrated,
  isIndexedDbAvailable,
  loadCampaignMigrated,
  saveCampaign,
  serializeCampaign,
  type CampaignSave,
  type SaveSlotInfo,
  type SaveStore,
} from "../persist";
import { useTranslation, type MessageKey, type TranslationVars, type Translator } from "../i18n";

/* --------------------------------------------------------------------------
 * Constants & helpers
 * ------------------------------------------------------------------------ */

/** The named filing slots the player may use, in display order. */
const DEFAULT_SAVE_SLOTS = ["slot-1", "slot-2", "slot-3"] as const;

/** The seed the deterministic demo campaign is authored under. */
const DEMO_SEED = "campaign-1815";

/** The campaign day the deterministic demo opens on. */
const DEMO_DAY = 12;

/** Tone of one ledger line, so the UI can style success against failure. */
type StatusKind = "info" | "success" | "error";

/** One line in the save ledger, held as a key so the locale resolves at render. */
interface StatusEntry {
  readonly kind: StatusKind;
  readonly key: MessageKey;
  readonly vars?: TranslationVars;
}

/** Human-readable message for whatever a `catch` caught. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A compact label for a campaign (`The Greycoats · Day 12`). */
function campaignLabel(save: CampaignSave, t: Translator): string {
  return t("saves.campaignLabel", {
    company: save.company.name,
    day: save.company.theatre.day,
  });
}

/** A locale timestamp for a slot's `savedAt`; presentation only. */
function formatTime(milliseconds: number): string {
  return new Date(milliseconds).toLocaleString();
}

/** A Crowns amount (`1400 Crowns`). */
function crownsLabel(amount: number, t: Translator): string {
  return t("common.crownsAmount", { count: amount });
}

/* --------------------------------------------------------------------------
 * The demo campaign (prototype scaffolding until a campaign controller lands)
 * ------------------------------------------------------------------------ */

/** Authoring input for one demo soldier. */
interface DemoRecruit {
  readonly id: string;
  readonly name: string;
  readonly postId: string;
  readonly level: number;
}

/** Build one demo roster member through the authored engine factories. */
function demoMember(spec: DemoRecruit) {
  const assignment = createPostAssignment({
    primaryPostId: asPostId(spec.postId),
    power: "france",
  });
  const unit = createUnit({
    id: asUnitId(spec.id),
    name: spec.name,
    power: "france",
    postId: asPostId(spec.postId),
    level: spec.level,
    at: coord(0, 0),
    stats: derivePostStats({ level: spec.level, assignment }),
  });
  return { unit, assignment, recruitedOnDay: 1 };
}

/**
 * The deterministic campaign the screen opens with: The Greycoats on day 12 at
 * Sainte-Colombe, their bridge contract behind them. It stands in for a real
 * campaign controller while the sandbox is being wired together.
 */
function createDemoCampaign(): CampaignSave {
  const company = createCompany({
    id: asCompanyId("company-greycoats"),
    name: "The Greycoats",
    crowns: 1400,
    honours: 3,
    roster: [
      demoMember({ id: "unit-aubry", name: "Sgt. Aubry", postId: "fusilier", level: 4 }),
      demoMember({ id: "unit-bouvet", name: "Cpl. Bouvet", postId: "grenadier", level: 4 }),
    ],
    theatre: {
      day: DEMO_DAY,
      regionId: asRegionId("sainte-colombe"),
      knownRegionIds: [asRegionId("sainte-colombe")],
    },
  });

  const map = createCampaignMap({
    width: 4,
    height: 4,
    placements: [
      {
        slot: coord(0, 0),
        marker: {
          id: asMapTokenId("start"),
          name: "Sainte-Colombe",
          terrain: "bridge",
          regionId: asRegionId("sainte-colombe"),
        },
      },
    ],
  });

  const calendar = createCalendar({
    seed: DEMO_SEED,
    day: DEMO_DAY,
    regionId: asRegionId("sainte-colombe"),
  });

  return createCampaignSave({
    seed: DEMO_SEED,
    company,
    map,
    calendar,
    inventory: createDepotInventory({ "water-canteen": 2, "powder-flask": 1 }),
    progress: createCampaignProgress({ completedContractIds: ["break-the-bridge"] }),
    history: [
      { kind: "contract-completed", day: 10, contractId: asContractId("break-the-bridge") },
    ],
  });
}

/**
 * Advance a campaign by `days`, keeping the company theatre clock and the
 * calendar in step. Pure: the input save is never mutated.
 */
function advanceCampaignSave(save: CampaignSave, days: number): CampaignSave {
  const company = advanceDay(save.company, days);
  const calendar = createCalendar({
    seed: save.calendar.seed,
    day: company.theatre.day,
    regionId: save.calendar.regionId,
    dispatches: save.calendar.dispatches,
  });
  return createCampaignSave({ ...save, company, calendar });
}

/** Pick the browser backend when available, else the in-memory test double. */
function createDefaultStore(): SaveStore {
  if (isIndexedDbAvailable()) {
    try {
      return createIndexedDbSaveStore();
    } catch {
      // Fall through to the memory backend below.
    }
  }
  return createMemorySaveStore();
}

/* --------------------------------------------------------------------------
 * Props
 * ------------------------------------------------------------------------ */

/** Props for {@link Saves}. */
export interface SavesProps {
  /** The working campaign. Defaults to the deterministic demo campaign. */
  readonly campaign?: CampaignSave;
  /** The persistence backend. Defaults to IndexedDB with a memory fallback. */
  readonly store?: SaveStore;
  /** The named filing slots to show. Defaults to {@link DEFAULT_SAVE_SLOTS}. */
  readonly slots?: readonly string[];
  /** Called after a campaign is loaded or imported. */
  readonly onChange?: (save: CampaignSave) => void;
}

/* --------------------------------------------------------------------------
 * Component
 * ------------------------------------------------------------------------ */

/**
 * The camp keep: autosave, named slots and JSON export/import over the
 * versioned {@link SaveStore} and the validated {@link CampaignSave} format.
 */
export function Saves({
  campaign: campaignProp,
  store: storeProp,
  slots = DEFAULT_SAVE_SLOTS,
  onChange,
}: SavesProps) {
  const { t } = useTranslation();
  const store = useMemo(() => storeProp ?? createDefaultStore(), [storeProp]);
  const [campaign, setCampaign] = useState<CampaignSave>(
    () => campaignProp ?? createDemoCampaign(),
  );
  const [slotInfos, setSlotInfos] = useState<readonly SaveSlotInfo[]>([]);
  const [label, setLabel] = useState("");
  const [exportText, setExportText] = useState("");
  const [importText, setImportText] = useState("");
  const [busy, setBusy] = useState(false);
  const [ledger, setLedger] = useState<readonly StatusEntry[]>([]);

  const pushLedger = useCallback(
    (kind: StatusKind, key: MessageKey, vars?: TranslationVars): void => {
      setLedger((current) => [{ kind, key, ...(vars !== undefined ? { vars } : {}) }, ...current].slice(0, 12));
    },
    [],
  );

  const refreshSlots = useCallback(async (): Promise<void> => {
    const infos = await store.list();
    setSlotInfos(infos);
  }, [store]);

  // Read the slot metadata once on mount.
  useEffect(() => {
    void refreshSlots();
  }, [refreshSlots]);

  // Rolling autosave: every change to the working campaign is written straight
  // to the dedicated autosave slot, so the company always has a restore point.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await saveCampaign(store, AUTOSAVE_SLOT, campaign, { label: campaignLabel(campaign, t) });
        if (!cancelled) await refreshSlots();
      } catch (error) {
        if (!cancelled) {
          pushLedger("error", "saves.ledger.autosaveFailed", { error: messageOf(error) });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [campaign, store, refreshSlots, pushLedger, t]);

  const infoBySlot = useMemo(
    () => new Map(slotInfos.map((info) => [info.slot, info] as const)),
    [slotInfos],
  );
  const autosaveInfo = infoBySlot.get(AUTOSAVE_SLOT);

  const exportHref =
    exportText.length > 0
      ? `data:application/json;charset=utf-8,${encodeURIComponent(exportText)}`
      : undefined;

  /** Write the working campaign into a named slot. */
  const handleSave = async (slot: string): Promise<void> => {
    setBusy(true);
    try {
      const chosenLabel = label.trim().length > 0 ? label.trim() : campaignLabel(campaign, t);
      await saveCampaign(store, slot, campaign, { label: chosenLabel });
      await refreshSlots();
      pushLedger("success", "saves.ledger.filed", { label: chosenLabel, slot });
    } catch (error) {
      pushLedger("error", "saves.ledger.saveFailed", { slot, error: messageOf(error) });
    } finally {
      setBusy(false);
    }
  };

  /** Restore the working campaign from a named slot. */
  const handleLoad = async (slot: string): Promise<void> => {
    setBusy(true);
    try {
      const loaded = await loadCampaignMigrated(store, slot);
      if (loaded === null) {
        pushLedger("error", "saves.ledger.emptySlot", { slot });
        return;
      }
      setCampaign(loaded);
      onChange?.(loaded);
      pushLedger("success", "saves.ledger.restored", { slot, label: campaignLabel(loaded, t) });
    } catch (error) {
      pushLedger("error", "saves.ledger.loadFailed", { slot, error: messageOf(error) });
    } finally {
      setBusy(false);
    }
  };

  /** Strike a named slot. */
  const handleDelete = async (slot: string): Promise<void> => {
    setBusy(true);
    try {
      const removed = await store.remove(slot);
      await refreshSlots();
      if (removed) {
        pushLedger("success", "saves.ledger.struck", { slot });
      } else {
        pushLedger("info", "saves.ledger.alreadyEmpty", { slot });
      }
    } catch (error) {
      pushLedger("error", "saves.ledger.strikeFailed", { slot, error: messageOf(error) });
    } finally {
      setBusy(false);
    }
  };

  /** Force an autosave without changing the campaign. */
  const handleAutosaveNow = async (): Promise<void> => {
    setBusy(true);
    try {
      await saveCampaign(store, AUTOSAVE_SLOT, campaign, { label: campaignLabel(campaign, t) });
      await refreshSlots();
      pushLedger("success", "saves.ledger.autosaved", { label: campaignLabel(campaign, t) });
    } catch (error) {
      pushLedger("error", "saves.ledger.autosaveFailed", { error: messageOf(error) });
    } finally {
      setBusy(false);
    }
  };

  /** Advance the demo campaign a day to demonstrate capture/restore. */
  const handleAdvance = (): void => {
    const next = advanceCampaignSave(campaign, 1);
    setCampaign(next);
    onChange?.(next);
  };

  /** Render the working campaign as canonical JSON. */
  const handleExport = (): void => {
    setExportText(serializeCampaign(campaign));
    pushLedger("info", "saves.ledger.exported", { label: campaignLabel(campaign, t) });
  };

  /** Validate pasted JSON and adopt it as the working campaign. */
  const handleImport = (): void => {
    try {
      const imported = deserializeCampaignMigrated(importText);
      setCampaign(imported);
      onChange?.(imported);
      pushLedger("success", "saves.ledger.imported", { label: campaignLabel(imported, t) });
    } catch (error) {
      pushLedger("error", "saves.ledger.importRejected", { error: messageOf(error) });
    }
  };

  return (
    <section className="saves-screen" data-testid="saves-screen" aria-label={t("saves.label")}>
      <header className="saves-screen__header">
        <div>
          <p className="kicker">{t("saves.kicker")}</p>
          <h2>{t("saves.title")}</h2>
          <p className="muted">{t("saves.blurb")}</p>
        </div>
        <dl className="saves-screen__company" data-testid="saves-current">
          <div>
            <dt>{t("common.company")}</dt>
            <dd data-testid="saves-current-company">{campaign.company.name}</dd>
          </div>
          <div>
            <dt>{t("common.day")}</dt>
            <dd data-testid="saves-current-day">{campaign.company.theatre.day}</dd>
          </div>
          <div>
            <dt>{t("common.crowns")}</dt>
            <dd data-testid="saves-current-crowns">{crownsLabel(campaign.company.crowns, t)}</dd>
          </div>
          <div>
            <dt>{t("common.roster")}</dt>
            <dd data-testid="saves-current-roster">
              {t("common.soldiers", { count: campaign.company.roster.length })}
            </dd>
          </div>
          <div>
            <dt>{t("common.seed")}</dt>
            <dd data-testid="saves-current-seed">{String(campaign.seed)}</dd>
          </div>
          <div>
            <dt>{t("common.format")}</dt>
            <dd data-testid="saves-current-version">v{campaign.version}</dd>
          </div>
        </dl>
      </header>

      <div className="saves-screen__body">
        <section className="saves-panel" aria-label={t("saves.autosaveLabel")}>
          <h3>{t("saves.autosaveLabel")}</h3>
          <div
            className="saves-autosave"
            data-testid="saves-autosave"
            data-filled={autosaveInfo !== undefined}
          >
            <p className="saves-autosave__state" data-testid="saves-autosave-state">
              {autosaveInfo === undefined ? t("saves.noAutosave") : autosaveInfo.label}
            </p>
            <p className="muted" data-testid="saves-autosave-time">
              {autosaveInfo === undefined ? t("common.none") : formatTime(autosaveInfo.savedAt)}
            </p>
            <button
              type="button"
              className="button"
              data-testid="saves-autosave-now"
              disabled={busy}
              onClick={() => void handleAutosaveNow()}
            >
              {t("saves.autosaveNow")}
            </button>
          </div>
        </section>

        <section className="saves-panel" aria-label={t("saves.slotsLabel")}>
          <h3>{t("saves.slots")}</h3>
          <label className="saves-label" htmlFor="saves-label-input">
            {t("saves.slotLabel")}
          </label>
          <input
            id="saves-label-input"
            className="saves-label-input"
            data-testid="saves-label"
            type="text"
            placeholder={campaignLabel(campaign, t)}
            value={label}
            maxLength={48}
            onChange={(event) => setLabel(event.target.value)}
          />
          <table className="saves-table" data-testid="saves-slots">
            <thead>
              <tr>
                <th scope="col">{t("saves.slot")}</th>
                <th scope="col">{t("saves.record")}</th>
                <th scope="col">{t("saves.written")}</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {slots.map((slot) => {
                const info = infoBySlot.get(slot);
                const filled = info !== undefined;
                return (
                  <tr key={slot} data-testid={`saves-slot-${slot}`} data-filled={filled}>
                    <th scope="row">{slot}</th>
                    <td data-testid={`saves-slot-${slot}-label`}>
                      {info === undefined ? t("saves.empty") : info.label}
                    </td>
                    <td data-testid={`saves-slot-${slot}-time`}>
                      {info === undefined ? t("common.none") : formatTime(info.savedAt)}
                    </td>
                    <td className="saves-table__actions">
                      <button
                        type="button"
                        className="button"
                        data-testid={`saves-save-${slot}`}
                        disabled={busy}
                        onClick={() => void handleSave(slot)}
                      >
                        {t("common.save")}
                      </button>
                      <button
                        type="button"
                        className="button button--ghost"
                        data-testid={`saves-load-${slot}`}
                        disabled={busy || !filled}
                        onClick={() => void handleLoad(slot)}
                      >
                        {t("common.load")}
                      </button>
                      <button
                        type="button"
                        className="button button--ghost"
                        data-testid={`saves-delete-${slot}`}
                        disabled={busy || !filled}
                        onClick={() => void handleDelete(slot)}
                      >
                        {t("saves.strike")}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <button
            type="button"
            className="button button--ghost"
            data-testid="saves-advance-day"
            disabled={busy}
            onClick={handleAdvance}
          >
            {t("saves.advanceDay")}
          </button>
        </section>

        <section className="saves-panel" aria-label={t("saves.exportLabel")}>
          <h3>{t("saves.exportJson")}</h3>
          <p className="muted">{t("saves.exportNote")}</p>
          <button
            type="button"
            className="button"
            data-testid="saves-export"
            onClick={handleExport}
          >
            {t("saves.export")}
          </button>
          <textarea
            className="saves-json"
            data-testid="saves-export-json"
            aria-label={t("saves.exportJsonLabel")}
            readOnly
            rows={6}
            value={exportText}
          />
          {exportHref !== undefined && (
            <a
              className="saves-download"
              data-testid="saves-download"
              href={exportHref}
              download="lines-of-glory-campaign.json"
            >
              {t("saves.download")}
            </a>
          )}
        </section>

        <section className="saves-panel" aria-label={t("saves.importLabel")}>
          <h3>{t("saves.importJson")}</h3>
          <p className="muted">{t("saves.importNote")}</p>
          <textarea
            className="saves-json"
            data-testid="saves-import-json"
            aria-label={t("saves.importJsonLabel")}
            rows={6}
            placeholder={t("saves.importPlaceholder")}
            value={importText}
            onChange={(event) => setImportText(event.target.value)}
          />
          <button
            type="button"
            className="button"
            data-testid="saves-import"
            disabled={busy || importText.trim().length === 0}
            onClick={handleImport}
          >
            {t("saves.import")}
          </button>
        </section>

        <section className="saves-panel" aria-label={t("saves.ledgerLabel")}>
          <h3>{t("saves.ledger")}</h3>
          {ledger.length === 0 ? (
            <p className="muted" data-testid="saves-ledger-empty">
              {t("saves.noOrders")}
            </p>
          ) : (
            <ol className="saves-ledger" data-testid="saves-ledger">
              {ledger.map((entry, index) => (
                <li
                  key={`${index}-${entry.key}`}
                  data-kind={entry.kind}
                  data-testid={`saves-ledger-${index}`}
                >
                  {t(entry.key, entry.vars)}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </section>
  );
}
