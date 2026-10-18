# Lines of Glory

A browser-based, **Napoleonic Wars-era** small-squad tactics RPG, built on the
core mechanics of *Final Fantasy Tactics Advance* (FFTA) with entirely original
content.

> **Status:** Phase 10 — persistence & release. The deterministic engine, battle
> layer, campaign and camp screens are implemented; content and balance are
> still being filled in.

**▶ [Play in your browser](https://wrexial.github.io/tactica/)** — the latest
`main` build is deployed to GitHub Pages. Or run it locally (see [Quickstart](#quickstart)).

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

## How to play

You command a **free company** fighting small, decisive detachment actions.
Your job is to complete the contract's objective while keeping your soldiers
(and their careers) alive.

### Controls

| Action | Keyboard / gamepad |
| ------ | ------------------ |
| Move the cursor | Arrow keys / `WASD` / D-pad |
| Select or confirm | `Enter` / gamepad **A** |
| Open **Orders** (action menu) | `O` |
| Back out / cancel | `Esc` / gamepad **B** |
| Open the camp menus | `M` / gamepad **Start** |
| Pan the field | click-drag |
| Zoom | mouse wheel |

### The turn: Orders Tempo

Turns are **not round-robin**. Every soldier builds up *tempo* in proportion to
Speed; the tray at the bottom shows who acts next. When your soldier's turn
comes up you may **move and then act** — moving does not spend the turn. The
turn ends when you resolve an **Order** (an action), or choose **Wait** / **Hold**.

Before you commit, the UI previews the move range, the target reach and area,
the enemy's **danger zone**, and the elevation change. The **forecast** shows
expected damage, hit chance and reaction risk so you can decide whether to take
the shot.

### Reading the battlefield

- **Facing** matters: attacks from the flank or rear are much more likely to hit.
- **Elevation** matters: high ground helps you and blocks line of sight.
- Watch **Élan** — the resource you spend on actions. It also doubles as morale:
  a low pool leaves a soldier **Shaken**, and an empty one leaves them **Routed**.
  Let it regenerate between big actions.

### The Articles of War

A neutral **Provost Marshal** enforces the day's **Articles of War** — standing
orders that forbid certain actions, elements, weapons or conditions. Breaking
one earns a **Reprimand** (a warning) and a second offence (or an illegal kill)
means a **Court-Martial** that removes the soldier from the field. If your
**commander** is court-martialled, the battle is lost. Commended acts and legal
kills earn **Honour** instead.

### Honour, Volleys & Guard Sorties

**Honour** is capped at 10 and pays for two things:

- **Volleys** — massed fire that chains adjacent allies together for extra damage.
- **Guard Sorties** — a national elite formation (10 Honour) that strikes the
  whole field. Each is unlocked by defeating it in the story.

### Drill, posts & the camp

Abilities are learned from **kit**: fighting awards **Drill**, which masters the
abilities bound to your equipment. Mastering abilities unlocks new **posts**
(roles). A soldier has a **primary post** (stats and look) plus an **attached
post** (a skillset pulled from any mastered role).

Between battles, open the camp (`M` / **Start**):

- **Barracks** — change posts and plan each soldier's role tree.
- **Officers' Mess** — take **contracts** (battle, skirmish, detachment,
  pacification) for Crowns and rewards.
- **Campaign Map** — travel the theatre and place **Campaign Markers**.
- **Quartermaster** — buy and sell kit (each power's depot gives a discount on
  its own stores).
- **Saves** — autosave, multiple slots, and JSON export/import.
- **Settings** — volume, text speed, damage numbers and more.

The campaign advances one day at a time; the Articles of War rotate daily, so
check the standing orders before every battle.

### Winning and losing

Each contract sets its own objective (destroy the enemy, rout them, survive N
turns, capture or defend a point). Lose your commander or fail the objective and
the action is lost. Beware **No-Man's Land**: there is no Provost and no Honour,
casualties are permanent, and losing your commander ends the campaign.

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

The game is a static site, built with `npm run build` into `dist/`. Two hosts
are configured:

- **GitHub Pages (default).** [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)
  builds on every push to `main` and publishes to GitHub Pages. The workflow
  passes `VITE_BASE=/<repo>/` so the project-site asset paths resolve. Set the
  repository's **Settings → Pages → Build and deployment → Source** to
  **GitHub Actions** once.
- **Netlify.** [`netlify.toml`](netlify.toml) builds the same `dist/` folder
  with an SPA redirect and Node pinned via `.nvmrc`; it keeps the default `/`
  base.

The Vite [`base`](vite.config.ts) is read from the `VITE_BASE` environment
variable, so a host that serves from a sub-path (Pages) and one that serves from
the root (Netlify, `npm run preview`) both work from the same source.

## License & attribution

Game code and original content © the project authors. *Lines of Glory* is an
original work inspired by the mechanics of *Final Fantasy Tactics Advance*;
FFTA names, art and data are © Square Enix and are **not** used. The
`docs/wiki/` reference mirror contains CC BY-SA wiki text kept for study only.
