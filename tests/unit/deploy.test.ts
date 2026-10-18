import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/* --------------------------------------------------------------------------
 * T106 — Deploy + how to play.
 *
 * The deployed artifact cannot be built or fetched from a unit test, so we pin
 * the two contracts that make the release player-facing: the GitHub Pages
 * workflow must build `dist/` and publish it, and the README must carry a
 * how-to-play aimed at players. This keeps either file from being gutted
 * without the suite noticing.
 * ------------------------------------------------------------------------ */

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

function readRepoFile(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8").replace(/\r\n/g, "\n");
}

describe("static deployment", () => {
  const workflow = readRepoFile(".github/workflows/deploy.yml");

  it("builds the static site with npm run build", () => {
    expect(workflow).toContain("npm run build");
    expect(workflow).toContain("npm ci");
  });

  it("publishes the dist folder to GitHub Pages", () => {
    expect(workflow).toContain("actions/upload-pages-artifact");
    expect(workflow).toContain("path: dist");
    expect(workflow).toContain("actions/deploy-pages");
    expect(workflow).toContain("pages: write");
    expect(workflow).toContain("id-token: write");
  });

  it("runs on pushes to main and skips an in-progress deploy", () => {
    expect(workflow).toContain("branches: [main]");
    expect(workflow).toContain("workflow_dispatch");
    expect(workflow).toContain("cancel-in-progress: false");
  });

  it("sets the Vite base path for a project Pages site", () => {
    expect(workflow).toContain("VITE_BASE");
    expect(workflow).toMatch(/VITE_BASE: \/\$\{\{\s*github\.event\.repository\.name\s*\}\}\//);
  });

  it("honours VITE_BASE in the Vite config", () => {
    expect(readRepoFile("vite.config.ts")).toContain("VITE_BASE");
  });
});

describe("how to play", () => {
  const readme = readRepoFile("README.md");

  it("has a player-facing how-to-play section", () => {
    expect(readme).toMatch(/^## How to play/m);
  });

  it("links to the deployed build", () => {
    expect(readme).toContain("https://wrexial.github.io/tactica/");
  });

  it("covers the core controls and systems", () => {
    for (const term of [
      "Orders Tempo",
      "Élan",
      "Articles of War",
      "Honour",
      "Volleys",
      "Guard Sorties",
      "Drill",
    ]) {
      expect(readme, `README should explain ${term}`).toContain(term);
    }
  });
});
