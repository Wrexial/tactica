# Lines of Glory

A browser-based, **Napoleonic Wars-era** small-squad tactics RPG, built on the
core mechanics of *Final Fantasy Tactics Advance* (FFTA) with entirely original
content.

> **Status:** Phase 0 — project foundation. The battlefield canvas is a
> placeholder; the deterministic engine lands in Phase 1.

## What it is

You command a **free company** — a hired corps recruiting specialists from five
great-power military schools (France, Britain, Prussia, Russia, Austria). Battles
are small, decisive detachment actions (a bridge, a farmhouse, a supply column)
fought on a square-isometric grid, with:

- Speed-driven **Orders Tempo** turn order,
- **Élan** as the ability resource (and morale),
- **Drill** learned from kit, unlocking new **posts**,
- **Articles of War** enforced by a **Provost Marshal**, with **Volleys** and
  **Guard Sorties** paid for in **Honour**.

Everything is grounded — no literal magic; artillery, medicine, signals and
morale stand in for spells.

## Quickstart

Requires Node 22+.

```bash
npm install
npm run dev          # dev server
npm run build        # typecheck + production build to dist/
npm run preview      # serve the production build
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run test         # vitest (watch);  npm run test -- --run for one-shot
npm run test:e2e     # playwright (needs: npx playwright install chromium)
```

## Documentation

| Document | Purpose |
| -------- | ------- |
| [`agents.md`](agents.md) | Working agreement, architecture, locked theme constraints |
| [`todo.md`](todo.md) | Task board (114 tasks) — parsed by the runner |
| [`docs/NAPOLEONIC_MAPPING.md`](docs/NAPOLEONIC_MAPPING.md) | Full FFTA → Napoleonic mapping (decisions D0–D15 locked) |
| [`site/index.html`](site/index.html) | Single-file visual reference of the mapping |
| [`docs/wiki/INDEX.md`](docs/wiki/INDEX.md) | Scraped FFTA reference mirror |
| [`tools/README.md`](tools/README.md) | Task-board format + runner usage |

## Task runner

`todo.md` is machine-readable. Select and drive tasks with:

```bash
node tools/todo.mjs check           # validate the task graph
node tools/todo.mjs next            # next actionable task
node tools/todo.mjs list --status todo
node tools/todo.mjs run --agent 'pi --print "@{promptFile}"'   # execute in order
```

## Deployment

Netlify builds `npm run build` into `dist/` (see [`netlify.toml`](netlify.toml)),
with an SPA redirect and Node pinned via `.nvmrc`.

## License & attribution

Game code and original content © the project authors. *Lines of Glory* is an
original work inspired by the mechanics of *Final Fantasy Tactics Advance*;
FFTA names, art and data are © Square Enix and are **not** used. The
`docs/wiki/` reference mirror contains CC BY-SA wiki text kept for study only.
