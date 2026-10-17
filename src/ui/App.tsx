import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createBattleController, setCursor, type BattleController } from "../app/battleController";
import { createDemoBattle } from "../app/demoScenario";
import { createInputController, type InputController } from "../app/input";
import { CampaignMap } from "./CampaignMap";
import { Mess } from "./Mess";
import { PostScreen } from "./PostScreen";
import { createScene, type Scene } from "../render/scene";

/** A controller for the demo action, with the cursor on the acting soldier. */
function initialController(): BattleController {
  const controller = createBattleController(createDemoBattle());
  const actor = controller.battle.units.find(
    (unit) => unit.id === controller.battle.currentActorId,
  );
  return actor !== undefined ? setCursor(controller, actor.at) : controller;
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
  const [view, setView] = useState<"battle" | "posts" | "mess" | "map">("battle");
  const controllerRef = useRef(controller);

  const applyController = useCallback((next: BattleController) => {
    // Update the ref synchronously so fast key sequences never read a stale
    // controller before React has re-rendered.
    controllerRef.current = next;
    setController(next);
  }, []);

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
      });
    });

    return () => {
      disposed = true;
      input?.dispose();
      scene.dispose();
      sceneRef.current = null;
    };
  }, [applyController]);

  // Sync the overlay to the controller after every transition.
  useEffect(() => {
    const overlay = sceneRef.current?.overlay;
    if (!overlay) return;
    const map = controller.battle.map;
    overlay.setMoveRange(
      controller.moveRange.map((tile) => tile.at),
      map,
    );
    overlay.setPath(controller.pendingPath ?? [], map);
    overlay.setCursor(controller.cursor, map);
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
      </nav>

      <main className="stage">
        <canvas ref={canvasRef} className="battlefield" data-testid="battle-canvas" />

        <aside className="hud" hidden={view !== "battle"}>
          <h2>Field Orders</h2>
          <p className="muted">
            Arrows / WASD move the cursor · Enter confirms · Esc backs out · drag to pan, wheel to
            zoom.
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
          </dl>
          {controller.lastRejection !== null && (
            <p className="rejection" data-testid="hud-rejection">
              {controller.lastRejection.message}
            </p>
          )}
        </aside>

        {view === "posts" && <PostScreen />}
        {view === "mess" && <Mess />}
        {view === "map" && <CampaignMap />}
      </main>
    </div>
  );
}
