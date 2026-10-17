import { useEffect, useRef } from "react";

import { createScene } from "../render/scene";

/**
 * Application shell: a full-bleed battlefield canvas with a DOM HUD overlaid.
 * The canvas is a placeholder until the deterministic engine (Phase 1) and the
 * PixiJS renderer (Phase 2) land.
 */
export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const scene = createScene(canvas);
    return () => scene.dispose();
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <p className="kicker">A Napoleonic small-squad tactics RPG</p>
          <h1>Lines of Glory</h1>
        </div>
        <span className="badge">Prototype · Phase 0</span>
      </header>

      <main className="stage">
        <canvas ref={canvasRef} className="battlefield" data-testid="battle-canvas" />

        <aside className="hud">
          <h2>Field Orders</h2>
          <p className="muted">
            Placeholder HUD shell. The deterministic engine plugs in here during Phase 1–2.
          </p>
          <dl>
            <div>
              <dt>Company</dt>
              <dd>— unassigned —</dd>
            </div>
            <div>
              <dt>Theatre</dt>
              <dd>Peninsula, 1808</dd>
            </div>
            <div>
              <dt>Orders Tempo</dt>
              <dd>idle</dd>
            </div>
          </dl>
        </aside>
      </main>
    </div>
  );
}
