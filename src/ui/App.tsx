import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  chooseAction,
  createBattleController,
  setCursor,
  type BattleController,
} from "../app/battleController";
import { createDemoBattle } from "../app/demoScenario";
import { createInputController, type InputController } from "../app/input";
import {
  aoePreviewFor,
  areaHitsFor,
  dangerZoneFor,
  elevationDeltaFor,
} from "../app/targetingPreview";
import { actionSpecOf } from "../engine/actions/resolve";
import { CampaignMap } from "./CampaignMap";
import { Depot } from "./Depot";
import { Forecast } from "./Forecast";
import { targetForCursor } from "./battleForecast";
import { Menus } from "./Menus";
import { Mess } from "./Mess";
import { PostScreen } from "./PostScreen";
import { Saves } from "./Saves";
import { Settings } from "./Settings";
import { TempoTray } from "./TempoTray";
import { animationsForEvents, type BattleAnimation } from "../render/animations";
import { createScene, type Scene } from "../render/scene";

/** A controller for the demo action, with the cursor on the acting soldier. */
function initialController(): BattleController {
  const controller = createBattleController(createDemoBattle());
  const actor = controller.battle.units.find(
    (unit) => unit.id === controller.battle.currentActorId,
  );
  return actor !== undefined ? setCursor(controller, actor.at) : controller;
}

/** Human-readable elevation delta for the HUD: `level`, `+2` or `-1`. */
function formatElevation(preview: { readonly delta: number } | null): string {
  if (preview === null) return "—";
  if (preview.delta === 0) return "level";
  return preview.delta > 0 ? `+${preview.delta}` : `${preview.delta}`;
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const [controller, setController] = useState<BattleController>(initialController);
  const [animations, setAnimations] = useState<readonly BattleAnimation[]>([]);
  const [inputReady, setInputReady] = useState(false);
  const [view, setView] = useState<
    "battle" | "menus" | "posts" | "mess" | "map" | "depot" | "saves" | "settings"
  >("battle");
  const controllerRef = useRef(controller);
  const viewRef = useRef(view);
  viewRef.current = view;

  const applyController = useCallback((next: BattleController) => {
    // Update the ref synchronously so fast key sequences never read a stale
    // controller before React has re-rendered.
    controllerRef.current = next;
    setController(next);
  }, []);

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

  // Scene + input lifecycle. The input binding waits for Pixi to be ready so
  // the first click unprojects through a correctly framed camera.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    let disposed = false;
    let input: InputController | null = null;
    const scene = createScene(canvas, controllerRef.current.battle.map);
    sceneRef.current = scene;

    void scene.ready.then(() => {
      if (disposed) return;
      input = createInputController({
        canvas,
        getCamera: () => scene.camera,
        getController: () => controllerRef.current,
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
  }, [applyController, returnToField, toggleCamp]);

  // Sync the scene (units), overlay and animations to the controller after
  // every transition. Animation cues are derived **only** from the engine
  // events the last order emitted (`lastEvents`), never from a state diff.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const map = controller.battle.map;
    const units = controller.battle.units;
    const unitById = new Map(units.map((unit) => [unit.id, unit] as const));
    scene.setUnits(units);
    scene.overlay.setDangerZone(targeting.danger, map);
    scene.overlay.setMoveRange(
      controller.moveRange.map((tile) => tile.at),
      map,
    );
    scene.overlay.setTargetRange(controller.phase === "target" ? controller.targetTiles : [], map);
    scene.overlay.setArea({ tiles: targeting.areaTiles, hits: targeting.areaHits }, map);
    scene.overlay.setElevationPreview(targeting.elevation, map);
    scene.overlay.setPath(controller.pendingPath ?? [], map);
    scene.overlay.setCursor(controller.cursor, map);

    const cues = animationsForEvents(controller.lastEvents, {
      unitAt: (unitId) => unitById.get(unitId)?.at,
      unitName: (unitId) => unitById.get(unitId)?.name,
    });
    scene.playAnimations(cues);
    setAnimations(cues);
  }, [controller, targeting]);

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

  const cursorLabel =
    controller.cursor === null ? "—" : `${controller.cursor.x}, ${controller.cursor.y}`;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <p className="kicker">A Napoleonic small-squad tactics RPG</p>
          <h1>Lines of Glory</h1>
        </div>
        <span className="badge">Prototype · Phase 4</span>
      </header>

      <nav className="viewnav" aria-label="Screens">
        <button
          type="button"
          className={view === "battle" ? "viewnav__button is-active" : "viewnav__button"}
          data-testid="nav-battle"
          aria-pressed={view === "battle"}
          onClick={() => setView("battle")}
        >
          Field
        </button>
        <button
          type="button"
          className={view === "menus" ? "viewnav__button is-active" : "viewnav__button"}
          data-testid="nav-menu"
          aria-pressed={view === "menus"}
          onClick={() => setView("menus")}
        >
          Camp Orders
        </button>
        <button
          type="button"
          className={view === "posts" ? "viewnav__button is-active" : "viewnav__button"}
          data-testid="nav-posts"
          aria-pressed={view === "posts"}
          onClick={() => setView("posts")}
        >
          Barracks
        </button>
        <button
          type="button"
          className={view === "mess" ? "viewnav__button is-active" : "viewnav__button"}
          data-testid="nav-mess"
          aria-pressed={view === "mess"}
          onClick={() => setView("mess")}
        >
          Officers' Mess
        </button>
        <button
          type="button"
          className={view === "map" ? "viewnav__button is-active" : "viewnav__button"}
          data-testid="nav-map"
          aria-pressed={view === "map"}
          onClick={() => setView("map")}
        >
          Campaign Map
        </button>
        <button
          type="button"
          className={view === "depot" ? "viewnav__button is-active" : "viewnav__button"}
          data-testid="nav-depot"
          aria-pressed={view === "depot"}
          onClick={() => setView("depot")}
        >
          Quartermaster
        </button>
        <button
          type="button"
          className={view === "saves" ? "viewnav__button is-active" : "viewnav__button"}
          data-testid="nav-saves"
          aria-pressed={view === "saves"}
          onClick={() => setView("saves")}
        >
          Saves
        </button>
        <button
          type="button"
          className={view === "settings" ? "viewnav__button is-active" : "viewnav__button"}
          data-testid="nav-settings"
          aria-pressed={view === "settings"}
          onClick={() => setView("settings")}
        >
          Settings
        </button>
      </nav>

      <main className="stage">
        <canvas
          ref={canvasRef}
          className="battlefield"
          data-testid="battle-canvas"
          data-input-ready={inputReady}
        />

        <aside className="hud" hidden={view !== "battle"}>
          <h2>Field Orders</h2>
          <p className="muted" data-testid="hud-controls">
            Arrows / WASD / D-pad move the cursor · Enter / A confirms · O opens Orders · Esc / B
            backs out · M / Start opens the camp · drag to pan, wheel to zoom.
          </p>
          <dl>
            <div>
              <dt>Orders Tempo</dt>
              <dd data-testid="hud-actor">{actor?.name ?? "—"}</dd>
            </div>
            <div>
              <dt>Phase</dt>
              <dd data-testid="hud-phase">{controller.phase}</dd>
            </div>
            <div>
              <dt>Cursor</dt>
              <dd data-testid="hud-cursor">{cursorLabel}</dd>
            </div>
            <div>
              <dt>Selected</dt>
              <dd data-testid="hud-selected">{selected?.name ?? "—"}</dd>
            </div>
            <div>
              <dt>Move range</dt>
              <dd data-testid="hud-move-range">{controller.moveRange.length} tiles</dd>
            </div>
            <div>
              <dt>Planned march</dt>
              <dd data-testid="hud-path">
                {controller.pendingPath === null ? "—" : `${controller.pendingPath.length} tiles`}
              </dd>
            </div>
            <div>
              <dt>Target reach</dt>
              <dd data-testid="hud-target-range">{controller.targetTiles.length} tiles</dd>
            </div>
            <div>
              <dt>Area</dt>
              <dd data-testid="hud-target-area">{targeting.areaTiles.length} tiles</dd>
            </div>
            <div>
              <dt>Danger zone</dt>
              <dd data-testid="hud-danger-zone">{targeting.danger.length} tiles</dd>
            </div>
            <div>
              <dt>Elevation</dt>
              <dd data-testid="hud-elevation">{formatElevation(targeting.elevation)}</dd>
            </div>
          </dl>
          {controller.lastRejection !== null && (
            <p className="rejection" data-testid="hud-rejection">
              {controller.lastRejection.message}
            </p>
          )}
          {forecast !== null && (
            <Forecast
              battle={controller.battle}
              actorId={forecast.actorId}
              spec={forecast.spec}
              target={forecast.target}
            />
          )}
          {controller.canAct &&
            (controller.phase === "command" || controller.phase === "move") &&
            controller.actions.length > 0 && (
              <section className="action-menu" data-testid="action-menu" aria-label="Orders">
                <h3>Orders</h3>
                <ul>
                  {controller.actions.map((option) => (
                    <li key={option.id}>
                      <button
                        type="button"
                        className="action-menu__button"
                        data-testid={`action-${option.id}`}
                        data-affordable={option.affordable}
                        disabled={!option.affordable}
                        onClick={() =>
                          applyController(chooseAction(controllerRef.current, option.id))
                        }
                      >
                        <span className="action-menu__name">{option.id}</span>
                        <span className="action-menu__cost">Élan {option.spec.mpCost}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          <section className="animation-log" aria-label="Battle animations">
            <h3>Battle log</h3>
            <ol data-testid="animation-log">
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
          </section>
        </aside>

        {view === "battle" && (
          <TempoTray
            battle={controller.battle}
            onSelect={(unitId) => {
              const unit = controllerRef.current.battle.units.find((u) => u.id === unitId);
              if (unit !== undefined) {
                applyController(setCursor(controllerRef.current, unit.at));
              }
            }}
          />
        )}

        {view === "menus" && <Menus onClose={() => setView("battle")} />}
        {view === "posts" && <PostScreen />}
        {view === "mess" && <Mess />}
        {view === "map" && <CampaignMap />}
        {view === "depot" && <Depot />}
        {view === "saves" && <Saves />}
        {view === "settings" && <Settings />}
      </main>
    </div>
  );
}
