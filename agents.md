# agents.md — Working agreement for AI coding agents

This file is the entry point for any AI agent (or human) contributing to
**Tactica**: a browser-based, small-squad tactics RPG set in a **Napoleonic
Wars-era** theatre and built on the mechanics of *Final Fantasy Tactics Advance*
(FFTA, 2003). Read this file first, then `todo.md`, then
`docs/NAPOLEONIC_MAPPING.md`, then the relevant pages under `docs/wiki/`.

---

## 1. What we are building

A single-player, turn-based isometric tactics RPG **set in the Napoleonic
Wars** (an original, fictionalized theatre) that reproduces FFTA's **core
systems** with original content:

- Grid battles with elevation, facing, and a Speed-based **Orders Tempo**
  (Charge Time Battle) turn order.
- A **free company** roster of soldiers drawn from **five great-power military
  schools** (France, Britain, Prussia, Russia, Austria — the five FFTA races),
  each with a **role tree**.
- **Abilities learned through kit**: battles award **Drill** (AP) that masters
  abilities bound to equipment. Mastering abilities unlocks new **posts**
  (jobs). A soldier has a primary post (stats + look) and an attached post
  (skillset).
- The **Articles of War** system: a **Provost Marshal** enforces daily standing
  orders; violations bring **Reprimands** (Yellow) / **Court-Martials** (Red);
  commendable acts grant **Honour** (JP) spent on **Volleys** (Combos) and
  **Guard Sorties** (Totema). Lawless **No-Man's Land** (Jagds) has no provost.
- **Contracts** from officers' messes (battle / skirmish / detachment /
  pacification), a customizable **Campaign Map**, depots, and company
  progression.

It is a **systems retheme**, not a port. The complete FFTA→Napoleonic mapping
lives in **`docs/NAPOLEONIC_MAPPING.md`** — consult it before naming anything.
See §3 (Legal).

### Theme constraints (LOCKED — mapping §14)

Treat these as hard constraints unless the mapping doc is deliberately revised:

- **Detachment scale** — units are individual specialists / small crews, not
  battalions.
- **Grounded** — no literal magic. Reframe every spell as artillery, medicine,
  signals or morale; keep the mechanical effect, change the cause.
- **Square-isometric grid** with 4-directional facing (no hex rewrite).
- **Multinational free company** — the player recruits from all five powers.
- **Ability resource = Élan**, which also acts as morale (low → Shaken/Routed).
- **8 reflavoured elements** (mapping §7); keep element-based Articles of War.
- Working title ***Lines of Glory***; project codename stays `Tactica`.

---

## 2. Non-negotiable principles

1. **Engine purity.** Everything under `src/engine/` is framework-free,
   DOM-free TypeScript. It must run in Node (for tests) and in the browser
   unchanged. No `window`, no `document`, no PixiJS, no React, no randomness
   from `Math.random()`.
2. **Determinism.** Given the same initial state, seed, and ordered list of
   player/AI commands, the engine must produce byte-identical state. All
   randomness goes through a seeded PRNG held in engine state. This enables
   unit tests, replays, and future netcode.
3. **Data-driven content.** Jobs, abilities, items, enemies, laws, missions and
   maps are data (`src/data/`), not hard-coded branches. Adding content should
   rarely require touching engine code.
4. **Original assets and names.** Never copy FFTA sprites, music, or verbatim
   text. Use placeholders / generated art. See §3.
5. **Small, tested steps.** Every engine change lands with Vitest coverage.
   The plan lives in `todo.md`; keep it updated.

---

## 3. Legal & asset policy

FFTA and all related names, characters, art and data are **© Square Enix**.
The `docs/wiki/` mirror is wiki text under **CC BY-SA** and is included for
**study and reference only**.

- ✅ OK: reimplementing mechanics, formulas and data structures; original
  names for the game, world, factions and characters.
- ❌ Not OK: shipping ripped sprites/audio, FFTA logos, or verbatim wiki prose
  in the game. Do not commit copyrighted art or fonts.
- Any derived numbers taken from the reference must be re-authored as our own
  balance data, with a note in the data file saying what inspired it.

---

## 4. Tech stack

| Concern            | Choice                                                        |
| ------------------ | ------------------------------------------------------------- |
| Language           | TypeScript (strict)                                           |
| Build/dev server   | Vite                                                          |
| Battlefield render | PixiJS v8 (WebGL, Canvas fallback)                            |
| UI / menus         | React (DOM overlay above the canvas)                          |
| UI state bridge    | Zustand (thin; engine remains the source of truth)            |
| Data validation    | Zod (validates `src/data` at load/test time)                  |
| Tests              | Vitest (engine/data), Testing Library (UI), Playwright (e2e)  |
| Lint/format        | ESLint (typescript-eslint) + Prettier                         |
| Persistence        | `idb-keyval` (IndexedDB) behind a `SaveStore` interface       |
| Runtime            | Node 20+ for tooling; modern evergreen browsers for the game  |

Keep dependencies lean. Discuss any new runtime dependency before adding it.

---

## 5. Commands

```bash
npm install            # install deps
npm run dev            # start Vite dev server
npm run build          # type-check + production build
npm run preview        # serve the production build
npm run test           # Vitest (watch)
npm run test -- --run  # Vitest one-shot (used in CI)
npm run test:e2e       # Playwright
npm run lint           # ESLint
npm run format         # Prettier write
```

Reference mirror maintenance (Python 3.12, no third-party deps beyond
BeautifulSoup):

```bash
python scripts/scrape_ffta_wiki.py            # refresh docs/wiki from Fandom
python scripts/scrape_ffta_wiki.py --group Jobs --force
python scripts/scrape_ffta_wiki.py --list     # preview planned pages
```

---

## 6. Repository layout

```
Tactica/
├── agents.md                 # this file
├── todo.md                   # the roadmap / task board
├── .gitignore
├── docs/
│   ├── NAPOLEONIC_MAPPING.md # FFTA → Napoleonic retheme (design contract)
│   └── wiki/                 # scraped FFTA reference (see §10)
├── site/
│   └── index.html            # single-file visual mapping reference (no deps)
│       ├── INDEX.md          # grouped list of every scraped page
│       ├── _meta.json        # machine-readable manifest
│       ├── pages/*.md        # readable renderings
│       ├── raw/*.wiki        # original wikitext (authoritative tables)
│       └── .cache/           # scraper cache (git-ignored)
├── scripts/
│   └── scrape_ffta_wiki.py   # reproducible scraper
├── tools/
│   ├── todo.mjs              # zero-dep task runner for todo.md
│   └── README.md             # task-board format + runner usage
├── src/
│   ├── engine/               # pure deterministic simulation (no DOM)
│   │   ├── rng.ts            # seeded PRNG
│   │   ├── grid.ts           # tiles, height, terrain, pathfinding
│   │   ├── unit.ts           # unit model + derived stats
│   │   ├── turn.ts           # CTB charge-time scheduler
│   │   ├── battle.ts         # battle state machine (reduce/step)
│   │   ├── actions/          # move, attack, cast, item, wait...
│   │   ├── rules/            # damage, hit, status, elements, laws
│   │   ├── commands.ts       # serializable command types
│   │   └── events.ts         # emitted events for renderer/UI
│   ├── data/                 # authored content (jobs, abilities, items...)
│   ├── ai/                   # enemy/ally decision making
│   ├── app/                  # controllers wiring engine <-> UI <-> render
│   ├── render/               # PixiJS scene, sprites, camera, animations
│   ├── ui/                   # React components (HUD, job screen, pub...)
│   ├── persist/              # save/load (SaveStore)
│   └── main.tsx
└── tests/                    # engine unit tests + e2e specs
```

---

## 7. Architecture & data flow

```
        player input / AI
               │
               ▼
        Command (serializable)          ── src/engine/commands.ts
               │
               ▼
   Engine.step(state, command)  ->  { state', events[] }
               │                              │
               │                              ├─► Renderer (Pixi) animates events
               ▼                              └─► UI (React) reads state, shows menus
      persisted SaveState
```

- **Commands** are the only way to mutate the world. They are plain objects so
  they can be logged, replayed, and sent over a network later.
- **Events** describe what happened (damage dealt, unit moved, law broken,
  ability learned). The renderer consumes events to animate; it never mutates
  engine state.
- **State** is a serializable value. Treat it as immutable; `step` returns a new
  state (structural sharing is fine). This keeps save/load and replays trivial.
- **AI** submits commands through the exact same path as the player — no special
  cases.

### CTB turn order (FFTA behaviour)

Turn order is not round-robin. Each unit accumulates charge proportional to its
**Speed**; when a unit's charge reaches the threshold (typically 100) it acts,
then its charge resets. Abilities have a **charge time** that can delay when
their effect resolves relative to other units. Implement this in
`engine/turn.ts`; keep it discrete and deterministic (integer ticks). See
`docs/wiki/pages/Charge_time.md` and `docs/wiki/pages/Battle_system.md`.

---

## 8. Domains glossary (FFTA → code)

The code identifiers below are FFTA-shaped on purpose (the mechanics are FFTA's).
Player-facing names are **Napoleonic** and defined in
`docs/NAPOLEONIC_MAPPING.md` §1. Keep the layers separate: engine/data keys stay
stable (`jobId`, `actionAbilityId`), while `name`/`description` fields carry the
period fiction.

| FFTA term                | Meaning                                                        | Code sketch                      |
| ------------------------ | -------------------------------------------------------------- | -------------------------------- |
| Clan                     | The player's roster/faction                                    | `Clan`, `Party`                  |
| Unit                     | A combatant (player, ally, enemy, monster)                     | `Unit`                           |
| Job (class)              | Stat profile + equipment + skillsets                           | `JobDef`                         |
| A-Ability (action)       | Active skill in a skillset (may cost MP)                       | `ActionAbilityDef`               |
| R-Ability (reaction)     | Triggered response (e.g. Counter)                              | `ReactionAbilityDef`             |
| S-Ability (support)      | Passive modifier                                               | `SupportAbilityDef`              |
| C-Ability (combo)        | Chains with adjacent allies, uses JP                           | `ComboAbilityDef`                |
| AP (Ability Points)      | Earned from missions; masters equipped abilities               | `ap`, `LearnedAbility`           |
| JP (Judge Points)        | Earned from legal KOs / recommended acts; max 10; fuels combo/Totema | `judgePoints`             |
| Law / Antilaw / Advanced Law | Per-day restrictions & counters                            | `LawDef`, `activeLaws`           |
| Judge                    | Non-combat arbiter that issues cards                           | `JudgeUnit`                      |
| Yellow / Red Card        | Penalties for breaking laws                                    | enforcement in `rules/laws.ts`   |
| Totema                   | Race-guardian summon (costs 10 JP)                             | `TotemaDef`                      |
| Jagd                     | Lawless region; KO = permanent loss                            | `Region.isJagd`                  |
| Mission                  | Pub task: regular/encounter/dispatch/area                      | `MissionDef`                     |
| Area token               | Placeable world-map tile that shapes Ivalice                   | `MapTokenDef`                    |
| Monster Bank             | Storage for captured monsters (Beastmaster/Hunter)             | `MonsterBank`                    |

Full reference: `docs/wiki/INDEX.md`. Highest-value pages: `Final_Fantasy_
Tactics_Advance.md`, `Final_Fantasy_Tactics_Advance_jobs.md`,
`Law_system_(Tactics_Advance).md`, `Judge_Points.md`, `Ability_Points.md`,
`Charge_time.md`, `Stat_growth.md`, `Attack_(command).md`, `Magic_(command).md`,
`MP_(stat).md`, `Final_Fantasy_Tactics_Advance_weapons.md`,
`Final_Fantasy_Tactics_Advance_statuses.md`.

---

## 9. Coding conventions

- TypeScript `strict`; no `any` without a written justification comment.
- Prefer `type`/`interface` + discriminated unions for commands/events:
  ```ts
  type Command =
    | { kind: "move"; unitId: UnitId; path: Coord[] }
    | { kind: "act"; unitId: UnitId; abilityId: AbilityId; target: Target }
    | { kind: "wait"; unitId: UnitId };
  ```
- Pure functions in `engine`. Side effects only at the edges (`app`, `render`,
  `persist`).
- IDs are branded string types (`type UnitId = string & { __brand: "UnitId" }`).
- All tunable numbers live in `src/data/` — never bury a balance constant in
  logic.
- Name files/functions after the glossary above so FFTA concepts map 1:1.
- Write a short comment citing the reference page when implementing a
  non-obvious mechanic (e.g. `// CTB per docs/wiki/pages/Charge_time.md`).

---

## 10. Using the reference mirror

- Start every mechanics task by reading the matching page in
  `docs/wiki/pages/`. Tables (stat growth, weapon/ability lists) are most
  reliable in `docs/wiki/raw/*.wiki`.
- The mirror is generated; **do not hand-edit** files under `docs/wiki/pages`
  or `docs/wiki/raw`. To change the selection, edit the `GROUPS` map in
  `scripts/scrape_ffta_wiki.py` and re-run it.
- Known reference status (verify, don't assume):
  - **Damage formulas ARE documented.** Physical: `docs/wiki/pages/Attack_(command).md`
    (base = WeaponAtk − TargetWeaponDef/2, then × Power/100). Magical:
    `docs/wiki/pages/Magic_(command).md` (base = MagicPower − TargetMagicRes/2,
    then × Power/100). The prose on `Attack (command)` includes a second,
    garbled "final formula" line — trust the step-wise version, and model the
    formula as data so it can be rebalanced. Weapon-type variants (bows, guns,
    instruments, etc.) live on the same pages.
  - **FFTA MP regeneration is NOT documented.** The `MP (stat)` page's FFTA
    section is an empty `{{Section}}` stub; only the *A2* rule is stated there
    (battle starts at 0 MP, +10 MP per turn, ×2 with MP Channeling). Confirm
    the FFTA rule explicitly and encode it as a tunable.
- Treat every scraped number as **reference**, not gospel: re-author balance as
  our own data with a comment noting what inspired it.
- `docs/wiki/.cache/` is git-ignored. Only `pages/`, `raw/`, `INDEX.md`,
  `_meta.json` are committed.

---

## 11. Agent workflow

1. Read `agents.md` (this file) and skim `todo.md`.
2. Pick the top unchecked task in the earliest incomplete phase, or the task
   the user named. If a task is ambiguous, state your assumptions in the PR/commit.
3. Read the relevant `docs/wiki/pages/*.md` before implementing mechanics.
4. Implement in the correct layer. Engine change → add/extend Vitest tests.
5. Run `npm run test -- --run`, `npm run lint`, and `npm run build`.
6. Update `todo.md`: check off completed items and add follow-ups you discover.
7. Commit with a conventional prefix: `feat(engine):`, `feat(ui):`,
   `data:`, `test:`, `docs:`, `chore:`. Keep changes scoped to one task.

**Definition of done for a task:** code + tests pass + docs/todo updated +
no copyrighted assets introduced + deterministic (no `Math.random`) + no layer
violations (engine imports nothing from `render`/`ui`/`app`).

---

## 12. Roadmap

The phased plan and live checklist are in **`todo.md`**. Keep it the single
source of truth for "what's next".
