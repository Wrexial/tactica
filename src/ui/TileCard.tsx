/**
 * Tile card (T145) — the anchored terrain inspector for the battlefield HUD.
 *
 * The player needs to read the ground before committing a march: what the
 * surface is called, how high it sits, how far it is above or below the soldier
 * in focus, what it costs to enter, whether it can be entered at all, and
 * whether it blocks sight or counts as water. This component is the DOM face of
 * the pure {@link tileInfoFor} projection.
 *
 * ## Placement
 *
 * The card follows the cursor. It asks the live {@link Scene} to project the
 * inspected tile (`Scene.project`, T133) and the pure {@link anchorFor} helper
 * to turn that screen point into a clamped, edge-flipped `{ left, top, side }`,
 * refreshed on `requestAnimationFrame` so pan/zoom does not cost a React render
 * per frame. The card is `pointer-events: none`, so it never steals a click
 * from the field.
 *
 * ## Contract (`agents.md` §2, §7, §9)
 *
 * - **Presentation only.** Reads a {@link TileInfo} value; never mutates engine
 *   state and never advances the battle.
 * - **Deterministic.** The same tile and camera always paint the same card.
 * - **Keyed copy.** Every player-visible string goes through `t()` (T111/T116).
 */

import { useLayoutEffect, useRef, type RefObject } from "react";

import type { Scene } from "../render/scene";
import { useTranslation, type MessageKey } from "../i18n";
import type { TerrainCategory } from "../engine/terrain";
import { anchorFor } from "./unitHud";
import { elevationDeltaText, type TileInfo } from "./tileInfo";

/** Catalog keys for the coarse terrain categories. */
const CATEGORY_KEYS: Readonly<Record<TerrainCategory, MessageKey>> = {
  open: "tile.category.open",
  rough: "tile.category.rough",
  built: "tile.category.built",
  water: "tile.category.water",
  fortification: "tile.category.fortification",
};

/** Props for {@link TileCard}. */
export interface TileCardProps {
  /** The tile to describe. */
  readonly info: TileInfo;
  /** The live scene, for `project`; reading `.current` keeps the anchor fresh. */
  readonly sceneRef: RefObject<Scene | null>;
  /** The battlefield canvas, for its viewport size. */
  readonly canvasRef: RefObject<HTMLCanvasElement | null>;
  /** Re-runs the anchor effect once Pixi has finished initialising. */
  readonly ready: boolean;
}

/** Keep the tile card glued beside the cursor as the camera moves. */
function useAnchoredTile(
  cardRef: RefObject<HTMLElement | null>,
  sceneRef: RefObject<Scene | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  info: TileInfo,
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
        scene.project(info.at),
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
  }, [cardRef, sceneRef, canvasRef, info, ready]);
}

/** The anchored terrain card. */
export function TileCard({ info, sceneRef, canvasRef, ready }: TileCardProps) {
  const { t } = useTranslation();
  const cardRef = useRef<HTMLElement>(null);
  useAnchoredTile(cardRef, sceneRef, canvasRef, info, ready);

  const delta = elevationDeltaText(info, t);

  return (
    <section
      ref={cardRef}
      className="tile-card"
      data-testid="tile-card"
      data-terrain={info.terrain}
      data-category={info.category}
      data-height={info.height}
      data-elevation-delta={info.elevationDelta ?? ""}
      data-passable={info.passable}
      data-blocks-sight={info.blocksSight}
      data-water={info.water}
      data-occupied={info.occupant !== null}
      aria-label={t("tile.label", {
        terrain: info.name,
        x: info.at.x,
        y: info.at.y,
      })}
    >
      <header className="tile-card__head">
        <strong className="tile-card__name" data-testid="tile-name">
          {info.name}
        </strong>
        <span className="tile-card__category">{t(CATEGORY_KEYS[info.category])}</span>
      </header>

      <p className="tile-card__description">{info.description}</p>

      <dl className="tile-card__stats">
        <div>
          <dt>{t("tile.height")}</dt>
          <dd data-testid="tile-height">{info.height}</dd>
        </div>
        <div>
          <dt>{t("tile.delta")}</dt>
          <dd data-testid="tile-delta">{delta}</dd>
        </div>
        <div>
          <dt>{t("tile.moveCost")}</dt>
          <dd data-testid="tile-move-cost">
            {info.passable ? info.moveCost : t("tile.impassable")}
          </dd>
        </div>
      </dl>

      <p className="tile-card__flags">
        <span
          className={info.passable ? "tile-flag" : "tile-flag is-warning"}
          data-testid="tile-passable"
          data-flag={info.passable}
        >
          {info.passable ? t("tile.passable") : t("tile.blocked")}
        </span>
        <span
          className={info.blocksSight ? "tile-flag is-warning" : "tile-flag"}
          data-testid="tile-sight"
          data-flag={info.blocksSight}
        >
          {info.blocksSight ? t("tile.sightBlocked") : t("tile.sightClear")}
        </span>
        <span
          className={info.water ? "tile-flag is-warning" : "tile-flag"}
          data-testid="tile-water"
          data-flag={info.water}
        >
          {info.water ? t("tile.water") : t("tile.dry")}
        </span>
      </p>

      {info.occupant !== null && (
        <p className="tile-card__occupant" data-testid="tile-occupant">
          {t("tile.occupiedBy", { name: info.occupant.name })}
        </p>
      )}
    </section>
  );
}
