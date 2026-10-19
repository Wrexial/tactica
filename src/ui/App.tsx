import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  chooseAction,
  createBattleController,
  holdOrder,
  selectUnit,
  setCursor,
  type BattleController,
} from "../app/battleController";
import {
  activeContractName,
  campaignAiHoldsTurn,
  campaignBattleController,
  createCampaignState,
  createDemoCampaign,
  dismissCampaignResult,
  resolveCampaignBattle,
  runCampaignTurn,
  startCampaignBattle,
  type CampaignState,
} from "../app/campaignController";
import { createDemoBattle } from "../app/demoScenario";
import {
  createSkirmishBattle,
  resolveSkirmishBattle,
  runSkirmishTurn,
  skirmishAiHoldsTurn,
  SKIRMISH_NAME,
} from "../app/skirmishScenario";
import { createInputController, type InputController } from "../app/input";
import {
  aoePreviewFor,
  areaHitsFor,
  dangerZoneFor,
  elevationDeltaFor,
} from "../app/targetingPreview";
import { actionSpecOf } from "../engine/actions/resolve";
import { findAbility } from "../data/abilities";
import type { Coord } from "../engine/grid";
import { asContractId, type AbilityId } from "../engine/ids";
import { tilesInRange } from "../engine/targeting";
import type { BattleEvent } from "../engine/events";
import type { Objective } from "../engine/objectives";
import { isOutOfAction, type Unit } from "../engine/unit";
import type { ContractDef } from "../data/schema";
import {
  AUTOSAVE_SLOT,
  createIndexedDbSaveStore,
  createMemorySaveStore,
  isIndexedDbAvailable,
  saveCampaign,
  type SaveStore,
} from "../persist";
import { announce, describeEvents, installAccessibility } from "./a11y";
import { CampaignMap } from "./CampaignMap";
import { Depot } from "./Depot";
import { Forecast } from "./Forecast";
import { AbilityInfo } from "./AbilityInfo";
import { InfoTip, Tooltip } from "./Tooltip";
import { targetForCursor } from "./battleForecast";
import { Menus } from "./Menus";
import { Mess } from "./Mess";
import { PostScreen } from "./PostScreen";
import { Saves } from "./Saves";
import { Settings } from "./Settings";
import { LobbyScreen } from "./Lobby";
import { TempoTray } from "./TempoTray";
import { Tutorial } from "./Tutorial";
import { UnitCard, type UnitCardRole } from "./UnitCard";
import {
  ANIMATION_TICK_MS,
  animationDurationMs,
  animationsForEvents,
  type BattleAnimation,
} from "../render/animations";
import { createScene, type Scene } from "../render/scene";
import { useTranslation, type MessageKey, type Translator } from "../i18n";

/** The catalog key for each top-level screen, announced when the view changes. */
const SCREEN_KEYS: Readonly<Record<string, MessageKey>> = {
  battle: "screen.battlefield",
  menus: "screen.campOrders",
  posts: "screen.barracks",
  mess: "screen.mess",
  map: "screen.campaignMap",
  depot: "screen.quartermaster",
  saves: "screen.saves",
  settings: "screen.settings",
  lobby: "screen.lobby",
};

/** A controller for the demo action, with the cursor on the acting soldier. */
function initialController(): BattleController {
  const controller = createBattleController(createDemoBattle());
  const actor = controller.battle.units.find(
    (unit) => unit.id === controller.battle.currentActorId,
  );
  return actor !== undefined ? setCursor(controller, actor.at) : controller;
}

/** Human-readable elevation delta for the HUD: `level`, `+2` or `-1`. */
function formatElevation(preview: { readonly delta: number } | null, t: Translator): string {
  if (preview === null) return t("common.none");
  if (preview.delta === 0) return t("hud.elevationLevel");
  return preview.delta > 0 ? `+${preview.delta}` : `${preview.delta}`;
}

/** The browser save backend when available, else the in-memory test double (T102). */
function createDefaultSaveStore(): SaveStore {
  if (isIndexedDbAvailable()) {
    try {
      return createIndexedDbSaveStore();
    } catch {
      // Fall through to the memory backend below.
    }
  }
  return createMemorySaveStore();
}

/** The active action's win condition, in the player's words (T031, mapping §10). */
function objectiveLabel(objective: Objective | null | undefined, t: Translator): string {
  if (objective === null || objective === undefined) return t("contract.battle.objective.none");
  switch (objective.kind) {
    case "annihilation":
      return t("contract.battle.objective.annihilation");
    case "rout":
      return t("contract.battle.objective.rout", { count: objective.defeated });
    case "survive":
      return t("contract.battle.objective.survive", { count: objective.turns });
    case "capture":
      return t("contract.battle.objective.capture");
    case "defend":
      return t("contract.battle.objective.defend", { count: objective.turns });
  }
}

/** The after-action headline for a finished battle's outcome. */
function outcomeLabel(outcome: string, t: Translator): string {
  switch (outcome) {
    case "companyVictory":
      return t("contract.result.victory");
    case "companyDefeat":
      return t("contract.result.defeat");
    default:
      return t("contract.result.draw");
  }
}

/** Beat between a resolved animation and the next AI turn, in milliseconds. */
const AI_THINK_MS = 450;

/** Slack added to an animation batch before field orders unlock, in ms. */
const ANIMATION_BUFFER_MS = 140;

/** Milliseconds per Orders Tempo tick; `0` when the player prefers reduced motion. */
function animationTickMs(): number {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return ANIMATION_TICK_MS;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : ANIMATION_TICK_MS;
}

/**
 * Application shell: a full-bleed battlefield canvas with a DOM HUD overlaid.
 *
 * T027's battle controller is the source of truth; this component is a thin
 * bridge. T029's Pixi scene draws the terrain, T030's `render/overlay.ts` draws
 * the move range and planned march, and T030's `app/input.ts` turns pointer,
 * touch and keyboard events back into controller transitions. React never
 * mutates engine state — it only holds the latest immutable controller and
 * re-syncs the overlay when it changes.
 */
export function App() {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const [controller, setController] = useState<BattleController>(initialController);
  const [animations, setAnimations] = useState<readonly BattleAnimation[]>([]);
  // While `busy`, an animation batch is still playing: the AI waits and the
  // player cannot commit orders, so neither races the other's resolution.
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const busyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The Orders entry the pointer (or keyboard focus) is over, so its reach can
  // be previewed on the field before the order is chosen.
  const [previewActionId, setPreviewActionId] = useState<AbilityId | null>(null);
  const [inputReady, setInputReady] = useState(false);
  const [view, setView] = useState<
    "battle" | "menus" | "posts" | "mess" | "map" | "depot" | "saves" | "settings" | "lobby"
  >("battle");
  // T110 — the drill-square overlay runs on top of the battlefield; it does not
  // change the view, so the field stays the source of truth while it is open.
  const [tutorialActive, setTutorialActive] = useState(false);
  const controllerRef = useRef(controller);
  const viewRef = useRef(view);
  viewRef.current = view;

  // T121 — the working campaign (save + live battle) and the versioned save
  // backend it autosaves through (T102). The Field's `controller` is the UI
  // view of `campaign.battle` while a contract is being fought.
  const [campaign, setCampaign] = useState<CampaignState>(() =>
    createCampaignState(createDemoCampaign()),
  );
  const [store] = useState<SaveStore>(() => createDefaultSaveStore());
  // Bumped whenever a new campaign battle takes the Field, so React hands the
  // renderer a fresh canvas instead of re-initialising WebGL on the old one
  // (which Pixi cannot do synchronously). See the scene effect below.
  const [fieldEpoch, setFieldEpoch] = useState(0);
  // Which battle owns the Field: the sandbox demo (initial), a preset Quick
  // Battle, or the campaign contract currently being fought (T121).
  const [fieldMode, setFieldMode] = useState<"demo" | "skirmish" | "campaign">("demo");
  const campaignRef = useRef(campaign);
  campaignRef.current = campaign;

  // The last order's events, tracked by identity so its animation cues and
  // screen-reader announcement play exactly **once**. The controller object is
  // replaced on every cursor move, selection and menu step, so keying the
  // effects on the controller replays the last march's animation each time.
  const playedEventsRef = useRef<readonly BattleEvent[] | null>(null);
  const announcedEventsRef = useRef<readonly BattleEvent[] | null>(null);

  const applyController = useCallback((next: BattleController) => {
    // Update the ref synchronously so fast key sequences never read a stale
    // controller before React has re-rendered.
    controllerRef.current = next;
    setController(next);
    // Keep the campaign's copy of the active battle in step with the Field so
    // the AI phase and the after-action reducer see the player's orders.
    setCampaign((current) =>
      current.contractId === null || current.battle === next.battle
        ? current
        : { ...current, battle: next.battle },
    );
  }, []);

  // T121 — the campaign field loop, paced one hostile turn at a time. Each
  // burst of AI events plays out (and holds `busy`) before the next enemy acts,
  // so the action reads like a sequence of turns rather than one jump.
  useEffect(() => {
    if (busy || !campaignAiHoldsTurn(campaign)) return;
    const timer = setTimeout(() => {
      const update = runCampaignTurn(campaignRef.current);
      setCampaign(update.state);
      const next = campaignBattleController(update.state);
      if (next !== null) applyController({ ...next, lastEvents: update.events });
    }, AI_THINK_MS);
    return () => clearTimeout(timer);
  }, [campaign, busy, applyController]);

  // Quick Battle: pace the hostile phase one turn at a time, between animations.
  useEffect(() => {
    if (busy || fieldMode !== "skirmish") return;
    if (!skirmishAiHoldsTurn(controllerRef.current.battle)) return;
    const timer = setTimeout(() => {
      const update = runSkirmishTurn(controllerRef.current.battle);
      if (update === null) return;
      applyController({ ...createBattleController(update.battle), lastEvents: update.events });
    }, AI_THINK_MS);
    return () => clearTimeout(timer);
  }, [controller, busy, fieldMode, applyController]);

  // T102 — rolling autosave: every change to the working campaign is written to
  // the dedicated autosave slot, so the company always has a restore point.
  useEffect(() => {
    void saveCampaign(store, AUTOSAVE_SLOT, campaign.save, {
      label: t("saves.campaignLabel", {
        company: campaign.save.company.name,
        day: campaign.save.company.theatre.day,
      }),
    }).catch(() => {
      // A failed autosave must never break the action; the manual Saves screen
      // reports backend errors to the player.
    });
  }, [campaign.save, store, t]);

  // T109 — accessibility basics: mirror the OS motion preference and the saved
  // colour-blind palette onto the root, and create the shared live region.
  useEffect(() => installAccessibility(), []);

  // Drop any pending animation-gate timer on unmount.
  useEffect(() => () => clearTimeout(busyTimerRef.current), []);

  // Announce the active screen for screen-reader users as they move in and out
  // of the camp. Harmless on the first mount and on every subsequent change.
  useEffect(() => {
    announce(t(SCREEN_KEYS[view] ?? "screen.fallback"));
  }, [t, view]);

  // Keyboard/gamepad navigation between the field and the camp (T087). These
  // callbacks are stable so the scene + input effect never tears down on a view
  // change; the input controller reads the live view through `viewRef`.
  const returnToField = useCallback(() => {
    setView((current) => (current === "battle" ? current : "battle"));
    // Hand the grid back the cursor: drop focus from the camp control.
    if (typeof document !== "undefined") {
      (document.activeElement as HTMLElement | null)?.blur?.();
    }
  }, []);

  const toggleCamp = useCallback(() => {
    setView((current) => (current === "battle" ? "menus" : "battle"));
  }, []);

  // T121 — the Officers' Mess hands an accepted contract to the campaign: the
  // fee is paid, the battle is deployed and the enemy's opening turns are taken
  // before the player ever sees the Field.
  const acceptContract = useCallback(
    (contract: ContractDef) => {
      const started = startCampaignBattle(campaignRef.current, asContractId(contract.id));
      setCampaign(started);
      setFieldMode("campaign");
      const field = campaignBattleController(started);
      if (field !== null) {
        setFieldEpoch((current) => current + 1);
        applyController(field);
      }
    },
    [applyController],
  );

  // Quick Battle: start (or restart) the preset two-team scene on the Field.
  const startSkirmish = useCallback(() => {
    setFieldMode("skirmish");
    setFieldEpoch((current) => current + 1);
    setView("battle");
    // Hand the grid control back from the nav button that started the scene.
    if (typeof document !== "undefined") {
      (document.activeElement as HTMLElement | null)?.blur?.();
    }
    applyController(createBattleController(createSkirmishBattle()));
  }, [applyController]);

  // Quick Battle: hand the rest of the action to the deterministic AI and show
  // the result.
  const resolveSkirmish = useCallback(() => {
    const update = resolveSkirmishBattle(controllerRef.current.battle);
    applyController({ ...createBattleController(update.battle), lastEvents: update.events });
  }, [applyController]);

  // Commit the company to a decisive auto-battle: both sides are played by the
  // deterministic AI until the objective resolves (T098/T119).
  const resolveCampaign = useCallback(() => {
    const update = resolveCampaignBattle(campaignRef.current);
    setCampaign(update.state);
    const next = campaignBattleController(update.state);
    if (next !== null) applyController({ ...next, lastEvents: update.events });
  }, [applyController]);

  // Close the after-action report and return to the Mess to take the next post.
  const dismissResult = useCallback(() => {
    setCampaign((current) => dismissCampaignResult(current));
    // Reset the Field to a fresh Quick Battle behind the Mess, so the finished
    // contract is not left on the board when the player returns.
    setFieldMode("skirmish");
    setFieldEpoch((current) => current + 1);
    applyController(createBattleController(createSkirmishBattle()));
    setView("mess");
  }, [applyController]);

  // Targeting preview (T085): reach, area footprint, danger zone and elevation.
  // Derived purely from the controller so the overlay and the HUD read the same
  // numbers; the overlay itself only draws what it is handed.
  const targeting = useMemo(() => {
    const map = controller.battle.map;
    const cursor = controller.cursor;
    const spec =
      controller.pendingActionId === null
        ? null
        : (actionSpecOf(controller.battle, controller.pendingActionId) ?? null);

    const areaTiles =
      controller.phase === "target" && cursor !== null && spec !== null
        ? aoePreviewFor(map, cursor, spec)
        : [];
    const areaHits = areaTiles.length === 0 ? [] : areaHitsFor(controller.battle.units, areaTiles);

    const danger = controller.selectedUnitId === null ? [] : dangerZoneFor(controller.battle);

    const referenceId = controller.selectedUnitId ?? controller.battle.currentActorId;
    const reference =
      referenceId === null
        ? null
        : (controller.battle.units.find((unit) => unit.id === referenceId)?.at ?? null);
    const elevation =
      cursor !== null && reference !== null
        ? { at: cursor, delta: elevationDeltaFor(map, reference, cursor) }
        : null;

    return { areaTiles, areaHits, danger, elevation };
  }, [controller]);

  // Orders hover preview: the tiles an action would reach from the selected
  // soldier, computed without touching the engine so a browse costs nothing.
  // Once an order is actually being aimed, the controller's own `targetTiles`
  // take over (see `targetRangeTiles` below).
  const previewRange = useMemo(() => {
    if (previewActionId === null || !controller.canAct) return [];
    if (controller.phase === "target" || controller.phase === "confirm") return [];
    const unit =
      controller.selectedUnitId === null
        ? null
        : (controller.battle.units.find(
            (candidate) => candidate.id === controller.selectedUnitId,
          ) ?? null);
    const spec = actionSpecOf(controller.battle, previewActionId);
    if (unit === null || spec === undefined) return [];
    return tilesInRange(controller.battle.map, unit.at, { min: 0, max: spec.range });
  }, [previewActionId, controller]);

  /** The reach the overlay should paint: a live aim, else the hover preview. */
  const targetRangeTiles =
    controller.phase === "target" || controller.phase === "confirm"
      ? controller.targetTiles
      : previewRange;

  // Battle forecast (T086): the aim, once chosen, is projected through the
  // engine's rules so the confirm prompt can show odds and reaction risk before
  // the order is committed. Derived purely from the controller, like targeting.
  const forecast = useMemo(() => {
    if (controller.phase !== "target" && controller.phase !== "confirm") return null;
    const actorId = controller.selectedUnitId;
    if (actorId === null || controller.pendingActionId === null) return null;
    const spec = actionSpecOf(controller.battle, controller.pendingActionId);
    if (spec === undefined) return null;
    const target =
      controller.pendingTarget ??
      (controller.cursor === null ? null : targetForCursor(controller.battle, controller.cursor));
    if (target === null) return null;
    return { actorId, spec, target };
  }, [controller]);

  // T135 — the tile the forecast card anchors beside: the aimed-at soldier's
  // tile, or the aimed tile for ground-target orders (self-target aims at the
  // actor). Kept separate from the projection so the card can be placed through
  // the live camera without `Forecast` itself knowing the rules of targeting.
  const forecastAnchor = useMemo((): Coord | null => {
    if (forecast === null) return null;
    const target = forecast.target;
    if (target.kind === "self") {
      const actorUnit = controller.battle.units.find((unit) => unit.id === forecast.actorId);
      return actorUnit?.at ?? null;
    }
    if (target.kind === "unit") {
      const unit = controller.battle.units.find((candidate) => candidate.id === target.unitId);
      return unit?.at ?? null;
    }
    return target.at;
  }, [forecast, controller.battle.units]);

  // The active board's identity. `step` keeps the map reference stable across
  // orders, so this changes only when the Field switches battles (T121); the
  // scene then rebuilds around the new board.
  const fieldMap = controller.battle.map;

  // Scene + input lifecycle. The input binding waits for Pixi to be ready so
  // the first click unprojects through a correctly framed camera.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    let disposed = false;
    let input: InputController | null = null;
    const scene = createScene(canvas, fieldMap);
    sceneRef.current = scene;

    void scene.ready.then(() => {
      if (disposed) return;
      input = createInputController({
        canvas,
        getCamera: () => scene.camera,
        getController: () => controllerRef.current,
        // Orders are ignored while an animation or the AI phase resolves.
        getLocked: () => busyRef.current,
        onControllerChange: applyController,
        getView: () => (viewRef.current === "battle" ? "battle" : "menu"),
        onBack: returnToField,
        onOpenMenu: toggleCamp,
      });
      // Flag input as bound so tests (and anything else that must not race the
      // async Pixi init) can wait for it before dispatching key/pointer events.
      setInputReady(true);
    });

    return () => {
      disposed = true;
      setInputReady(false);
      input?.dispose();
      scene.dispose();
      sceneRef.current = null;
    };
  }, [fieldMap, fieldEpoch, applyController, returnToField, toggleCamp]);

  // Sync the scene (units), overlay and animations to the controller after
  // every transition. Animation cues are derived **only** from the engine
  // events the last order emitted (`lastEvents`), never from a state diff.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const map = controller.battle.map;
    const units = controller.battle.units;
    const unitById = new Map(units.map((unit) => [unit.id, unit] as const));
    scene.setUnits(units, controller.battle.tempo);
    scene.overlay.setDangerZone(targeting.danger, map);
    scene.overlay.setMoveRange(
      controller.moveRange.map((tile) => tile.at),
      map,
    );
    scene.overlay.setTargetRange(targetRangeTiles, map);
    scene.overlay.setArea({ tiles: targeting.areaTiles, hits: targeting.areaHits }, map);
    scene.overlay.setElevationPreview(targeting.elevation, map);
    scene.overlay.setPath(controller.pendingPath ?? [], map);
    scene.overlay.setCursor(controller.cursor, map);

    const cues = animationsForEvents(controller.lastEvents, {
      unitAt: (unitId) => unitById.get(unitId)?.at,
      unitName: (unitId) => unitById.get(unitId)?.name,
    });
    // Replay a dispatch's cues only when it actually produced new events; the
    // unit/overlay sync above still runs on every controller change.
    if (controller.lastEvents !== playedEventsRef.current) {
      playedEventsRef.current = controller.lastEvents;
      scene.playAnimations(cues);
      setAnimations(cues);
      // Hold orders until the batch has finished playing, so the AI (or the
      // player) cannot act on top of an unresolved action.
      const duration = animationDurationMs(cues, animationTickMs());
      if (duration > 0) {
        busyRef.current = true;
        setBusy(true);
        clearTimeout(busyTimerRef.current);
        busyTimerRef.current = setTimeout(() => {
          busyRef.current = false;
          setBusy(false);
        }, duration + ANIMATION_BUFFER_MS);
      }
    }
  }, [controller, targeting, targetRangeTiles]);

  // T109 — read the resolved battle events aloud through the live region, so a
  // screen-reader player hears the same report the battle log shows. The
  // description is pure (`describeEvents`) and skips bookkeeping events.
  useEffect(() => {
    if (controller.lastEvents === announcedEventsRef.current) return;
    announcedEventsRef.current = controller.lastEvents;
    const text = describeEvents(controller.lastEvents, {
      unitName: (unitId) => controller.battle.units.find((unit) => unit.id === unitId)?.name,
    });
    if (text.length > 0) announce(text);
  }, [controller]);

  const actor = useMemo(() => {
    const id = controller.battle.currentActorId;
    return id === null ? null : (controller.battle.units.find((unit) => unit.id === id) ?? null);
  }, [controller.battle]);

  const selected = useMemo(
    () =>
      controller.selectedUnitId === null
        ? null
        : (controller.battle.units.find((unit) => unit.id === controller.selectedUnitId) ?? null),
    [controller.battle, controller.selectedUnitId],
  );

  // T134 — the soldier whose anchored card is shown. The card is an on-demand
  // readout: it appears for a **selected** soldier, or for whichever soldier
  // the cursor is deliberately inspecting (a hovered soldier that is not the
  // current actor). It is intentionally **not** painted for the acting soldier
  // merely because the cursor happens to rest on its tile, and it is dismissed
  // while aiming — otherwise a wide card parks itself over the middle of the
  // field and hides the very tiles the player is trying to inspect or aim at.
  const focus = useMemo((): { readonly unit: Unit; readonly role: UnitCardRole } | null => {
    if (controller.phase === "target" || controller.phase === "confirm") return null;
    if (selected !== null) return { unit: selected, role: "selected" };
    const cursor = controller.cursor;
    const hovered =
      cursor === null
        ? null
        : (controller.battle.units.find(
            (unit) => unit.at.x === cursor.x && unit.at.y === cursor.y,
          ) ?? null);
    if (hovered !== null && hovered.id !== actor?.id) return { unit: hovered, role: "hovered" };
    return null;
  }, [controller.battle.units, controller.cursor, controller.phase, selected, actor]);

  const cursorLabel =
    controller.cursor === null
      ? t("common.none")
      : `${controller.cursor.x}, ${controller.cursor.y}`;

  return (
    <div className="app">
      <a
        className="skip-link"
        href="#main-content"
        data-testid="skip-link"
        onClick={(event) => {
          // Manage focus ourselves rather than let the fragment jump move it,
          // so the next Tab starts inside the battlefield/camp stage.
          event.preventDefault();
          const target = document.getElementById("main-content");
          if (target !== null) {
            target.focus();
            target.scrollIntoView({ block: "start" });
            window.history.replaceState(null, "", "#main-content");
          }
        }}
      >
        {t("app.skipToBattlefield")}
      </a>
      <header className="topbar">
        <div className="brand">
          <p className="kicker">{t("app.kicker")}</p>
          <h1>{t("app.title")}</h1>
        </div>
        <span className="badge">{t("app.badge")}</span>
      </header>

      <nav className="viewnav" aria-label={t("nav.label")}>
        <button
          type="button"
          className={view === "battle" ? "viewnav__button is-active" : "viewnav__button"}
          data-testid="nav-battle"
          aria-pressed={view === "battle"}
          onClick={() => setView("battle")}
        >
          {t("nav.battlefield")}
        </button>
        <button
          type="button"
          className={
            fieldMode === "skirmish" && view === "battle"
              ? "viewnav__button is-active"
              : "viewnav__button"
          }
          data-testid="nav-quick-battle"
          aria-pressed={fieldMode === "skirmish" && view === "battle"}
          onClick={startSkirmish}
        >
          {t("nav.quickBattle")}
        </button>
        <button
          type="button"
          className={view === "menus" ? "viewnav__button is-active" : "viewnav__button"}
          data-testid="nav-menu"
          aria-pressed={view === "menus"}
          onClick={() => setView("menus")}
        >
          {t("nav.campOrders")}
        </button>
        <button
          type="button"
          className={view === "posts" ? "viewnav__button is-active" : "viewnav__button"}
          data-testid="nav-posts"
          aria-pressed={view === "posts"}
          onClick={() => setView("posts")}
        >
          {t("nav.barracks")}
        </button>
        <button
          type="button"
          className={view === "mess" ? "viewnav__button is-active" : "viewnav__button"}
          data-testid="nav-mess"
          aria-pressed={view === "mess"}
          onClick={() => setView("mess")}
        >
          {t("nav.mess")}
        </button>
        <button
          type="button"
          className={view === "map" ? "viewnav__button is-active" : "viewnav__button"}
          data-testid="nav-map"
          aria-pressed={view === "map"}
          onClick={() => setView("map")}
        >
          {t("nav.campaignMap")}
        </button>
        <button
          type="button"
          className={view === "depot" ? "viewnav__button is-active" : "viewnav__button"}
          data-testid="nav-depot"
          aria-pressed={view === "depot"}
          onClick={() => setView("depot")}
        >
          {t("nav.quartermaster")}
        </button>
        <button
          type="button"
          className={view === "saves" ? "viewnav__button is-active" : "viewnav__button"}
          data-testid="nav-saves"
          aria-pressed={view === "saves"}
          onClick={() => setView("saves")}
        >
          {t("nav.saves")}
        </button>
        <button
          type="button"
          className={view === "settings" ? "viewnav__button is-active" : "viewnav__button"}
          data-testid="nav-settings"
          aria-pressed={view === "settings"}
          onClick={() => setView("settings")}
        >
          {t("nav.settings")}
        </button>
        <button
          type="button"
          className={view === "lobby" ? "viewnav__button is-active" : "viewnav__button"}
          data-testid="nav-lobby"
          aria-pressed={view === "lobby"}
          onClick={() => setView("lobby")}
        >
          {t("nav.lobby")}
        </button>
        <button
          type="button"
          className={tutorialActive ? "viewnav__button is-active" : "viewnav__button"}
          data-testid="nav-tutorial"
          aria-pressed={tutorialActive}
          onClick={() => {
            setView("battle");
            setTutorialActive((current) => !current);
          }}
        >
          {t("nav.drillSquare")}
        </button>
      </nav>

      <main className="stage" id="main-content" tabIndex={-1} aria-label={t("stage.label")}>
        <canvas
          key={fieldEpoch}
          ref={canvasRef}
          className="battlefield"
          data-testid="battle-canvas"
          data-input-ready={inputReady}
          role="img"
          aria-label={t("canvas.label")}
        />

        {/* T137 — the battle log is the last survivor of the old side column:
            it collapses behind a toggle so the field keeps its room. The log
            list (`animation-log`) and its cue entries are unchanged. */}
        {view === "battle" && (
          <details className="battle-log" data-testid="battle-log">
            <summary className="battle-log__toggle">
              <span className="battle-log__title" role="heading" aria-level={3}>
                {t("hud.battleLog")}
              </span>
              <span className="battle-log__count" aria-hidden="true">
                {animations.length}
              </span>
            </summary>
            <ol
              className="battle-log__list"
              data-testid="animation-log"
              aria-label={t("hud.battleLogLabel")}
            >
              {animations.map((animation, index) => (
                <li
                  key={`${animation.kind}-${index}`}
                  data-testid={`animation-${index}`}
                  data-kind={animation.kind}
                >
                  {animation.label}
                </li>
              ))}
            </ol>
          </details>
        )}

        {/* T134 — the per-character card, anchored beside the inspected soldier
            (selected, or a hovered soldier the player is looking over) through
            the live camera projection. On demand only, so it stays off the field. */}
        {view === "battle" && focus !== null && (
          <UnitCard
            unit={focus.unit}
            role={focus.role}
            sceneRef={sceneRef}
            canvasRef={canvasRef}
            ready={inputReady}
          />
        )}

        {/* T135 — the forecast card, anchored beside the aimed-at soldier
            through the live camera projection (T133) rather than the side
            panel. The engine projection still supplies every number. */}
        {view === "battle" && forecast !== null && (
          <Forecast
            battle={controller.battle}
            actorId={forecast.actorId}
            spec={forecast.spec}
            target={forecast.target}
            anchorAt={forecastAnchor}
            sceneRef={sceneRef}
            canvasRef={canvasRef}
            ready={inputReady}
          />
        )}

        {/* T135 — the field's bottom dock: the compact command band (FFT Blue's
            `ActionMenu`) stacks directly above the Orders Tempo tray so the two
            bottom surfaces never overlap. Pointer events pass through the dock
            so it never steals a click from the field. */}
        {view === "battle" && (
          <div className="field-dock">
            {/* T137 — the compact field readout: phase, cursor, reach, area,
                danger and elevation. The surviving strip of the old side
                panel is folded into the bottom band so the field keeps its
                width; the `hud-*` test ids are unchanged. */}
            <section className="field-readout" aria-label={t("hud.orders")}>
              {/* T134 — the selected soldier is announced to assistive tech;
                  the visible readout lives on the anchored card. */}
              <p className="visually-hidden" data-testid="hud-selected">
                {selected?.name ?? t("common.none")}
              </p>
              <p className="visually-hidden" data-testid="hud-controls">
                {t("hud.controls")}
              </p>
              <dl className="field-readout__list">
                <div>
                  <dt>
                    {t("hud.tempo")}{" "}
                    <InfoTip
                      testId="hud-help-tempo"
                      side="left"
                      title={t("tip.moreInfo")}
                      label={t("hud.help.tempo")}
                    />
                  </dt>
                  <dd data-testid="hud-actor">{actor?.name ?? t("common.none")}</dd>
                </div>
                <div>
                  <dt>
                    {t("hud.phase")}{" "}
                    <InfoTip
                      testId="hud-help-phase"
                      side="left"
                      title={t("tip.moreInfo")}
                      label={t("hud.help.phase")}
                    />
                  </dt>
                  <dd data-testid="hud-phase">{controller.phase}</dd>
                </div>
                <div>
                  <dt>
                    {t("hud.cursor")}{" "}
                    <InfoTip
                      testId="hud-help-cursor"
                      side="left"
                      title={t("tip.moreInfo")}
                      label={t("hud.help.cursor")}
                    />
                  </dt>
                  <dd data-testid="hud-cursor">{cursorLabel}</dd>
                </div>
                <div>
                  <dt>
                    {t("hud.moveRange")}{" "}
                    <InfoTip
                      testId="hud-help-move-range"
                      side="left"
                      title={t("tip.moreInfo")}
                      label={t("hud.help.moveRange")}
                    />
                  </dt>
                  <dd data-testid="hud-move-range">
                    {t("common.tiles", { count: controller.moveRange.length })}
                  </dd>
                </div>
                <div>
                  <dt>
                    {t("hud.plannedMarch")}{" "}
                    <InfoTip
                      testId="hud-help-planned-march"
                      side="left"
                      title={t("tip.moreInfo")}
                      label={t("hud.help.plannedMarch")}
                    />
                  </dt>
                  <dd data-testid="hud-path">
                    {controller.pendingPath === null
                      ? t("common.none")
                      : t("common.tiles", { count: controller.pendingPath.length })}
                  </dd>
                </div>
                <div>
                  <dt>
                    {t("hud.targetReach")}{" "}
                    <InfoTip
                      testId="hud-help-target-reach"
                      side="left"
                      title={t("tip.moreInfo")}
                      label={t("hud.help.targetReach")}
                    />
                  </dt>
                  <dd data-testid="hud-target-range">
                    {t("common.tiles", { count: targetRangeTiles.length })}
                  </dd>
                </div>
                <div>
                  <dt>
                    {t("hud.area")}{" "}
                    <InfoTip
                      testId="hud-help-area"
                      side="left"
                      title={t("tip.moreInfo")}
                      label={t("hud.help.area")}
                    />
                  </dt>
                  <dd data-testid="hud-target-area">
                    {t("common.tiles", { count: targeting.areaTiles.length })}
                  </dd>
                </div>
                <div>
                  <dt>
                    {t("hud.dangerZone")}{" "}
                    <InfoTip
                      testId="hud-help-danger-zone"
                      side="left"
                      title={t("tip.moreInfo")}
                      label={t("hud.help.dangerZone")}
                    />
                  </dt>
                  <dd data-testid="hud-danger-zone">
                    {t("common.tiles", { count: targeting.danger.length })}
                  </dd>
                </div>
                <div>
                  <dt>
                    {t("hud.elevation")}{" "}
                    <InfoTip
                      testId="hud-help-elevation"
                      side="left"
                      title={t("tip.moreInfo")}
                      label={t("hud.help.elevation")}
                    />
                  </dt>
                  <dd data-testid="hud-elevation">{formatElevation(targeting.elevation, t)}</dd>
                </div>
              </dl>
              {controller.lastRejection !== null && (
                <p className="rejection" data-testid="hud-rejection">
                  {controller.lastRejection.message}
                </p>
              )}
            </section>
            {controller.canAct &&
              (controller.phase === "command" || controller.phase === "move") &&
              controller.actions.length > 0 && (
                <section
                  className="command-band"
                  data-testid="action-menu"
                  aria-label={t("hud.ordersLabel")}
                >
                  <h3 className="command-band__title">{t("hud.ordersHeading")}</h3>
                  <ul className="command-band__list">
                    {controller.actions.map((option) => (
                      <li key={option.id}>
                        <Tooltip
                          side="top"
                          bubbleTestId={`order-info-${option.id}`}
                          label={<AbilityInfo abilityId={option.id} spec={option.spec} />}
                        >
                          <button
                            type="button"
                            className="action-menu__button"
                            data-testid={`action-${option.id}`}
                            data-affordable={option.affordable}
                            disabled={!option.affordable}
                            onMouseEnter={() => setPreviewActionId(option.id)}
                            onMouseLeave={() =>
                              setPreviewActionId((current) =>
                                current === option.id ? null : current,
                              )
                            }
                            onFocus={() => setPreviewActionId(option.id)}
                            onBlur={() =>
                              setPreviewActionId((current) =>
                                current === option.id ? null : current,
                              )
                            }
                            onClick={() =>
                              applyController(chooseAction(controllerRef.current, option.id))
                            }
                          >
                            <span className="action-menu__name">
                              {findAbility(option.id)?.name ?? option.id}
                            </span>
                            <span className="action-menu__cost">
                              {t("hud.elanCost", { amount: option.spec.mpCost })}
                            </span>
                          </button>
                        </Tooltip>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            <TempoTray
              battle={controller.battle}
              onSelect={(unitId) => {
                const unit = controllerRef.current.battle.units.find((u) => u.id === unitId);
                if (unit !== undefined) {
                  applyController(setCursor(controllerRef.current, unit.at));
                }
              }}
            />
          </div>
        )}

        {view === "battle" && tutorialActive && (
          <Tutorial controller={controller} onClose={() => setTutorialActive(false)} />
        )}

        {view === "battle" && campaign.contractId !== null && campaign.result === null && (
          <section
            className="campaign-action"
            data-testid="campaign-battle"
            aria-label={t("contract.battle.label")}
          >
            <p className="kicker">{t("contract.battle.label")}</p>
            <h2 data-testid="campaign-contract">{activeContractName(campaign)}</h2>
            <p className="muted" data-testid="campaign-objective">
              {t("contract.battle.objectiveLabel")}:{" "}
              {objectiveLabel(controller.battle.objective?.objective, t)}
            </p>
            <div className="campaign-action__buttons">
              <button
                type="button"
                className="button"
                data-testid="campaign-hold"
                disabled={actor === null || actor.side !== "company" || isOutOfAction(actor)}
                onClick={() => {
                  const current = controllerRef.current;
                  const actorId = current.battle.currentActorId;
                  if (actorId === null) return;
                  applyController(holdOrder(selectUnit(current, actorId)));
                }}
              >
                {t("contract.battle.hold")}
              </button>
              <button
                type="button"
                className="button button--ghost"
                data-testid="campaign-resolve"
                onClick={resolveCampaign}
              >
                {t("contract.battle.resolve")}
              </button>
            </div>
          </section>
        )}

        {campaign.result !== null && (
          <section
            className="campaign-result"
            data-testid="campaign-result"
            role="dialog"
            aria-label={t("contract.result.label")}
          >
            <p className="kicker">{t("contract.result.label")}</p>
            <h2 data-testid="campaign-result-contract">{campaign.result.contractName}</h2>
            <p
              className={
                campaign.result.victory
                  ? "campaign-result__outcome is-victory"
                  : "campaign-result__outcome is-defeat"
              }
              data-testid="campaign-result-outcome"
            >
              {outcomeLabel(campaign.result.outcome, t)}
            </p>
            <dl className="campaign-result__stats">
              <div>
                <dt>{t("common.day")}</dt>
                <dd data-testid="campaign-result-day">
                  {t("contract.result.day", {
                    before: campaign.result.dayBefore,
                    after: campaign.result.dayAfter,
                  })}
                </dd>
              </div>
              <div>
                <dt>{t("common.crowns")}</dt>
                <dd data-testid="campaign-result-crowns">
                  {t("contract.result.crowns", {
                    before: campaign.result.crownsBefore,
                    after: campaign.result.crownsAfter,
                  })}
                </dd>
              </div>
              <div>
                <dt>{t("common.honours")}</dt>
                <dd data-testid="campaign-result-honours">
                  {t("contract.result.honours", {
                    before: campaign.result.honoursBefore,
                    after: campaign.result.honoursAfter,
                  })}
                </dd>
              </div>
            </dl>
            <button
              type="button"
              className="button"
              data-testid="campaign-result-dismiss"
              onClick={dismissResult}
            >
              {t("contract.result.dismiss")}
            </button>
          </section>
        )}

        {view === "battle" &&
          fieldMode === "skirmish" &&
          controller.battle.phase !== "finished" && (
            <section
              className="campaign-action"
              data-testid="skirmish-battle"
              aria-label={t("skirmish.label")}
            >
              <p className="kicker">{t("skirmish.label")}</p>
              <h2 data-testid="skirmish-name">{SKIRMISH_NAME}</h2>
              <p className="muted" data-testid="skirmish-objective">
                {t("contract.battle.objectiveLabel")}:{" "}
                {objectiveLabel(controller.battle.objective?.objective, t)}
              </p>
              <div className="campaign-action__buttons">
                <button
                  type="button"
                  className="button button--ghost"
                  data-testid="skirmish-resolve"
                  onClick={resolveSkirmish}
                >
                  {t("contract.battle.resolve")}
                </button>
              </div>
            </section>
          )}

        {fieldMode === "skirmish" && controller.battle.phase === "finished" && (
          <section
            className="campaign-result"
            data-testid="skirmish-result"
            role="dialog"
            aria-label={t("skirmish.resultLabel")}
          >
            <p className="kicker">{t("skirmish.resultLabel")}</p>
            <h2 data-testid="skirmish-result-name">{SKIRMISH_NAME}</h2>
            <p
              className={
                controller.battle.outcome === "companyVictory"
                  ? "campaign-result__outcome is-victory"
                  : "campaign-result__outcome is-defeat"
              }
              data-testid="skirmish-result-outcome"
            >
              {outcomeLabel(controller.battle.outcome ?? "draw", t)}
            </p>
            <button
              type="button"
              className="button"
              data-testid="skirmish-result-restart"
              onClick={startSkirmish}
            >
              {t("skirmish.restart")}
            </button>
          </section>
        )}

        {view === "menus" && <Menus onClose={() => setView("battle")} />}
        {view === "posts" && <PostScreen />}
        {view === "mess" && <Mess company={campaign.save.company} onAccept={acceptContract} />}
        {view === "map" && <CampaignMap />}
        {view === "depot" && <Depot />}
        {view === "saves" && <Saves />}
        {view === "settings" && <Settings />}
        {view === "lobby" && <LobbyScreen />}
      </main>
    </div>
  );
}
