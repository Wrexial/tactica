/**
 * Unit card (T134) — the per-character battlefield HUD, anchored to its soldier.
 *
 * Modelled on FFT Blue's `BattleScene.showUnitInfo` (peer lesson L16): a card
 * is drawn *beside* the soldier the player is inspecting — the selected soldier,
 * or one the cursor is hovering — edge-flipped and clamped, rather than parked
 * in a fixed side column. The card is **on demand**: it is not drawn for the
 * acting soldier merely because the Orders Tempo turn is theirs, and it is
 * dismissed while an order is being aimed, so it never covers the field at rest
 * or hides the tiles a player is trying to target.
 *
 * ## Placement
 *
 * The card does not know where the battlefield is. It asks the live
 * {@link Scene} to project the soldier's tile (`Scene.project`, T133) and the
 * pure {@link anchorFor} helper to turn that screen point into a clamped,
 * edge-flipped `{ left, top, side }`. Because the camera pans and zooms — and
 * soldiers march — the anchor is refreshed on `requestAnimationFrame` while the
 * card is mounted, writing directly to the element's style so a pan does not
 * cost a React render per frame.
 *
 * ## Contract (`agents.md` §2, §7, §9)
 *
 * - **Presentation only.** It reads an engine {@link Unit} and never mutates
 *   state; the anchor maths is pure and lives in `./unitHud.ts`.
 * - **Layer-clean.** It touches `render/scene` only through the read-only
 *   `Scene` interface that `project` exposes; no Pixi type leaks in.
 */

import { useLayoutEffect, useRef, type RefObject } from "react";

import type { Unit } from "../engine/unit";
import { useTranslation } from "../i18n";
import type { Scene } from "../render/scene";
import { StatChips } from "./StatChips";
import { anchorFor } from "./unitHud";
import {
  POWER_LABEL_KEYS,
  SIDE_LABEL_KEYS,
  unitConditionNames,
  unitRoleLabelKey,
} from "./unitLabels";

/** Which of the focus cases a card is showing (for styling/tests). */
export type UnitCardRole = "hovered" | "selected" | "actor";

/** Props for {@link UnitCard}. */
export interface UnitCardProps {
  /** The soldier the card describes (hovered, selected or acting). */
  readonly unit: Unit;
  /** Why this soldier is in focus; carried onto the card as `data-role`. */
  readonly role: UnitCardRole;
  /** The live scene, for `project`; reading `.current` keeps the anchor fresh. */
  readonly sceneRef: RefObject<Scene | null>;
  /** The battlefield canvas, for its viewport size. */
  readonly canvasRef: RefObject<HTMLCanvasElement | null>;
  /** Re-runs the anchor effect once Pixi has finished initialising. */
  readonly ready: boolean;
}

/**
 * Keep `cardRef` glued beside `unit` as the camera moves. Runs a frame loop
 * (never a React render) and writes `left`/`top`/`data-side` directly; the
 * values come from the pure `anchorFor` so the flip/clamp rules are testable in
 * Node (`tests/unit/unitHud.test.ts`).
 */
function useAnchoredCard(
  cardRef: RefObject<HTMLElement | null>,
  sceneRef: RefObject<Scene | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  unit: Unit,
  ready: boolean,
): void {
  useLayoutEffect(() => {
    if (!ready) return undefined;
    const canvas = canvasRef.current;
    const card = cardRef.current;
    if (canvas === null || card === null) return undefined;

    let frame = 0;
    let last = "";
    const place = (): void => {
      frame = requestAnimationFrame(place);
      const scene = sceneRef.current;
      if (scene === null) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const anchor = anchorFor(
        scene.project(unit.at),
        { width: rect.width, height: rect.height },
        { width: card.offsetWidth, height: card.offsetHeight },
      );
      const key = `${anchor.left}|${anchor.top}|${anchor.side}`;
      if (key === last) return;
      last = key;
      card.style.left = `${anchor.left}px`;
      card.style.top = `${anchor.top}px`;
      card.dataset.side = anchor.side;
    };

    place();
    return () => cancelAnimationFrame(frame);
  }, [cardRef, sceneRef, canvasRef, unit, ready]);
}

/**
 * The anchored soldier card. The root carries `unit-card` and the vitals strip
 * carries `hud-chips`, both part of the battlefield HUD's test contract.
 */
export function UnitCard({ unit, role, sceneRef, canvasRef, ready }: UnitCardProps) {
  const { t } = useTranslation();
  const cardRef = useRef<HTMLElement>(null);
  useAnchoredCard(cardRef, sceneRef, canvasRef, unit, ready);

  const conditions = unitConditionNames(unit);

  return (
    <section
      ref={cardRef}
      className="unit-card"
      data-testid="unit-card"
      data-role={role}
      data-unit-side={unit.side}
      aria-label={t("unit.cardLabel", { name: unit.name })}
    >
      <header className="unit-card__head">
        <strong className="unit-card__name">{unit.name}</strong>
        <span className={`unit-card__side unit-card__side--${unit.side}`}>
          {t(SIDE_LABEL_KEYS[unit.side])}
        </span>
      </header>
      <p className="unit-card__meta">
        {t(POWER_LABEL_KEYS[unit.power])} · {t(unitRoleLabelKey(unit.postId))}
      </p>
      <StatChips unit={unit} />
      {conditions.length > 0 && (
        <p className="unit-card__conditions">
          <span className="unit-card__conditions-label">{t("unit.conditions")}:</span>{" "}
          {conditions.join(", ")}
        </p>
      )}
    </section>
  );
}
