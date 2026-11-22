# Lines of Glory

A browser-based, **Napoleonic Wars-era** small-squad tactics RPG, built on the
core mechanics of *Final Fantasy Tactics Advance* (FFTA) with entirely original
content.

> **Status:** Phases 0–27 complete (foundation through field AI, elevation, tile
> inspection, the balance passes, measured baselines, a campaign-wide battle
> sweep and the campaign's closing beats). The deterministic engine, battle layer, campaign and
> camp screens are implemented; the combat loop is locked by
> [`docs/COMBAT_LOOP.md`](docs/COMBAT_LOOP.md) and the authored numbers and
> measured baseline are recorded in [`docs/BALANCE.md`](docs/BALANCE.md).
> Content breadth is still being filled in.

**▶ [Play in your browser](https://wrexial.github.io/tactica/)** — every push to
`main` builds and publishes to GitHub Pages via
[`deploy.yml`](.github/workflows/deploy.yml) (which requests Pages enablement on
its first run; if Pages is not enabled, the workflow warns and skips publishing
— set Settings → Pages → Source to **GitHub Actions** once, then re-run it). Or run it locally (see
[Quickstart](#quickstart)).

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

The **[player guide](docs/HOW_TO_PLAY.md)** explains what is live in the current
build: Orders Tempo, Élan and morale, Drill and posts, objectives and the whole
campaign loop are playable; the Articles/Provost, Honour earned in battle,
Volleys and Guard Sorties exist as engine modules and tests but are not yet
wired into live battles (the guide lists them explicitly).

## How to play

> **New to the game?** Open the **Field Manual** tab in the game for the
> essentials, or read the [full player guide](docs/HOW_TO_PLAY.md) — the turn,
> the combat maths, the campaign loop, the camp screens and the exact
> live/designed split in one place.

You command a **free company** fighting small, decisive detachment actions.
Your job is to complete the contract's objective while keeping your soldiers
(and their careers) alive.

The game opens on a sandbox **Field action**: command your soldiers, then press
**Resolve** in the Field panel (or **Quick Battle** in the camp) to hand the
rest of the action to the deterministic AI and see it fought out. Accept a
contract from the Officers' Mess to begin a persisted campaign.

### Controls

| Action | Keyboard / gamepad |
| ------ | ------------------ |
| Move the cursor | Arrow keys / `WASD` / D-pad |
| Select or confirm | `Enter` / gamepad **A** |
| Open **Orders** (action menu) | `O` / gamepad **X** |
| Back out / cancel | `Esc` / gamepad **B** |
| End the turn | `T` / gamepad **Y** (or **End Turn** in the Orders band) |
| Open the camp menus | `M` / gamepad **Start** |
| Pan the field | click-drag |
| Zoom | mouse wheel |

### The turn: Orders Tempo

Turns are **not round-robin**. Every soldier builds up *tempo* in proportion to
Speed; the tray at the bottom shows who acts next. When your soldier's turn
comes up you may **move and then act** — moving does not spend the turn. The
turn ends when you resolve an **Order** (an action) or press **End Turn**.

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

### Checks and deployment

`.github/workflows/ci.yml` runs lint, format check, type-check, the unit suite,
the production build and the Playwright e2e suite on every push and pull
request. A push to `main` additionally deploys `dist/` to GitHub Pages;
`netlify.toml` remains configured as an alternative host.

## Documentation

| Document | Purpose |
| -------- | ------- |
| [`docs/HOW_TO_PLAY.md`](docs/HOW_TO_PLAY.md) | **Player guide** — controls, turns, combat, campaign, live/designed systems |
| [`agents.md`](agents.md) | Working agreement, architecture, locked theme constraints |
| [`todo.md`](todo.md) | Task board (169 tasks) — parsed by the runner |
| [`docs/NAPOLEONIC_MAPPING.md`](docs/NAPOLEONIC_MAPPING.md) | Full FFTA → Napoleonic mapping (decisions D0–D15 locked) |
| [`docs/BALANCE.md`](docs/BALANCE.md) | Authored balance decisions D16–D25, reference status, retune notes and the measured baseline |
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
