/**
 * Tooltip / InfoTip — small, accessible "what does this do?" bubbles.
 *
 * The Field is dense with numbers a new player has no way to read: move range,
 * danger zone, Élan cost, charge time. The content already exists as data (the
 * `AbilityDef` descriptions, the engine's stat blocks, the i18n catalog); this
 * module is the thin presentation layer that reveals it on hover or keyboard
 * focus, so nothing needs a manual.
 *
 * ```tsx
 * <Tooltip side="left" label={<AbilityInfo abilityId={id} spec={spec} />}>
 *   <button …>{name}</button>
 * </Tooltip>
 *
 * <dt>{t("hud.phase")} <InfoTip title={t("tip.moreInfo")} label={t("hud.help.phase")} /></dt>
 * ```
 *
 * ## Why a portal
 *
 * The HUD scrolls (`overflow-y: auto`), which clips any bubble drawn beside it.
 * So the bubble is rendered into `document.body` and positioned with `fixed`
 * coordinates measured from the trigger — it can never be cut off by an
 * ancestor's overflow. The trigger keeps `aria-describedby` pointing at the
 * portalled bubble, so assistive tech reads the same text a sighted player sees.
 *
 * ## Contract (`agents.md` §2, §7, §9)
 *
 * - **Presentation only.** No rules; it reads only the `label`/`children` handed
 *   in and the trigger's own geometry.
 * - **Deterministic.** No clock, no randomness. Visibility is a single boolean.
 */

import {
  cloneElement,
  isValidElement,
  useCallback,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

/** Which way a bubble opens from its trigger. */
export type TooltipSide = "top" | "bottom" | "left" | "right";

/** A resolved fixed-position placement for a bubble. */
interface Placement {
  readonly top: number;
  readonly left: number;
  readonly transform: string;
}

/** Pixels between the trigger and its bubble. */
const GAP = 8;

/** Measure where a `side` bubble should sit for a trigger bounding box. */
function place(rect: DOMRect, side: TooltipSide): Placement {
  switch (side) {
    case "left":
      return {
        top: rect.top + rect.height / 2,
        left: rect.left - GAP,
        transform: "translate(-100%, -50%)",
      };
    case "right":
      return {
        top: rect.top + rect.height / 2,
        left: rect.right + GAP,
        transform: "translate(0, -50%)",
      };
    case "bottom":
      return {
        top: rect.bottom + GAP,
        left: rect.left + rect.width / 2,
        transform: "translate(-50%, 0)",
      };
    case "top":
    default:
      return {
        top: rect.top - GAP,
        left: rect.left + rect.width / 2,
        transform: "translate(-50%, -100%)",
      };
  }
}

/** Shared open/close + placement state for a trigger element. */
function useTooltipAnchor(side: TooltipSide) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);

  const show = useCallback((): void => {
    const el = anchorRef.current;
    if (el === null) return;
    setPlacement(place(el.getBoundingClientRect(), side));
  }, [side]);
  const hide = useCallback((): void => setPlacement(null), []);

  const handlers = {
    onPointerEnter: show,
    onPointerLeave: hide,
    onFocus: () => show(),
    onBlur: () => hide(),
  } satisfies {
    onPointerEnter: (event: PointerEvent) => void;
    onPointerLeave: (event: PointerEvent) => void;
    onFocus: (event: FocusEvent) => void;
    onBlur: (event: FocusEvent) => void;
  };

  return { anchorRef, placement, handlers };
}

/** The portalled bubble, or `null` while closed. */
function Bubble({
  id,
  label,
  placement,
  testId,
}: {
  readonly id: string;
  readonly label: ReactNode;
  readonly placement: Placement;
  readonly testId?: string;
}) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <span className="tip__bubble" role="tooltip" id={id} data-testid={testId} style={placement}>
      {label}
    </span>,
    document.body,
  );
}

/** Props for {@link Tooltip}. */
export interface TooltipProps {
  /** Bubble content (plain text or a rich `tip__content` block). */
  readonly label: ReactNode;
  /** Preferred opening direction. Defaults to `"top"`. */
  readonly side?: TooltipSide;
  /** Optional `data-testid` for the bubble (tests only). */
  readonly bubbleTestId?: string;
  /** The single trigger element the bubble describes. */
  readonly children: ReactNode;
}

/**
 * Wrap a trigger with a hover/focus tooltip. The trigger receives
 * `aria-describedby` pointing at the bubble, so the description is available to
 * assistive tech as well as on hover.
 */
export function Tooltip({ label, side = "top", bubbleTestId, children }: TooltipProps) {
  const id = useId();
  const { anchorRef, placement, handlers } = useTooltipAnchor(side);
  const described = isValidElement(children)
    ? cloneElement(children as ReactElement<{ "aria-describedby"?: string }>, {
        "aria-describedby": id,
      })
    : children;

  return (
    <>
      <span className="tip" ref={anchorRef} {...handlers}>
        {described}
      </span>
      {placement !== null && (
        <Bubble id={id} label={label} placement={placement} testId={bubbleTestId} />
      )}
    </>
  );
}

/** Props for {@link InfoTip}. */
export interface InfoTipProps {
  /** Bubble content. */
  readonly label: ReactNode;
  /** Accessible name for the `?` trigger (e.g. "More information"). */
  readonly title: string;
  /** Preferred opening direction. Defaults to `"top"`. */
  readonly side?: TooltipSide;
  /** Optional `data-testid`; the bubble gets `-bubble` appended. */
  readonly testId?: string;
}

/**
 * A small, focusable `?` marker beside a label, revealing `label` on hover or
 * focus. Use it for a term whose meaning is not obvious from the term alone.
 */
export function InfoTip({ label, title, side = "top", testId }: InfoTipProps) {
  const id = useId();
  const { anchorRef, placement, handlers } = useTooltipAnchor(side);

  return (
    <>
      <span className="tip tip--info" ref={anchorRef} {...handlers}>
        <button
          type="button"
          className="tip__trigger"
          aria-label={title}
          aria-describedby={id}
          data-testid={testId}
        >
          ?
        </button>
      </span>
      {placement !== null && (
        <Bubble
          id={id}
          label={label}
          placement={placement}
          testId={testId === undefined ? undefined : `${testId}-bubble`}
        />
      )}
    </>
  );
}
