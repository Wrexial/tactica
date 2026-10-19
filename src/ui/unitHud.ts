/**
 * Pure anchoring maths for the per-character battlefield HUD (T133).
 *
 * Mirrors FFT Blue's `BattleScene.showUnitInfo` placement (see
 * `docs/PEER_COMBAT_LESSONS.md` L16): the card sits to the right of a soldier's
 * projected screen position, flipping to the left when it would cross the
 * viewport's right margin, with every edge clamped so the card stays on screen.
 *
 * This module is deliberately **DOM-free and framework-free** (no React, no
 * Pixi, no canvas): it takes plain numbers in and returns plain numbers out, so
 * the placement is deterministic, unit-testable in Node, and reproducible frame
 * to frame as the camera pans/zooms and units move.
 */

/** A point in canvas/screen pixels. */
export interface ScreenPos {
  readonly x: number;
  readonly y: number;
}

/** The viewport (canvas) size in pixels. */
export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

/** The anchored card's size in pixels. */
export interface HudSize {
  readonly width: number;
  readonly height: number;
}

/** Which side of the soldier the card was placed on. */
export type HudSide = "left" | "right";

/** The card's top-left position and the side it was placed on. */
export interface HudAnchor {
  readonly left: number;
  readonly top: number;
  readonly side: HudSide;
}

/** Horizontal gap between the soldier and the card (FFT Blue uses 20). */
export const HUD_GAP = 20;
/** Minimum distance the card keeps from a viewport edge (FFT Blue uses 10). */
export const HUD_MARGIN = 10;

/** Clamp `value` into `[min, max]`, preferring `min` if the range is empty. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Anchor a card of `size` beside the soldier at `screen` inside `viewport`.
 *
 * - **Horizontal**: prefer the soldier's right (`screen.x + HUD_GAP`); flip to
 *   the left when the card would cross the right margin, matching FFT Blue's
 *   `ix + w > width - 10 ? pos.x - w - 20 : pos.x + 20`.
 * - **Vertical**: centre the card on the soldier, then clamp.
 * - **Clamp**: both axes stay within
 *   `[HUD_MARGIN, viewport - size - HUD_MARGIN]`; when the viewport is smaller
 *   than the card the margin wins, so the card stays just inside the top/left
 *   edge rather than going negative.
 *
 * Pure and deterministic: identical inputs always yield the identical
 * `{ left, top, side }`.
 */
export function anchorFor(screen: ScreenPos, viewport: ViewportSize, size: HudSize): HudAnchor {
  const fitsRight = screen.x + HUD_GAP + size.width <= viewport.width - HUD_MARGIN;
  const side: HudSide = fitsRight ? "right" : "left";
  const rawLeft = fitsRight ? screen.x + HUD_GAP : screen.x - HUD_GAP - size.width;
  const rawTop = screen.y - size.height / 2;
  const maxLeft = Math.max(HUD_MARGIN, viewport.width - size.width - HUD_MARGIN);
  const maxTop = Math.max(HUD_MARGIN, viewport.height - size.height - HUD_MARGIN);
  return {
    left: clamp(rawLeft, HUD_MARGIN, maxLeft),
    top: clamp(rawTop, HUD_MARGIN, maxTop),
    side,
  };
}
