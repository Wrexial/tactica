/**
 * ErrorBoundary (T104) — the last line of the company: a React error boundary
 * that turns an unexpected render/commit failure into a calm, in-fiction
 * fallback instead of a blank canvas.
 *
 * A deterministic simulation (`agents.md` §2) has no business crashing the
 * page, but the *presentation* around it — a malformed map, a stale save shape,
 * a renderer that tripped over an unknown event — can still throw. React
 * unwinds the tree when that happens; this boundary catches the unwind, records
 * the fault, and offers the two sane recoveries:
 *
 * - **Re-form the line** — clear the error and re-render the children, which is
 *   worth trying after a transient fault (a bad command, a resize race).
 * - **Reload the campaign** — a hard reload, the reliable escape hatch when the
 *   in-memory state itself is the problem.
 *
 * ```
 *   <ErrorBoundary onError={report}>
 *     <App />
 *   </ErrorBoundary>
 * ```
 *
 * ## Contract (`agents.md` §3, §7, §9)
 *
 * - **Presentation only.** The boundary logs and displays; it never touches
 *   engine state or persisted bytes. Recovering persistence faults is the job
 *   of `src/persist` (T100–T104).
 * - **Original, grounded fiction.** The fallback copy speaks of lines, dispatch
 *   and the camp — no literal magic (mapping §14 D9).
 * - **Composable.** `onError` receives the error and React's component stack so
 *   a shell can forward it to a crash reporter, and `fallback` lets a host
 *   render its own surface (used by the tests).
 */

import { Component, type ErrorInfo, type ReactElement, type ReactNode } from "react";

/* --------------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------------ */

/** Props for {@link ErrorBoundary}. */
export interface ErrorBoundaryProps {
  /** The tree to protect. */
  readonly children?: ReactNode;
  /** Called after a fault with the error and React's component stack. */
  readonly onError?: (error: Error, info: ErrorInfo) => void;
  /**
   * Render a custom fallback instead of the issue one. Receives the captured
   * error and a `reset` callback that clears it and re-renders the children.
   */
  readonly fallback?: (error: Error, reset: () => void) => ReactNode;
}

/** State for {@link ErrorBoundary}. */
export interface ErrorBoundaryState {
  /** The most recent captured error, or `null` while the tree is healthy. */
  readonly error: Error | null;
}

/* --------------------------------------------------------------------------
 * Fallback
 * ------------------------------------------------------------------------ */

/** Human-readable detail for whatever was thrown. */
function messageOf(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return String(error);
}

/**
 * The default fallback: an in-fiction "orders lost" card with the two recovery
 * actions. Kept internal so this module exports only the component (the
 * `react-refresh` rule).
 */
function DefaultFallback({
  error,
  onReset,
}: {
  readonly error: Error;
  readonly onReset: () => void;
}): ReactElement {
  const reload = (): void => {
    if (typeof window !== "undefined") window.location.reload();
  };

  return (
    <div className="error-boundary" role="alert" data-testid="error-boundary">
      <div className="error-boundary__card">
        <p className="error-boundary__eyebrow">Dispatch lost</p>
        <h1 className="error-boundary__title">The line has broken</h1>
        <p className="error-boundary__body">
          Something in the field went wrong and the orders could not be carried. The company is safe
          — nothing has been written to your campaign.
        </p>
        <pre className="error-boundary__detail" data-testid="error-boundary-detail">
          {messageOf(error)}
        </pre>
        <div className="error-boundary__actions">
          <button
            type="button"
            className="error-boundary__button error-boundary__button--primary"
            onClick={onReset}
          >
            Re-form the line
          </button>
          <button type="button" className="error-boundary__button" onClick={reload}>
            Reload the campaign
          </button>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------
 * Boundary
 * ------------------------------------------------------------------------ */

/**
 * A React error boundary for the whole app (or any subtree that can fail
 * independently, such as the camp menus). Wrap the shell once in `main.tsx`;
 * `getDerivedStateFromError` and the props are public so the recovery logic is
 * unit-testable without a DOM.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  /** Start healthy; a fault is recorded through `getDerivedStateFromError`. */
  state: ErrorBoundaryState = { error: null };

  /** Capture the fault as state so React re-renders into the fallback. */
  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  /** Report the fault to the host and, by default, the console. */
  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (this.props.onError !== undefined) {
      this.props.onError(error, info);
      return;
    }
    console.error("Lines of Glory: unhandled UI error", error, info.componentStack);
  }

  /** Clear the captured error and re-render the children. */
  private readonly reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children ?? null;
    if (this.props.fallback !== undefined) return this.props.fallback(error, this.reset);
    return <DefaultFallback error={error} onReset={this.reset} />;
  }
}
