# todo.md — Lines of Glory task board

> **Machine-readable.** This file is parsed and updated by `tools/todo.mjs`
> (see `tools/README.md`). Keep the format exact:
>
> - Phases are `## <Phase name>` headings.
> - Tasks are `### TNNN — Title` headings (three digits, unique).
> - Each task has bullet metadata: `status`, `deps`, `verify`, `done`, and
>   optionally `files`. **One bullet per line** (no wrapped values).
> - `status` ∈ `todo | doing | done | blocked | failed | skipped`.
> - `deps` is `[]` or `[T001, T002]`; a task is *actionable* only when every
>   dependency is `done`.
> - `verify` is a single shell command the runner executes to accept the task
>   (use `—` when there is nothing to run).
> - Free prose after the bullets is the task description; the runner includes it
>   in the prompt it hands to the coding agent.
> - This comment block is ignored by the parser.

Legend: `todo` · `doing` · `done` · `blocked` · `failed` · `skipped`
Milestones: **MVP** = Phases 0–6 · **Beta** = 7–10 · **Polish** = 11 · **Stretch** = 12

---

## Phase 0 — Foundation

### T001 — Bootstrap Vite + React + TypeScript (strict)
- status: done
- deps: []
- files: package.json, tsconfig.json, vite.config.ts, index.html, src/main.tsx
- verify: npm run build
- done: `npm run dev` serves a placeholder battlefield page; `npm run build` passes.

Initialise the project with Vite, React and TypeScript in `strict` mode. Add the
core npm scripts (`dev`, `build`, `preview`, `typecheck`). No game logic yet.

### T002 — Lint & format tooling
- status: done
- deps: [T001]
- files: eslint.config.js, .prettierrc, package.json
- verify: npm run lint
- done: `npm run lint` and `npm run format:check` both pass on the scaffold.

Add ESLint (typescript-eslint) + Prettier with `lint`, `format`, `format:check`
scripts. Enforce no `any` without an inline justification comment.

### T003 — Vitest unit-test setup
- status: done
- deps: [T001]
- files: vitest.config.ts, tests/unit/smoke.test.ts
- verify: npm run test -- --run
- done: `npm run test -- --run` runs and passes a smoke test.

Configure Vitest for `tests/unit` and `src/**/*.test.ts`. Add the one-shot test
script used by CI.

### T004 — Playwright e2e setup
- status: done
- deps: [T001]
- files: playwright.config.ts, tests/e2e/smoke.spec.ts
- verify: npm run test:e2e
- done: A smoke spec loads the dev/preview page and asserts the canvas exists.

Configure Playwright with a preview-server webServer entry and one smoke spec.

### T005 — Source layer skeleton + import boundaries
- status: done
- deps: [T001]
- files: src/engine/, src/data/, src/ai/, src/app/, src/render/, src/ui/, src/persist/
- verify: npm run typecheck
- done: Empty modules exist per `agents.md` §6; an ESLint rule forbids `src/engine` importing from `render`/`ui`/`app`.

### T006 — Netlify build config
- status: done
- deps: [T001, T002, T003]
- files: netlify.toml, .nvmrc, .gitignore
- verify: npm run build
- done: netlify.toml builds `npm run build` into `dist` with an SPA redirect and a pinned Node version (`.nvmrc`); CI/deploys are handled by Netlify (user-managed).

### T007 — Placeholder battlefield canvas + HUD shell
- status: done
- deps: [T001, T005]
- files: src/render/scene.ts, src/ui/App.tsx, src/main.tsx
- verify: npm run build
- done: A blank isometric-styled grid renders behind a DOM HUD shell.

### T008 — Data schema (rethemed) + Zod validation
- status: done
- deps: [T001, T005]
- files: src/data/schema.ts, src/data/README.md
- verify: npm run test -- --run tests/unit/data.test.ts
- done: Zod schemas define Post, Ability, Equipment, Enemy, Article, Contract, Element, Condition; keys are FFTA-shaped with `name`/`description`/`flavour` display fields.

### T009 — Data integrity test (no `TBD` names)
- status: done
- deps: [T008]
- files: tests/unit/data.test.ts
- verify: npm run test -- --run tests/unit/data.test.ts
- done: Every loaded data def has a non-empty Napoleonic `name` and no `TBD`/placeholder strings.

### T010 — README + docs wiring
- status: done
- deps: [T001]
- files: README.md
- verify: —
- done: README explains the game, links `agents.md`, `docs/NAPOLEONIC_MAPPING.md`, `site/index.html`, and how to run the todo tool.

---

## Phase 1 — Deterministic engine foundation

### T011 — Seeded PRNG
- status: done
- deps: [T001, T005]
- files: src/engine/rng.ts, tests/unit/rng.test.ts
- verify: npm run test -- --run tests/unit/rng.test.ts
- done: Same seed + call sequence yields identical values; RNG state is serialisable. No `Math.random` anywhere in `src/engine`.

### T012 — Branded ID types
- status: done
- deps: [T001]
- files: src/engine/ids.ts
- verify: npm run typecheck
- done: `UnitId`, `PostId`, `AbilityId`, `ContractId`, etc. are branded strings with helpers.

### T013 — Coordinates & grid model
- status: done
- deps: [T011, T012]
- files: src/engine/grid.ts, tests/unit/grid.test.ts
- verify: npm run test -- --run tests/unit/grid.test.ts
- done: Square-isometric grid of tiles with bounds checks, neighbours and cardinal facing.

### T014 — Terrain & elevation
- status: done
- deps: [T013]
- files: src/engine/terrain.ts
- verify: npm run test -- --run tests/unit/grid.test.ts
- done: Tile terrain types (field, wood, village, river, redoubt...) and height with passability and move-cost data.

### T015 — Pathfinding (A*)
- status: done
- deps: [T013, T014]
- files: src/engine/pathfinding.ts, tests/unit/pathfinding.test.ts
- verify: npm run test -- --run tests/unit/pathfinding.test.ts
- done: A* returns least-cost paths honouring terrain cost, elevation climb limit and occupied tiles.

### T016 — Range & line of sight
- status: done
- deps: [T013, T014]
- files: src/engine/targeting.ts, tests/unit/targeting.test.ts
- verify: npm run test -- --run tests/unit/targeting.test.ts
- done: Range checks and LoS blocking by terrain/elevation verified by tests.

### T017 — Unit model
- status: done
- deps: [T012, T013]
- files: src/engine/unit.ts
- verify: npm run test -- --run tests/unit/unit.test.ts
- done: Units carry power, post, level, stats, HP, Élan, Honour, facing, conditions, equipment, learned abilities.

### T018 — Derived stats
- status: done
- deps: [T017, T008]
- files: src/engine/stats.ts, tests/unit/stats.test.ts
- verify: npm run test -- --run tests/unit/stats.test.ts
- done: Effective stats = base growth × level + post modifiers + equipment, fully data-driven.

### T019 — Orders Tempo (CTB scheduler)
- status: done
- deps: [T017, T011]
- files: src/engine/turn.ts, tests/unit/turn.test.ts
- verify: npm run test -- --run tests/unit/turn.test.ts
- done: Integer charge ticks; higher Speed acts sooner/more often; deterministic given a seed.

### T020 — Command types
- status: done
- deps: [T012]
- files: src/engine/commands.ts
- verify: npm run typecheck
- done: Discriminated-union Commands (move, act, wait, face, hold, use-volley, guard-sortie...) are serialisable.

### T021 — Event types
- status: done
- deps: [T012]
- files: src/engine/events.ts
- verify: npm run typecheck
- done: Events describe everything the renderer needs (moved, damaged, condition applied, article broken, ability learned...).

### T022 — Battle create/step
- status: done
- deps: [T013, T017, T019, T020, T021]
- files: src/engine/battle.ts, tests/unit/battle.test.ts
- verify: npm run test -- --run tests/unit/battle.test.ts
- done: `createBattle(seed, setup)` and `step(state, command) -> {state, events}`; invalid commands are rejected without mutation.

### T023 — State serialise + hash + determinism test
- status: done
- deps: [T022]
- files: src/engine/serialize.ts, tests/unit/determinism.test.ts
- verify: npm run test -- --run tests/unit/determinism.test.ts
- done: A scripted battle replayed from seed + command log produces an identical state hash.

---

## Phase 2 — Battle core + first render

### T024 — Action resolution pipeline
- status: done
- deps: [T022]
- files: src/engine/actions/resolve.ts
- verify: npm run test -- --run tests/unit/battle.test.ts
- done: Declare → charge → resolve → end-turn → advance tempo, all via events.

### T025 — Move command
- status: done
- deps: [T015, T024]
- files: src/engine/actions/move.ts
- verify: npm run test -- --run tests/unit/move.test.ts
- done: Path validation, cost, elevation/jump, and movement events.

### T026 — Wait / Facing / Hold
- status: done
- deps: [T024]
- files: src/engine/actions/basic.ts
- verify: npm run test -- --run tests/unit/move.test.ts
- done: Wait, change facing, and Hold (brace) actions resolve correctly.

### T027 — Battle UI state machine
- status: done
- deps: [T024]
- files: src/app/battleController.ts
- verify: npm run test -- --run tests/unit/battleController.test.ts
- done: Select unit → show move range → move → choose action → target → confirm; state exposed to UI.

### T028 — Targeting system
- status: done
- deps: [T016, T020]
- files: src/engine/targeting.ts
- verify: npm run test -- --run tests/unit/targeting.test.ts
- done: Single/AoE/self/ally/enemy target predicates with range and LoS.

### T029 — PixiJS isometric renderer (grid + camera)
- status: done
- deps: [T007, T013]
- files: src/render/scene.ts, src/render/tiles.ts
- verify: npm run build
- done: Terrain, elevation and grid render isometrically with pan/zoom.

### T030 — Input controller + path preview
- status: done
- deps: [T025, T029]
- files: src/app/input.ts, src/render/overlay.ts
- verify: npm run test:e2e
- done: Mouse/touch/keyboard select tiles; move range and path preview render.

### T031 — Win/lose conditions
- status: done
- deps: [T022]
- files: src/engine/objectives.ts
- verify: npm run test -- --run tests/unit/battle.test.ts
- done: Annihilation, rout, survive-N, capture/defend objectives; battle-end event.

### T032 — Movement & targeting tests
- status: done
- deps: [T025, T028]
- files: tests/unit/movement.test.ts
- verify: npm run test -- --run tests/unit/movement.test.ts
- done: Edge cases for blocked paths, AoE shapes, and elevation in LoS.

### T115 — Native move-and-act turn
- status: done
- deps: [T024, T025]
- files: src/engine/battle.ts, src/app/battleController.ts
- verify: npm run test -- --run tests/unit/battle.test.ts
- done: A turn may move and then act without spending Orders Tempo on the move, so the controller stops composing `applyMove` and the move stays a real command in the log.

Today `step` ends the Orders Tempo turn for **every** command, so the battle UI
controller (T027) has to compose the FFTA free move (`applyMove`) before
committing the action through `step`. Promote that into the engine: let a `move`
command leave the actor's turn open until an `act` / `wait` / `hold` order (or an
explicit end-turn) closes it, keeping the command log replayable and
deterministic.

---

## Phase 3 — Combat, actions, conditions

### T033 — Steel (physical) damage
- status: done
- deps: [T024, T018]
- files: src/engine/rules/damage.ts, tests/unit/damage.test.ts
- verify: npm run test -- --run tests/unit/damage.test.ts
- done: `WeaponAtk − TargetWeaponDef/2`, then × `Power/100`, data-driven; ambiguous secondary line from the wiki resolved and documented.

### T034 — Powder (magical) damage
- status: done
- deps: [T033]
- files: src/engine/rules/damage.ts
- verify: npm run test -- --run tests/unit/damage.test.ts
- done: `MagicPower − TargetMagicRes/2`, then × `Power/100`.

### T035 — Weapon-type variants
- status: done
- deps: [T033]
- files: src/data/weapons.ts
- verify: npm run test -- --run tests/unit/damage.test.ts
- done: Variant formulas (sabre, lance, rifle, gun, instrument...) from `Attack_(command).md`.

### T036 — Healing formula
- status: done
- deps: [T033]
- files: src/engine/rules/damage.ts
- verify: npm run test -- --run tests/unit/damage.test.ts
- done: A documented healing formula (authored, since the wiki does not specify one).

### T037 — Hit, evasion & facing
- status: done
- deps: [T033, T013]
- files: src/engine/rules/hit.ts
- verify: npm run test -- --run tests/unit/hit.test.ts
- done: Hit chance with front/side/rear facing modifiers, seeded.

### T038 — Elements
- status: done
- deps: [T033]
- files: src/engine/rules/elements.ts, src/data/elements.ts
- verify: npm run test -- --run tests/unit/elements.test.ts
- done: Eight reflavoured elements with weak/resist/absorb and damage modification.

### T039 — Condition (status) engine
- status: done
- deps: [T017, T024]
- files: src/engine/rules/conditions.ts, src/data/conditions.ts, src/data/schema.ts, tests/unit/conditions.test.ts
- verify: npm run test -- --run tests/unit/conditions.test.ts
- done: Apply/stack/expire/tick for all mapped conditions (Bleeding, Dazed, Deafened, Pinned, Formed, Braced...).

### T040 — Élan resource + morale
- status: done
- deps: [T017, T039]
- files: src/engine/rules/elan.ts
- verify: npm run test -- --run tests/unit/elan.test.ts
- done: Élan is spent by actions and regenerates on a tunable schedule; low Élan applies Shaken and zero applies Routed.

### T041 — Action executor
- status: done
- deps: [T033, T034, T038, T039]
- files: src/engine/actions/ability.ts
- verify: npm run test -- --run tests/unit/ability.test.ts
- done: Executes data-defined actions: physical, ranged, artillery, medical, buffs, debuffs, drains, revival.

### T042 — Reaction abilities
- status: done
- deps: [T041]
- files: src/engine/reactions.ts
- verify: npm run test -- --run tests/unit/reactions.test.ts
- done: Trigger hooks for Riposte, Return Fire, Dodge, Field Dressing.

### T043 — Support traits
- status: done
- deps: [T041]
- files: src/engine/traits.ts
- verify: npm run test -- --run tests/unit/traits.test.ts
- done: Passive modifiers (Thrift, Drilled Guards, Two-Handed Grip...) via composable hooks.

### T044 — Shove (knockback)
- status: done
- deps: [T015, T033]
- files: src/engine/rules/shove.ts
- verify: npm run test -- --run tests/unit/shove.test.ts
- done: Push/pull with collision and elevation handling.

### T045 — Combat tests
- status: done
- deps: [T033, T041, T042, T043, T044]
- files: tests/unit/combat.test.ts
- verify: npm run test -- --run tests/unit/combat.test.ts
- done: Damage tiers, element interactions, condition lifecycle, reactions and traits covered.

---

## Phase 4 — Progression: posts, Drill, kit, leveling

### T046 — Post (job) definition
- status: done
- deps: [T008]
- files: src/data/posts.ts
- verify: npm run test -- --run tests/unit/posts.test.ts
- done: `PostDef` with power restriction, stat growth, usable kit, skill sets and unlock requirements.

### T047 — Author powers & role trees
- status: done
- deps: [T046]
- files: src/data/posts/*.ts
- verify: npm run test -- --run tests/unit/posts.test.ts
- done: All five powers and their role trees authored (≥ 25 posts, names from the mapping doc).

### T048 — Drill learning from kit
- status: todo
- deps: [T046, T050]
- files: src/engine/progression/drill.ts
- verify: npm run test -- --run tests/unit/drill.test.ts
- done: Abilities are bound to equipment; battle awards Drill distributed to equipped unmastered abilities; mastery is permanent.

### T049 — XP & level growth
- status: done
- deps: [T018, T046]
- files: src/engine/progression/level.ts
- verify: npm run test -- --run tests/unit/level.test.ts
- done: XP from actions/KOs; level-ups apply power/post stat growth.

### T050 — Equipment model
- status: done
- deps: [T008]
- files: src/data/equipment.ts
- verify: npm run test -- --run tests/unit/equipment.test.ts
- done: Weapons, uniforms/armour and accessories with stat mods, taught abilities (Drill cost), elements and on-hit conditions.

### T051 — Primary / attached post
- status: done
- deps: [T046, T050]
- files: src/engine/progression/posts.ts
- verify: npm run test -- --run tests/unit/posts.test.ts
- done: Stats from primary post; skill set choice from any mastered post; reaction/trait/volley slots.

### T052 — Post-change screen
- status: done
- deps: [T051]
- files: src/ui/PostScreen.tsx
- verify: npm run test:e2e
- done: UI gates post changes by unlock requirements and shows drill progress.

### T053 — Progression validation + tests
- status: todo
- deps: [T047, T048, T049, T051]
- files: tests/unit/progression.test.ts
- verify: npm run test -- --run tests/unit/progression.test.ts
- done: Unlock rules, Drill distribution, growth and equip legality covered.

---

## Phase 5 — Articles of War & the Provost

### T054 — Article definition
- status: done
- deps: [T008]
- files: src/data/articles.ts
- verify: npm run test -- --run tests/unit/articles.test.ts
- done: `ArticleDef` forbids/commends actions, elements, weapon types, posts and conditions.

### T055 — Daily orders generation
- status: todo
- deps: [T054, T011]
- files: src/engine/rules/articles.ts
- verify: npm run test -- --run tests/unit/articles.test.ts
- done: Seeded daily Articles per campaign day, with a pool and frequency model.

### T056 — Violation detection
- status: todo
- deps: [T055, T024]
- files: src/engine/rules/articles.ts
- verify: npm run test -- --run tests/unit/articles.test.ts
- done: Actions are checked against active Articles at resolution time.

### T057 — Reprimand / Court-Martial escalation
- status: todo
- deps: [T056]
- files: src/engine/rules/articles.ts
- verify: npm run test -- --run tests/unit/articles.test.ts
- done: 1st offence = Reprimand; 2nd or illegal KO = Court-Martial.

### T058 — Court-martial removal + commander game over
- status: todo
- deps: [T057]
- files: src/engine/rules/articles.ts
- verify: npm run test -- --run tests/unit/articles.test.ts
- done: Court-martialled units leave the field; the commander's court-martial ends the battle in defeat.

### T059 — Commissions (hero medals)
- status: todo
- deps: [T057]
- files: src/engine/rules/articles.ts
- verify: npm run test -- --run tests/unit/articles.test.ts
- done: Commissioned units are immune to Court-Martial and may break Articles freely.

### T060 — Honour economy
- status: todo
- deps: [T056, T017]
- files: src/engine/rules/honour.ts
- verify: npm run test -- --run tests/unit/honour.test.ts
- done: Honour from legal KOs and commended acts; cap 10; no stacking for one event.

### T061 — Volleys (combos)
- status: todo
- deps: [T060, T041]
- files: src/engine/actions/volley.ts
- verify: npm run test -- --run tests/unit/volley.test.ts
- done: Initiator spends Honour; adjacent allies chain in; damage scales with Honour spent.

### T062 — Guard Sorties
- status: todo
- deps: [T060]
- files: src/engine/actions/guardSortie.ts, src/data/guards.ts
- verify: npm run test -- --run tests/unit/guardSortie.test.ts
- done: Five national Guard Sorties cost 10 Honour, hit the whole field, and must be unlocked via story.

### T063 — Standing / Counter-Orders
- status: todo
- deps: [T055]
- files: src/engine/actions/orders.ts
- verify: npm run test -- --run tests/unit/orders.test.ts
- done: Cards add or nullify an Article mid-battle; max Articles enforced.

### T064 — General Orders
- status: todo
- deps: [T063]
- files: src/engine/rules/generalOrders.ts
- verify: npm run test -- --run tests/unit/orders.test.ts
- done: Company privilege nullifies one active Article.

### T065 — No-Man's Land
- status: todo
- deps: [T055, T022]
- files: src/engine/rules/noMansLand.ts
- verify: npm run test -- --run tests/unit/articles.test.ts
- done: No Provost or Articles; no Honour; KO is permanent; commander KO ends the campaign.

### T066 — Provost entity
- status: todo
- deps: [T057]
- files: src/engine/provost.ts
- verify: npm run test -- --run tests/unit/provost.test.ts
- done: A neutral, non-combatant unit that issues cards and moves casualties.

### T067 — Article system tests
- status: todo
- deps: [T055, T057, T058, T060, T061, T062]
- files: tests/unit/law.test.ts
- verify: npm run test -- --run tests/unit/law.test.ts
- done: Full violation → card → removal flow, Honour economy, Volley and Guard Sortie covered.

---

## Phase 6 — Campaign: company, contracts, map, depots

### T068 — Company model
- status: todo
- deps: [T017, T046]
- files: src/engine/company.ts
- verify: npm run test -- --run tests/unit/company.test.ts
- done: Company holds roster, Crowns, Regimental Honours and current theatre state.

### T069 — Recruit & dismiss
- status: todo
- deps: [T068]
- files: src/engine/company.ts
- verify: npm run test -- --run tests/unit/company.test.ts
- done: Recruit by power at recruiting offices; dismiss; roster limits.

### T070 — Contract definitions
- status: todo
- deps: [T008]
- files: src/data/contracts.ts
- verify: npm run test -- --run tests/unit/contracts.test.ts
- done: Battle, Skirmish, Detachment and Pacification contracts with fees, requirements and rewards.

### T071 — Officers' Mess UI
- status: todo
- deps: [T070, T068]
- files: src/ui/Mess.tsx
- verify: npm run test:e2e
- done: Mission board with fee, requirements (item/post/unit) and reward preview.

### T072 — Detachments
- status: todo
- deps: [T070, T076]
- files: src/engine/detach.ts
- verify: npm run test -- --run tests/unit/detach.test.ts
- done: Send unit(s) away for N days; resolve on return.

### T073 — Campaign Map + markers
- status: todo
- deps: [T068]
- files: src/engine/campaignMap.ts, src/ui/CampaignMap.tsx
- verify: npm run test -- --run tests/unit/campaignMap.test.ts
- done: Empty map grows as Campaign Markers are placed into slots; travel and treasure hunts; rewards depend on placement.

### T074 — Locations & battle maps data
- status: todo
- deps: [T013, T014]
- files: src/data/maps/*.ts
- verify: npm run test -- --run tests/unit/maps.test.ts
- done: Location/terrain data and battle map definitions validate.

### T075 — Depots (shops)
- status: todo
- deps: [T050, T068]
- files: src/ui/Depot.tsx
- verify: npm run test -- --run tests/unit/depot.test.ts
- done: Buy/sell with power-specific discounts and region gating.

### T076 — Calendar & daily orders
- status: todo
- deps: [T055, T068]
- files: src/engine/calendar.ts
- verify: npm run test -- --run tests/unit/calendar.test.ts
- done: Campaign date advances; Articles rotate daily; dispatch timers tick.

### T077 — Story spine
- status: todo
- deps: [T070, T073]
- files: src/data/story.ts
- verify: npm run test -- --run tests/unit/story.test.ts
- done: Chapter triggers gate story contracts and unlock Guard Sorties.

### T078 — Auxiliary Barracks
- status: todo
- deps: [T069]
- files: src/engine/barracks.ts
- verify: npm run test -- --run tests/unit/barracks.test.ts
- done: Capture/cajole irregulars and deploy them; Foreign Drill learns enemy actions.

### T079 — Campaign tests
- status: todo
- deps: [T070, T072, T073, T075, T076]
- files: tests/unit/campaign.test.ts
- verify: npm run test -- --run tests/unit/campaign.test.ts
- done: Contract gating, dispatch timing, marker rewards and economy covered.

---

## Phase 7 — Rendering, UI & UX (Beta)

### T080 — Terrain rendering
- status: todo
- deps: [T029, T014]
- files: src/render/tiles.ts
- verify: npm run build
- done: All terrain types and elevations render distinctly (fields, woods, villages, rivers, redoubts).

### T081 — Unit presentation
- status: todo
- deps: [T029, T017]
- files: src/render/units.ts
- verify: npm run build
- done: Placeholder soldier sprites by power/post, facing, HP/Élan bars, condition icons, Honour indicator.

### T082 — Event-driven animations
- status: todo
- deps: [T021, T081]
- files: src/render/animations.ts
- verify: npm run test:e2e
- done: Movement, volleys, artillery and condition popups animate from engine events only.

### T083 — Orders Tempo tray
- status: todo
- deps: [T019, T081]
- files: src/ui/TempoTray.tsx
- verify: npm run test:e2e
- done: Upcoming turn order is visualised.

### T084 — Menu suite
- status: todo
- deps: [T052, T071, T075]
- files: src/ui/Menus.tsx
- verify: npm run test:e2e
- done: Main, company, post, equipment, abilities, depot, mess and campaign-map menus.

### T085 — Targeting UX
- status: todo
- deps: [T028, T030]
- files: src/render/overlay.ts
- verify: npm run test:e2e
- done: Range/AoE highlight, danger zones, elevation preview.

### T086 — Battle forecast
- status: todo
- deps: [T033, T037]
- files: src/ui/Forecast.tsx
- verify: npm run test -- --run tests/unit/forecast.test.ts
- done: Expected damage, hit chance and reaction risk before confirming.

### T087 — Keyboard & gamepad navigation
- status: todo
- deps: [T084]
- files: src/app/input.ts
- verify: npm run test:e2e
- done: Full menu and battle navigation without a mouse; responsive layout.

---

## Phase 8 — Content pipeline & data

### T088 — Wiki → data converter
- status: todo
- deps: [T008]
- files: scripts/wiki_to_data.mjs
- verify: npm run test -- --run tests/unit/data.test.ts
- done: Converts scraped wiki tables (weapons/armour/abilities) into validated data, re-authored as our own balance.

### T089 — Ability sets per post
- status: todo
- deps: [T047, T088]
- files: src/data/abilities/*.ts
- verify: npm run test -- --run tests/unit/data.test.ts
- done: Every post has a complete, validated action set.

### T090 — Equipment tables
- status: todo
- deps: [T050, T088]
- files: src/data/equipment/*.ts
- verify: npm run test -- --run tests/unit/data.test.ts
- done: Full weapon/armour/accessory tables with Drill costs and taught abilities.

### T091 — Enemy roster + drops
- status: todo
- deps: [T008, T047]
- files: src/data/enemies/*.ts
- verify: npm run test -- --run tests/unit/data.test.ts
- done: Irregular/auxiliary troop roster with stats, actions, drops and AI profiles.

### T092 — Battle maps
- status: todo
- deps: [T014, T074]
- files: src/data/maps/*.json
- verify: npm run test -- --run tests/unit/maps.test.ts
- done: 10–20 varied battle maps with objectives.

### T093 — Article & contract pools
- status: todo
- deps: [T054, T070]
- files: src/data/articles/*.ts, src/data/contracts/*.ts
- verify: npm run test -- --run tests/unit/data.test.ts
- done: Full Article-of-War card pool and contract list (main + side + dispatch + pacification).

### T094 — Content integrity test
- status: todo
- deps: [T089, T090, T091, T092, T093]
- files: tests/unit/content.test.ts
- verify: npm run test -- --run tests/unit/content.test.ts
- done: All cross-references resolve; no dangling IDs; every def has a Napoleonic name.

---

## Phase 9 — AI

### T095 — Utility-based AI
- status: todo
- deps: [T028, T041]
- files: src/ai/utility.ts
- verify: npm run test -- --run tests/unit/ai.test.ts
- done: Scores targets by expected damage, kill potential, threat and positioning; issues only legal commands.

### T096 — Article-aware AI
- status: todo
- deps: [T095, T056]
- files: src/ai/utility.ts
- verify: npm run test -- --run tests/unit/ai.test.ts
- done: Avoids Article violations except for Commissioned units.

### T097 — Ability/item heuristics
- status: todo
- deps: [T095]
- files: src/ai/heuristics.ts
- verify: npm run test -- --run tests/unit/ai.test.ts
- done: Sensible heal/buff/consumable and Élan management.

### T098 — Ally auto-battle
- status: todo
- deps: [T095]
- files: src/app/autoBattle.ts
- verify: npm run test -- --run tests/unit/ai.test.ts
- done: Optional AI control for allied units.

### T099 — Difficulty tiers + perf
- status: todo
- deps: [T095]
- files: src/ai/difficulty.ts
- verify: npm run test -- --run tests/unit/ai.test.ts
- done: Seeded aggression/mistake tiers; decision budget < 16 ms for a typical encounter.

---

## Phase 10 — Persistence & release

### T100 — SaveStore + IndexedDB
- status: todo
- deps: [T005]
- files: src/persist/saveStore.ts
- verify: npm run test -- --run tests/unit/persist.test.ts
- done: A versioned `SaveStore` interface with an IndexedDB implementation and an in-memory test double.

### T101 — Save/load campaign
- status: todo
- deps: [T068, T100]
- files: src/persist/campaign.ts
- verify: npm run test -- --run tests/unit/persist.test.ts
- done: Full company, map, contract and seed/history round-trip.

### T102 — Autosave, slots & export/import
- status: todo
- deps: [T101]
- files: src/ui/Saves.tsx
- verify: npm run test:e2e
- done: Autosave, multiple slots, JSON export/import.

### T103 — Settings
- status: todo
- deps: [T100]
- files: src/ui/Settings.tsx
- verify: npm run test:e2e
- done: Volume, text speed, damage numbers, colour-blind mode and keybinds.

### T104 — Error boundary + save migrations
- status: todo
- deps: [T100]
- files: src/app/ErrorBoundary.tsx, src/persist/migrations.ts
- verify: npm run test -- --run tests/unit/persist.test.ts
- done: Graceful failures and versioned save migrations.

### T105 — Performance pass
- status: todo
- deps: [T080, T081]
- files: src/render/atlas.ts
- verify: npm run build
- done: Texture atlas, lazy map loading, memory check.

### T106 — Deploy + how to play
- status: todo
- deps: [T104]
- files: README.md, .github/workflows/deploy.yml
- verify: npm run build
- done: Static build deployed (Pages/Vercel/Netlify) with a player-facing how-to-play.

---

## Phase 11 — Audio, accessibility & polish

### T107 — Sound effects
- status: todo
- deps: [T082]
- files: src/audio/sfx.ts
- verify: npm run build
- done: Royalty-free SFX for UI, volleys, guns and cards.

### T108 — Music
- status: todo
- deps: [T107]
- files: src/audio/music.ts
- verify: npm run build
- done: Original/licensed music with volume mixing.

### T109 — Accessibility
- status: todo
- deps: [T084]
- files: src/ui/a11y.ts
- verify: npm run test:e2e
- done: Keyboard nav, screen-reader labels, reduced-motion, colour-blind-safe palette.

### T110 — Tutorial mission
- status: todo
- deps: [T071, T084]
- files: src/data/tutorial.ts
- verify: npm run test:e2e
- done: Teaches move/act/tempo/Articles/Drill.

### T111 — i18n scaffolding
- status: todo
- deps: [T010]
- files: src/i18n/index.ts
- verify: npm run test -- --run tests/unit/i18n.test.ts
- done: All UI strings via keys; no hard-coded copy.

---

## Phase 12 — Multiplayer (stretch)

### T112 — Lockstep netcode
- status: todo
- deps: [T023]
- files: src/net/lockstep.ts
- verify: npm run test -- --run tests/unit/lockstep.test.ts
- done: Deterministic command-log lockstep with state-hash desync detection.

### T113 — Lobby & matchmaking
- status: todo
- deps: [T112]
- files: src/net/lobby.ts
- verify: npm run test:e2e
- done: 1v1 skirmish between two free companies.

### T114 — Replays, trading & spectator
- status: todo
- deps: [T112]
- files: src/net/replay.ts
- verify: npm run test -- --run tests/unit/replay.test.ts
- done: Replay a battle from seed + command log; trade kit and prisoners.

---

## Research & open questions

- [ ] Physical/magical damage formulas — documented (see `Attack_(command).md`, `Magic_(command).md`); only the ambiguous secondary line and the healing formula need decisions (T033/T036).
- [ ] FFTA MP regeneration — `MP_(stat).md` FFTA section is a stub; T040 authored a default schedule (`ELAN_REGEN_AMOUNT` every `ELAN_REGEN_INTERVAL_TICKS`) and morale thresholds, still pending the Phase 13 balance pass.
- [ ] Exact Orders Tempo charge values, per-action tempo and Speed scaling (T019).
- [ ] Drill-to-mastery thresholds per ability (T048).
- [ ] Post-unlock thresholds (T046).
- [ ] Article generation frequency/pool and commended-action weighting (T055).
- [ ] Volley damage scaling with Honour and number of linkers (T061).
- [ ] FFTA-specific stat-growth formula (job tables give values + ranks) (T018/T049).
