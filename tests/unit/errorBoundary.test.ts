import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  ErrorBoundary,
  type ErrorBoundaryProps,
  type ErrorBoundaryState,
} from "../../src/app/ErrorBoundary";

/* --------------------------------------------------------------------------
 * T104 — graceful failures
 *
 * Error boundaries must be class components, so the recovery logic is driven
 * directly (`getDerivedStateFromError`, `componentDidCatch`) and the fallback
 * is server-rendered without a DOM. This keeps the test in the default Node
 * environment while still proving the boundary catches, reports and offers a
 * recovery surface.
 * ------------------------------------------------------------------------ */

/** Build an instance with `state.error` set, mimicking React's catch pass. */
function faulted(props: ErrorBoundaryProps, error: Error): ErrorBoundary {
  const instance = new ErrorBoundary(props);
  (instance as unknown as { state: ErrorBoundaryState }).state =
    ErrorBoundary.getDerivedStateFromError(error);
  return instance;
}

function render(node: ReactNode): string {
  return renderToStaticMarkup(node as ReactElement);
}

describe("ErrorBoundary", () => {
  it("captures a thrown error as state", () => {
    const error = new Error("boom");
    expect(ErrorBoundary.getDerivedStateFromError(error)).toEqual({ error });
  });

  it("renders its children while healthy", () => {
    const instance = new ErrorBoundary({ children: createElement("span", null, "on parade") });
    expect(render(instance.render())).toContain("on parade");
  });

  it("renders the in-fiction fallback after a fault", () => {
    const instance = faulted({}, new Error("grid desync"));
    const html = render(instance.render());

    expect(html).toContain("The line has broken");
    expect(html).toContain("Dispatch lost");
    expect(html).toContain("grid desync");
    expect(html).toContain("Re-form the line");
    expect(html).toContain("Reload the campaign");
    expect(html).toContain('data-testid="error-boundary"');
  });

  it("reports the fault through onError", () => {
    const onError = vi.fn();
    const error = new Error("boom");
    const instance = new ErrorBoundary({ onError });

    instance.componentDidCatch(error, { componentStack: "\n  at App" });

    expect(onError).toHaveBeenCalledWith(error, { componentStack: "\n  at App" });
  });

  it("falls back to the console when no reporter is given", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = new Error("boom");
    const instance = new ErrorBoundary({});
    try {
      instance.componentDidCatch(error, { componentStack: "\n  at App" });
      expect(spy).toHaveBeenCalledWith("Lines of Glory: unhandled UI error", error, "\n  at App");
    } finally {
      spy.mockRestore();
    }
  });

  it("lets a host draw its own fallback", () => {
    const instance = faulted(
      {
        fallback: (error, reset) =>
          createElement("p", null, `caught ${error.message}; ${typeof reset}`),
      },
      new Error("boom"),
    );
    expect(render(instance.render())).toBe("<p>caught boom; function</p>");
  });
});
