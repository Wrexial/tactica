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
- verify: npm run test -- --run tests/unit/smoke.test.ts
- done: `npm run test -- --run` runs and passes a smoke test.

Configure Vitest for `tests/unit` and `src/**/*.test.ts`. Add the one-shot test
script used by CI.

### T004 — Playwright e2e setup
- status: done
- deps: [T001]
- files: playwright.config.ts, tests/e2e/smoke.spec.ts
- verify: npm run test:e2e -- tests/e2e/smoke.spec.ts
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
- files: src/app/input.ts, src/render/overlay.ts, tests/e2e/input.spec.ts
- verify: npm run test:e2e -- tests/e2e/input.spec.ts
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
- status: done
- deps: [T046, T050]
- files: src/engine/progression/drill.ts, tests/unit/drill.test.ts
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
- files: src/ui/PostScreen.tsx, tests/e2e/postScreen.spec.ts
- verify: npm run test:e2e -- tests/e2e/postScreen.spec.ts
- done: UI gates post changes by unlock requirements and shows drill progress.

### T053 — Progression validation + tests
- status: done
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
- status: done
- deps: [T054, T011]
- files: src/engine/rules/articles.ts
- verify: npm run test -- --run tests/unit/articles.test.ts
- done: Seeded daily Articles per campaign day, with a pool and frequency model.

### T056 — Violation detection
- status: done
- deps: [T055, T024]
- files: src/engine/rules/articles.ts
- verify: npm run test -- --run tests/unit/articles.test.ts
- done: Actions are checked against active Articles at resolution time.

### T057 — Reprimand / Court-Martial escalation
- status: done
- deps: [T056]
- files: src/engine/rules/articles.ts
- verify: npm run test -- --run tests/unit/articles.test.ts
- done: 1st offence = Reprimand; 2nd or illegal KO = Court-Martial.

### T058 — Court-martial removal + commander game over
- status: done
- deps: [T057]
- files: src/engine/rules/articles.ts
- verify: npm run test -- --run tests/unit/articles.test.ts
- done: Court-martialled units leave the field; the commander's court-martial ends the battle in defeat.

### T059 — Commissions (hero medals)
- status: done
- deps: [T057]
- files: src/engine/rules/articles.ts
- verify: npm run test -- --run tests/unit/articles.test.ts
- done: Commissioned units are immune to Court-Martial and may break Articles freely.

### T060 — Honour economy
- status: done
- deps: [T056, T017]
- files: src/engine/rules/honour.ts
- verify: npm run test -- --run tests/unit/honour.test.ts
- done: Honour from legal KOs and commended acts; cap 10; no stacking for one event.

### T061 — Volleys (combos)
- status: done
- deps: [T060, T041]
- files: src/engine/actions/volley.ts
- verify: npm run test -- --run tests/unit/volley.test.ts
- done: Initiator spends Honour; adjacent allies chain in; damage scales with Honour spent.

### T062 — Guard Sorties
- status: done
- deps: [T060]
- files: src/engine/actions/guardSortie.ts, src/data/guards.ts
- verify: npm run test -- --run tests/unit/guardSortie.test.ts
- done: Five national Guard Sorties cost 10 Honour, hit the whole field, and must be unlocked via story.

### T063 — Standing / Counter-Orders
- status: done
- deps: [T055]
- files: src/engine/actions/orders.ts
- verify: npm run test -- --run tests/unit/orders.test.ts
- done: Cards add or nullify an Article mid-battle; max Articles enforced.

### T064 — General Orders
- status: done
- deps: [T063]
- files: src/engine/rules/generalOrders.ts
- verify: npm run test -- --run tests/unit/orders.test.ts
- done: Company privilege nullifies one active Article.

### T065 — No-Man's Land
- status: done
- deps: [T055, T022]
- files: src/engine/rules/noMansLand.ts
- verify: npm run test -- --run tests/unit/articles.test.ts
- done: No Provost or Articles; no Honour; KO is permanent; commander KO ends the campaign.

### T066 — Provost entity
- status: done
- deps: [T057]
- files: src/engine/provost.ts
- verify: npm run test -- --run tests/unit/provost.test.ts
- done: A neutral, non-combatant unit that issues cards and moves casualties.

### T067 — Article system tests
- status: done
- deps: [T055, T057, T058, T060, T061, T062]
- files: tests/unit/law.test.ts
- verify: npm run test -- --run tests/unit/law.test.ts
- done: Full violation → card → removal flow, Honour economy, Volley and Guard Sortie covered.

---

## Phase 6 — Campaign: company, contracts, map, depots

### T068 — Company model
- status: done
- deps: [T017, T046]
- files: src/engine/company.ts
- verify: npm run test -- --run tests/unit/company.test.ts
- done: Company holds roster, Crowns, Regimental Honours and current theatre state.

### T069 — Recruit & dismiss
- status: done
- deps: [T068]
- files: src/engine/company.ts
- verify: npm run test -- --run tests/unit/company.test.ts
- done: Recruit by power at recruiting offices; dismiss; roster limits.

### T070 — Contract definitions
- status: done
- deps: [T008]
- files: src/data/contracts.ts
- verify: npm run test -- --run tests/unit/contracts.test.ts
- done: Battle, Skirmish, Detachment and Pacification contracts with fees, requirements and rewards.

### T071 — Officers' Mess UI
- status: done
- deps: [T070, T068]
- files: src/ui/Mess.tsx, tests/e2e/mess.spec.ts
- verify: npm run test:e2e -- tests/e2e/mess.spec.ts
- done: Mission board with fee, requirements (item/post/unit) and reward preview.

### T072 — Detachments
- status: done
- deps: [T070, T076]
- files: src/engine/detach.ts
- verify: npm run test -- --run tests/unit/detach.test.ts
- done: Send unit(s) away for N days; resolve on return.

### T073 — Campaign Map + markers
- status: done
- deps: [T068]
- files: src/engine/campaignMap.ts, src/ui/CampaignMap.tsx
- verify: npm run test -- --run tests/unit/campaignMap.test.ts
- done: Empty map grows as Campaign Markers are placed into slots; travel and treasure hunts; rewards depend on placement.

### T074 — Locations & battle maps data
- status: done
- deps: [T013, T014]
- files: src/data/maps/*.ts
- verify: npm run test -- --run tests/unit/maps.test.ts
- done: Location/terrain data and battle map definitions validate.

### T075 — Depots (shops)
- status: done
- deps: [T050, T068]
- files: src/ui/Depot.tsx
- verify: npm run test -- --run tests/unit/depot.test.ts
- done: Buy/sell with power-specific discounts and region gating.

### T076 — Calendar & daily orders
- status: done
- deps: [T055, T068]
- files: src/engine/calendar.ts
- verify: npm run test -- --run tests/unit/calendar.test.ts
- done: Campaign date advances; Articles rotate daily; dispatch timers tick.

### T077 — Story spine
- status: done
- deps: [T070, T073]
- files: src/data/story.ts
- verify: npm run test -- --run tests/unit/story.test.ts
- done: Chapter triggers gate story contracts and unlock Guard Sorties.

### T078 — Auxiliary Barracks
- status: done
- deps: [T069]
- files: src/engine/barracks.ts
- verify: npm run test -- --run tests/unit/barracks.test.ts
- done: Capture/cajole irregulars and deploy them; Foreign Drill learns enemy actions.

### T079 — Campaign tests
- status: done
- deps: [T070, T072, T073, T075, T076]
- files: tests/unit/campaign.test.ts
- verify: npm run test -- --run tests/unit/campaign.test.ts
- done: Contract gating, dispatch timing, marker rewards and economy covered.

---

## Phase 7 — Rendering, UI & UX (Beta)

### T080 — Terrain rendering
- status: done
- deps: [T029, T014]
- files: src/render/tiles.ts
- verify: npm run build
- done: All terrain types and elevations render distinctly (fields, woods, villages, rivers, redoubts).

### T081 — Unit presentation
- status: done
- deps: [T029, T017]
- files: src/render/units.ts
- verify: npm run build
- done: Placeholder soldier sprites by power/post, facing, HP/Élan bars, condition icons, Honour indicator.

### T082 — Event-driven animations
- status: done
- deps: [T021, T081]
- files: src/render/animations.ts, tests/e2e/animations.spec.ts
- verify: npm run test:e2e -- tests/e2e/animations.spec.ts
- done: Movement, volleys, artillery and condition popups animate from engine events only.

### T083 — Orders Tempo tray
- status: done
- deps: [T019, T081]
- files: src/ui/TempoTray.tsx, src/ui/tempoOrder.ts, tests/e2e/tempoTray.spec.ts
- verify: npm run test:e2e -- tests/e2e/tempoTray.spec.ts
- done: Upcoming turn order is visualised.

### T084 — Menu suite
- status: done
- deps: [T052, T071, T075]
- files: src/ui/Menus.tsx, tests/e2e/menus.spec.ts
- verify: npm run test:e2e -- tests/e2e/menus.spec.ts
- done: Main, company, post, equipment, abilities, depot, mess and campaign-map menus.

### T085 — Targeting UX
- status: done
- deps: [T028, T030]
- files: src/render/overlay.ts, tests/e2e/targeting.spec.ts
- verify: npm run test:e2e -- tests/e2e/targeting.spec.ts
- done: Range/AoE highlight, danger zones, elevation preview.

### T086 — Battle forecast
- status: done
- deps: [T033, T037]
- files: src/ui/Forecast.tsx, tests/e2e/forecast.spec.ts
- verify: npm run test -- --run tests/unit/forecast.test.ts && npm run test:e2e -- tests/e2e/forecast.spec.ts
- done: Expected damage, hit chance and reaction risk before confirming.

### T087 — Keyboard & gamepad navigation
- status: done
- deps: [T084]
- files: src/app/input.ts
- verify: npm run test:e2e -- tests/e2e/input.spec.ts
- done: Full menu and battle navigation without a mouse; responsive layout.

---

## Phase 8 — Content pipeline & data

### T088 — Wiki → data converter
- status: done
- deps: [T008]
- files: scripts/wiki_to_data.mjs, scripts/wiki_to_data.d.mts
- verify: npm run test -- --run tests/unit/data.test.ts
- done: Converts scraped wiki tables (weapons/armour/abilities) into validated data, re-authored as our own balance.

### T089 — Ability sets per post
- status: done
- deps: [T047, T088]
- files: src/data/abilities/*.ts
- verify: npm run test -- --run tests/unit/data.test.ts
- done: Every post has a complete, validated action set.

### T090 — Equipment tables
- status: done
- deps: [T050, T088]
- files: src/data/equipment/*.ts
- verify: npm run test -- --run tests/unit/data.test.ts
- done: Full weapon/armour/accessory tables with Drill costs and taught abilities.

### T091 — Enemy roster + drops
- status: done
- deps: [T008, T047]
- files: src/data/enemies/*.ts
- verify: npm run test -- --run tests/unit/data.test.ts
- done: Irregular/auxiliary troop roster with stats, actions, drops and AI profiles.

### T092 — Battle maps
- status: done
- deps: [T014, T074]
- files: src/data/maps/*.json
- verify: npm run test -- --run tests/unit/maps.test.ts
- done: 10–20 varied battle maps with objectives.

### T093 — Article & contract pools
- status: done
- deps: [T054, T070]
- files: src/data/articles/*.ts, src/data/contracts/*.ts
- verify: npm run test -- --run tests/unit/data.test.ts
- done: Full Article-of-War card pool and contract list (main + side + dispatch + pacification).

### T094 — Content integrity test
- status: done
- deps: [T089, T090, T091, T092, T093]
- files: tests/unit/content.test.ts
- verify: npm run test -- --run tests/unit/content.test.ts
- done: All cross-references resolve; no dangling IDs; every def has a Napoleonic name.

---

## Phase 9 — AI

### T095 — Utility-based AI
- status: done
- deps: [T028, T041]
- files: src/ai/utility.ts
- verify: npm run test -- --run tests/unit/ai.test.ts
- done: Scores targets by expected damage, kill potential, threat and positioning; issues only legal commands.

### T096 — Article-aware AI
- status: done
- deps: [T095, T056]
- files: src/ai/utility.ts
- verify: npm run test -- --run tests/unit/ai.test.ts
- done: Avoids Article violations except for Commissioned units.

### T097 — Ability/item heuristics
- status: done
- deps: [T095]
- files: src/ai/heuristics.ts
- verify: npm run test -- --run tests/unit/ai.test.ts
- done: Sensible heal/buff/consumable and Élan management.

### T098 — Ally auto-battle
- status: done
- deps: [T095]
- files: src/app/autoBattle.ts
- verify: npm run test -- --run tests/unit/ai.test.ts
- done: Optional AI control for allied units.

### T099 — Difficulty tiers + perf
- status: done
- deps: [T095]
- files: src/ai/difficulty.ts
- verify: npm run test -- --run tests/unit/ai.test.ts
- done: Seeded aggression/mistake tiers; decision budget < 16 ms for a typical encounter.

---

## Phase 10 — Persistence & release

### T100 — SaveStore + IndexedDB
- status: done
- deps: [T005]
- files: src/persist/saveStore.ts
- verify: npm run test -- --run tests/unit/persist.test.ts
- done: A versioned `SaveStore` interface with an IndexedDB implementation and an in-memory test double.

### T101 — Save/load campaign
- status: done
- deps: [T068, T100]
- files: src/persist/campaign.ts
- verify: npm run test -- --run tests/unit/persist.test.ts
- done: Full company, map, contract and seed/history round-trip.

### T102 — Autosave, slots & export/import
- status: done
- deps: [T101]
- files: src/ui/Saves.tsx, src/ui/styles.css, tests/e2e/saves.spec.ts
- verify: npm run test:e2e -- tests/e2e/saves.spec.ts
- done: Autosave, multiple slots, JSON export/import.

### T103 — Settings
- status: done
- deps: [T100]
- files: src/ui/Settings.tsx, src/ui/settingsModel.ts, src/ui/styles.css, tests/e2e/settings.spec.ts
- verify: npm run test:e2e -- tests/e2e/settings.spec.ts
- done: Volume, text speed, damage numbers, colour-blind mode and keybinds.

### T104 — Error boundary + save migrations
- status: done
- deps: [T100]
- files: src/app/ErrorBoundary.tsx, src/persist/migrations.ts
- verify: npm run test -- --run tests/unit/persist.test.ts
- done: Graceful failures and versioned save migrations.

### T105 — Performance pass
- status: done
- deps: [T080, T081]
- files: src/render/atlas.ts
- verify: npm run build
- done: Texture atlas, lazy map loading, memory check.

### T106 — Deploy + how to play
- status: done
- deps: [T104]
- files: README.md, .github/workflows/deploy.yml
- verify: npm run build
- done: Static build deployed (Pages/Vercel/Netlify) with a player-facing how-to-play.

---

## Phase 11 — Audio, accessibility & polish

### T107 — Sound effects
- status: done
- deps: [T082]
- files: src/audio/sfx.ts
- verify: npm run build
- done: Royalty-free SFX for UI, volleys, guns and cards.

### T108 — Music
- status: done
- deps: [T107]
- files: src/audio/music.ts
- verify: npm run build
- done: Original/licensed music with volume mixing.

### T109 — Accessibility
- status: done
- deps: [T084]
- files: src/ui/a11y.ts, src/ui/App.tsx, src/ui/Settings.tsx, src/ui/styles.css, src/render/scene.ts, src/app/input.ts, tests/unit/a11y.test.ts, tests/e2e/a11y.spec.ts
- verify: npm run test -- --run tests/unit/a11y.test.ts && npm run test:e2e -- tests/e2e/a11y.spec.ts
- done: Keyboard nav, screen-reader labels, reduced-motion, colour-blind-safe palette.

### T110 — Tutorial mission
- status: done
- deps: [T071, T084]
- files: src/data/tutorial.ts, src/app/tutorial.ts, src/ui/Tutorial.tsx, src/ui/App.tsx, src/ui/styles.css, tests/unit/tutorial.test.ts, tests/e2e/tutorial.spec.ts
- verify: npm run test -- --run tests/unit/tutorial.test.ts && npm run test:e2e -- tests/e2e/tutorial.spec.ts
- done: Teaches move/act/tempo/Articles/Drill.

### T111 — i18n scaffolding
- status: done
- deps: [T010]
- files: src/i18n/index.ts, tests/unit/i18n.test.ts, src/ui/App.tsx
- verify: npm run test -- --run tests/unit/i18n.test.ts
- done: All UI strings via keys; no hard-coded copy.

### T116 — Adopt i18n keys across the remaining screens
- status: done
- deps: [T111]
- files: src/ui/Menus.tsx, src/ui/Mess.tsx, src/ui/Depot.tsx, src/ui/CampaignMap.tsx, src/ui/PostScreen.tsx, src/ui/Saves.tsx, src/ui/Settings.tsx, src/ui/Forecast.tsx, src/ui/TempoTray.tsx, src/ui/Tutorial.tsx, src/ui/a11y.ts
- verify: npm run test -- --run tests/unit/i18n.test.ts
- done: Every camp screen and the screen-reader descriptions resolve copy through `t()`; no user-facing literal remains in `src/ui`.

T111 built `src/i18n/index.ts` and moved the main shell (`src/ui/App.tsx`) onto
keys. This follow-up walks the rest of the presentation layer onto the same
catalog. Settings' option labels/notes currently live as data in
`src/ui/settingsModel.ts`, so those need keys or key references before the
screen can be fully keyed.

---

## Phase 12 — Multiplayer (stretch)

### T112 — Lockstep netcode
- status: done
- deps: [T023]
- files: src/net/lockstep.ts
- verify: npm run test -- --run tests/unit/lockstep.test.ts
- done: Deterministic command-log lockstep with state-hash desync detection.

### T113 — Lobby & matchmaking
- status: done
- deps: [T112]
- files: src/net/lobby.ts, tests/e2e/lobby.spec.ts
- verify: npm run test:e2e -- tests/e2e/lobby.spec.ts
- done: 1v1 skirmish between two free companies.

### T114 — Replays, trading & spectator
- status: done
- deps: [T112]
- files: src/net/replay.ts
- verify: npm run test -- --run tests/unit/replay.test.ts
- done: Replay a battle from seed + command log; trade kit and prisoners.

`src/net/replay.ts` builds on T112/T113: a `ReplayRecorder` captures lockstep
frames into a versioned `BattleReplay` (seed + setup + participants + frames),
`replayFinalState` re-runs the log through the pure `step` loop, and
`serializeReplay`/`parseReplay` round-trip it as validated text. A read-only
`BattleSpectator` walks or scrubs the log one command/frame at a time and
exposes state, events and hash. `resolveTrade` swaps **kit** (the
`DepotInventory` reserve) and **prisoners** (Auxiliary Barracks captives)
between two companies as pure values, with `tradeBlockers` reporting self/wrong
peer, empty, missing kit/prisoner, id-collision and overfull-pen reasons.

---

## Phase 13 — The campaign loop (playable game)

### T117 — Resolve ability effects through `step`
- status: done
- deps: [T041, T042, T043]
- files: src/engine/actions/resolve.ts, src/engine/battle.ts, tests/unit/combat.test.ts, tests/unit/determinism.test.ts
- verify: npm run test -- --run tests/unit/combat.test.ts tests/unit/determinism.test.ts
- done: An `act` committed through `step` applies its damage/healing/conditions via `executeAbility` (T041), runs reactions (T042) and support traits (T043), and yields byte-identical state for a fixed seed and command log.

`declareOrResolveAction` (`src/engine/actions/resolve.ts`) emits
`abilityUsed`/`abilityResolved` and spends Élan but never calls the executor —
see the "Ability effects are not wired into `step`" note under *Research & open
questions*. Nothing takes damage, so no objective can ever be met and T113's
headless skirmish ends in a ceasefire. Compose `executeAbility` into the
pipeline for both instant actions and `resolveCompletedCharges`, run reactions
and support traits, and emit the executor's events in order. Keep `step` pure
and deterministic: all randomness from the battle's seeded RNG. The
replay/determinism suite must stay byte-identical while a live `act` now reduces
HP and can KO.

### T118 — Deploy a battle from a contract
- status: done
- deps: [T117, T068, T070, T091, T092]
- files: src/app/battleSetup.ts, src/data/enemies/, src/data/maps/battleMaps.ts, tests/unit/battleSetup.test.ts
- verify: npm run test -- --run tests/unit/battleSetup.test.ts
- done: `buildBattleFromContract` returns a deterministic `BattleState` from a `Company`, a combat `ContractDef` and its `BattleMapDef`: the roster on the map's `company` tiles, authored enemies on its `enemy` tiles, the map's `objective`, and the company's learned actions; a combat contract with no map (or a map with no order of battle) fails loudly.

Battle maps already name a `contractId`, `deployment` and `objective`
(`src/data/maps/battleMaps.ts`), but nothing maps an `EnemyDef` to a tile and
nothing assembles a campaign battle. Author an **order of battle** per battle
map (a small data table keyed by map/contract id that binds enemy ids, levels
and deployment tiles), then write `src/app/battleSetup.ts` on top of
`createBattle`, `battleMapToTerrainMap` and the roster's derived stats
(T018/T051). No `Math.random`; the seed is a parameter. Follow the shape of the
existing `src/app/demoScenario.ts`.

### T119 — Deterministic enemy AI turn runner
- status: done
- deps: [T117, T095, T098]
- files: src/app/battleRunner.ts, tests/unit/battleRunner.test.ts
- verify: npm run test -- --run tests/unit/battleRunner.test.ts
- done: `runAiTurn(state, unitId)` plans the current non-company actor through `src/ai/utility.ts` and commits the resulting move/act commands through the same `step` path the player uses; `runAiUntilPlayer(state)` advances past consecutive AI actors, stops on a company actor or a finished battle, and is deterministic and loop-guarded.

`src/ai/utility.ts` already exposes `chooseTurn`/`chooseCommand` and
`src/app/autoBattle.ts` wraps them for allies, but the Field battle has no AI at
all: enemy turns never resolve, so a battle cannot reach its objective. Add
`src/app/battleRunner.ts` that drives enemy turns through `step` with the
command shapes `battleController` already uses. Reuse `autoBattleAllies` (T098)
if company allies should also be automated. Keep it pure and deterministic
(seeded RNG lives in state) and guard against a turn that never yields.

### T120 — Campaign progression: accept, outcome, day
- status: done
- deps: [T101, T118, T031, T055, T076]
- files: src/app/campaign.ts, tests/unit/campaignProgression.test.ts
- verify: npm run test -- --run tests/unit/campaignProgression.test.ts
- done: Pure functions over a `CampaignSave` accept a contract (pay the fee, mark it posted), apply a finished battle's outcome (Crowns/Drill/XP/kit rewards, Honour, casualties and removals), advance the day, rotate the daily Articles of War and append history — returning a new `CampaignSave` with no mutation and no randomness.

`CampaignSave` (T101) already bundles the company, map, calendar, depot,
progress and history, and the primitives exist (`advanceDay`,
`spendCrowns`/`addCrowns`, `awardHonours`, drill/XP from T048/T049,
`createCalendar` for the next day's Articles), but nothing applies a battle
result to the campaign. Write the reducer in `src/app/campaign.ts` using the
`src/persist` factories; it must never mutate its input. Cover a win with
rewards and an item, a loss with casualties, an objective failure, and a day
boundary that rotates the Articles.

### T121 — Wire the campaign loop into the app
- status: done
- deps: [T119, T120, T071, T102]
- files: src/app/campaignController.ts, src/ui/App.tsx, src/ui/Mess.tsx, tests/e2e/campaign.spec.ts
- verify: npm run test:e2e -- tests/e2e/campaign.spec.ts
- done: Taking a postable combat contract in the Officers' Mess launches its battle on the Field (player company vs. AI), the battle resolves to the map's objective outcome, rewards and the day advance are applied, the campaign autosaves, and the player sees a result summary; the seeded demo campaign stays deterministic for tests.

This is the missing glue named in the field report. Add
`src/app/campaignController.ts` owning the working `CampaignSave` plus the
active `BattleState`. Wire `src/ui/Mess.tsx`'s accept action to it, switch the
Field to `buildBattleFromContract`, resolve enemy turns with `battleRunner`, and
on `battleEnded` call the T120 reducer, autosave through `SaveStore` (T102) and
show the outcome. Do not change `src/engine`. Author `tests/e2e/campaign.spec.ts`:
Mess → take a contract → Field battle visible → commit an order → result summary
→ day advanced and Crowns changed. Prefer a short, deterministic objective
(e.g. a survive-N-turns board) so the spec is stable.

---

## Phase 14 — Battle-flow hardening (peer-engine review)

Refinements found by comparing three peer tactics engines (TinyWarsClient, The
Unseen Hand, fft-phaser); the full write-up and rationale live in
`docs/PEER_COMBAT_LESSONS.md`. Each task names the lesson (L#) it implements.
T122 and T123 are independent and should land first; T124 and T130 build on the
driver split.

### T122 — Deterministic, RNG-free Orders Tempo tie-break
- status: todo
- deps: [T019]
- files: src/engine/turn.ts, tests/unit/turn.test.ts, tests/unit/determinism.test.ts
- verify: npm run test -- --run
- done: `chooseActor` breaks a same-charge tie by a stable total order (charge desc, then unit id ascending) and consumes no randomness; turn order no longer depends on how many combat rolls preceded the tie, and every affected fixture/expectation is updated so the whole suite is green.

Peer lesson L1. Today `chooseActor` (`src/engine/turn.ts`) draws from the same
`OrdersTempo.rng` stream that `src/engine/actions/resolve.ts` uses for combat, so
the turn order changes if a combat roll is added or removed — a rules quantity
coupled to effect randomness. Compare `tieBreak` in The Unseen Hand's
`src/sim/scheduler.ts`, which is an explicit total order and consumes no RNG.
Replace the draw with charge desc then unit-id ascending, keep `OrdersTempo.rng`
for combat only, and add a crafted same-charge test asserting the id order.
Update the seeded-tie assertions in `tests/unit/turn.test.ts` ("breaks
same-charge ties with the seeded stream only") and `tests/unit/determinism.test.ts`
("lets the seed decide same-charge tie-breaks"). This is a cross-cutting
behaviour change, so run the full suite and fix every fixture it moves.

### T123 — Split `advanceToDecision` from `applyCommand`
- status: todo
- deps: [T022]
- files: src/engine/battle.ts, tests/unit/battle.test.ts
- verify: npm run test -- --run tests/unit/battle.test.ts tests/unit/determinism.test.ts tests/unit/battleRunner.test.ts
- done: `advanceToDecision(state)` advances the clock, resolves matured charges and skips out-of-action actors to surface the next living actor (or a terminal state); `applyCommand(state, command)` validates and applies exactly one command; `step` is a thin wrapper over the two and every existing state hash and behaviour is unchanged.

Peer lesson L2. `step` currently inlines three jobs (validate, apply, advance),
so AI lookahead and balance harnesses cannot reuse the “who acts next” logic.
Mirror The Unseen Hand's `advanceToDecision`/`applyCommand` split
(`src/sim/driver.ts`): expose both as pure functions from `src/engine/battle.ts`,
keep `step` as the ergonomic wrapper, and add tests that `advanceToDecision` is
idempotent at a decision point and that `step` still produces byte-identical
state for a fixed seed and command log.

### T124 — Fold an optional move clause into `ActCommand`
- status: todo
- deps: [T115, T123]
- files: src/engine/commands.ts, src/engine/battle.ts, tests/unit/battle.test.ts, tests/unit/move.test.ts
- verify: npm run test -- --run tests/unit/battle.test.ts tests/unit/move.test.ts tests/unit/determinism.test.ts
- done: an `act` command may carry an optional `move { to, order: "before" | "after" }` clause and settles the turn exactly once at one threshold; a folded move+act produces the same resulting state as the equivalent two-command `move` then `act` sequence, and `order` is required (never defaulted).

Peer lesson L3. Today a free move opens a turn via `hasMovedThisTurn` and a
second command must close it, so a half-open turn is representable. The Unseen
Hand folds both sub-phases into one `act` command with a required
`order: "before" | "after"` (`src/sim/driver.ts`). Add the optional clause to
`ActCommand` (`src/engine/commands.ts`), validate the move with the same
`validateMove` gate a standalone `move` uses, execute `before` (act resolves
from the destination) or `after` (act from the origin, then move), and settle
the Orders Tempo turn exactly once. Keep the two-step UI in
`src/app/battleController.ts`; this is an additive engine command shape.

### T125 — Tile-anchored charged abilities
- status: todo
- deps: [T024]
- files: src/engine/actions/resolve.ts, tests/unit/combat.test.ts, tests/unit/ability.test.ts
- verify: npm run test -- --run tests/unit/combat.test.ts tests/unit/ability.test.ts tests/unit/determinism.test.ts
- done: a charging action resolves against the tile/area recorded when it was declared, so a unit that leaves the tile dodges it; a charge whose caster is out of action or whose target tile holds no living unit whiffs without error; the behaviour is covered by tests.

Peer lesson L4. `pendingTargetOf` (`src/engine/actions/resolve.ts`) reconstructs a
unit-targeted charge as `{ kind: "unit", unitId }`, so a delayed single-target
action homes onto the named soldier's current position instead of the declared
grid. FFTA-family peers resolve delayed effects on the tile (The Unseen Hand:
“the occupant may walk off”), which is what makes charge timing a real tactical
risk. Make the labelled target tile authoritative for charged abilities, keep the
out-of-action caster cancellation already present, and pin the whiff case.

### T126 — Pin the RNG draw order per action
- status: todo
- deps: [T117]
- files: src/engine/actions/resolve.ts, tests/unit/determinism.test.ts
- verify: npm run test -- --run tests/unit/determinism.test.ts
- done: the order in which hit, crit, condition and reaction rolls consume the battle's seeded stream is documented next to the resolution pipeline and asserted by tests that count draws, including that a unit without a reaction consumes exactly the draws it did before.

Peer lesson L7. The shared stream is documented but the per-action draw order is
implicit, so adding one optional roll silently shifts every later effect. The
Unseen Hand writes the order down (hit → reaction trigger → reaction swing → crit
→ status) and tests exact consumption. Document ours in
`src/engine/actions/resolve.ts` and add draw-count assertions to
`tests/unit/determinism.test.ts`.

### T127 — Per-turn action budget (`hasActedThisTurn`)
- status: todo
- deps: [T115]
- files: src/engine/battle.ts, src/app/battleController.ts, tests/unit/battle.test.ts
- verify: npm run test -- --run tests/unit/battle.test.ts tests/unit/battleController.test.ts
- done: `BattleState` records both whether the current actor has moved and whether it has acted this turn; a second `move` is still rejected, a `face`/`hold`/`wait` does not consume the act slot, and both flags reset exactly once when the turn advances.

Peer lesson L6. Only `hasMovedThisTurn` exists; “acted” is implicit in ending the
turn, which makes free/extra actions (Volleys, reactions, future combo links)
hard to express. fft-phaser's `Unit` carries `hasMoved`/`hasActed`; The Unseen
Hand prices the turn from `didMove`/`didAct`. Add the second flag to
`BattleState`, keep the controller's two-step flow, and test reset timing.

### T128 — Resolution accounting helper + friendly-fire tripwire
- status: todo
- deps: [T117]
- files: src/engine/accounting.ts, src/engine/index.ts, tests/unit/accounting.test.ts
- verify: npm run test -- --run tests/unit/accounting.test.ts
- done: a pure `accountResolution(before, after, sourceUnitId)` reports damage dealt, healing, KOs and newly applied conditions by diffing two battle states; a reaction is credited to its reactor, not the attacker; unexpected same-team HP loss throws; the helper is deterministic and documented.

Peer lesson L9. The Unseen Hand's `hpDiffEvent` (`src/sim/driver.ts`) is the model:
credit by HP diff, give reactions their own credited event, and make a future
friendly-fire path fail loudly instead of silently mis-crediting. Add
`src/engine/accounting.ts`, export it from `src/engine/index.ts`, and use it later
from AI evaluation and battle reports. Nothing in `step` changes.

### T129 — Ordered `beginTurn`/`endTurn` upkeep pipeline
- status: todo
- deps: [T024, T040]
- files: src/engine/battle.ts, tests/unit/battle.test.ts, tests/unit/combat.test.ts
- verify: npm run test -- --run tests/unit/battle.test.ts tests/unit/combat.test.ts
- done: the per-Orders-Tempo-turn upkeep (charge spend, per-turn flag reset, condition ticks, Élan regeneration and objective scoring) runs through one explicit, ordered function, and a test pins the order.

Peer lesson L10/L14. Start-of-turn upkeep is scattered across `rules/`; order
matters and is currently implicit. Make it one named pipeline (fft-phaser runs
`ct -= 100` → `resetTurnFlags()` → `tickStatuses()` → `regenMp()`; TinyWars lists
its whole phase list). Keep it pure and deterministic and pin the sequence with a
test.

### T130 — Headless AI-vs-AI gauntlet for balance
- status: todo
- deps: [T119, T123]
- files: src/ai/gauntlet.ts, src/ai/index.ts, tests/unit/gauntlet.test.ts
- verify: npm run test -- --run tests/unit/gauntlet.test.ts
- done: `runGauntlet(setup, seed, policyA, policyB)` plays a full headless battle to a terminal state without touching render or UI, is deterministic and loop-guarded, and returns a summary (outcome, turns, units lost) that tests can assert.

Peer lesson L11. TinyWars runs a headless `fast` path and The Unseen Hand drives
AI-vs-AI battles as its balance harness. Build `src/ai/gauntlet.ts` on
`advanceToDecision`/`applyCommand` (T123) and the existing `src/ai/utility.ts` and
`src/app/autoBattle.ts`, wiring both sides to policies. No DOM, no `Math.random`;
the seed is a parameter.

### T131 — Charge bars in the Orders Tempo rail
- status: todo
- deps: [T083]
- files: src/ui/TempoTray.tsx, src/ui/tempoOrder.ts, tests/unit/tempoTray.test.ts
- verify: npm run test -- --run tests/unit/tempoTray.test.ts
- done: each Orders Tempo tray entry shows that soldier's current charge as a bar and the tray re-sorts after every `step`, derived from `chargeOf`/`previewTurns` with no new range or tempo math in the UI.

Peer lesson L13. The tray shows the projected order and Speed but not the charge
clock; fft-phaser's `TurnOrderPanel` paints a CT bar per unit. Extend the pure
projection in `src/ui/tempoOrder.ts` to carry charge and render it in
`src/ui/TempoTray.tsx`. Presentation only; the engine stays the source of truth.

### T132 — Deterministic `naiveAi` fallback
- status: todo
- deps: [T095]
- files: src/ai/naive.ts, src/ai/index.ts, tests/unit/ai.test.ts
- verify: npm run test -- --run tests/unit/ai.test.ts
- done: a small deterministic policy (if provoked, target the provoker; else use the best affordable action in range; else strike the weakest reachable foe; else advance toward the nearest foe; else wait) is available for fixtures and ally auto-battle, consumes no randomness, and emits the same command shapes the utility AI does.

Peer lesson L15. fft-phaser's ~40-line AI is inspectable and adequate for early
encounters and is a good “is the plumbing working” oracle. Add `src/ai/naive.ts`
and export it, keeping the utility AI (T095) as the default.

---

## Phase 15 — Battlefield HUD (per-character, FFT Blue style)

Model the battle screen on **FFT Blue** (<https://fft-blue.vercel.app/>, the
deployed `kuirsan26-lab/fft-phaser`): a hover/selection-anchored unit card
(`BattleScene.showUnitInfo`), a compact bottom command menu (`ui/ActionMenu.ts`),
a top turn-order rail (`ui/TurnOrderPanel.ts`) and a near-empty overlay
(`UIScene.ts`) — instead of our persistent `aside.hud` column. The information is
already in the HUD; the placement is the change. Preserve every existing
`data-testid` (the e2e suite is the contract) and update only the specs that
assert the old side-panel layout. Background and rationale:
`docs/PEER_COMBAT_LESSONS.md` (L12, L13, L16).

### T133 — Camera-aware projection + HUD anchor helper
- status: todo
- deps: []
- files: src/render/scene.ts, src/render/iso.ts, src/ui/unitHud.ts, tests/unit/unitHud.test.ts
- verify: npm run test -- --run tests/unit/unitHud.test.ts
- done: `Scene.project(at)` returns the screen position of a soldier's tile top-face through the live camera, and a pure `anchorFor(screen, viewport, size)` (new `src/ui/unitHud.ts`) returns `{ left, top, side }` with edge-flip and clamp; both are deterministic and covered by `tests/unit/unitHud.test.ts`.

The UI needs a soldier's screen position to place a card but must not reach into
`scene.camera` itself. Add a `project` method to the `Scene` interface
(`src/render/scene.ts`) built on `worldToScreen`/`toScreen` in
`src/render/iso.ts`, and a pure anchoring module in `src/ui/unitHud.ts` that
mirrors FFT Blue's `showUnitInfo` (`ix + w > width - 10 ? pos.x - w - 20 : pos.x + 20`,
clamp `top`). Update the anchor as the camera pans/zooms and as units move —
prefer a pixi-ticker/rAF subscription over a React render per frame.

### T134 — Per-character unit card anchored to the soldier
- status: todo
- deps: [T133]
- files: src/ui/App.tsx, src/ui/UnitCard.tsx, src/ui/StatChips.tsx, src/ui/styles.css
- verify: npm run test:e2e -- tests/e2e/input.spec.ts
- done: hovering or selecting a soldier — and the acting soldier — shows its `UnitCard` anchored beside it via `anchorFor`, edge-flipped and clamped, instead of in the fixed side-panel column; `hud-actor`, `unit-card`, `hud-selected` and `hud-chips` remain in the DOM and `input.spec.ts` passes.

Build on the in-progress `UnitCard.tsx`/`StatChips.tsx`/`unitLabels.ts` (commit
that WIP first). Reuse the existing hover/selection plumbing in `App.tsx`
(`controller.cursor`, `controller.selectedUnitId`) and the T133 projector, so the
same component serves the hovered, selected and acting soldier. Keep the
screen-reader text (`hud-selected`, `visually-hidden`) and the tooltip that
already carries the exact figures.

### T135 — Bottom command band and target-anchored forecast
- status: todo
- deps: [T133]
- files: src/ui/App.tsx, src/ui/Forecast.tsx, src/ui/styles.css
- verify: npm run test:e2e -- tests/e2e/forecast.spec.ts
- done: the action menu renders as a compact bottom command band during the command and move phases (FFT Blue's `ActionMenu`), and the forecast card appears near the target soldier instead of the side panel; `action-menu` and the forecast testids survive and `forecast.spec.ts` passes.

The menu is already `controller.actions`; only its placement changes — a
docked bottom band sized to its contents, with the same
tooltips/`data-testid`s (`action-${id}`, `order-info-${id}`). Move `Forecast`
next to the aimed-at soldier using T133's projector, keeping the existing
forecast testids so `forecast.spec.ts` stays the contract.

### T136 — World-space charge pip and status plate
- status: todo
- deps: []
- files: src/render/units.ts, src/render/scene.ts, tests/unit/units.test.ts
- verify: npm run test -- --run tests/unit/units.test.ts
- done: `unitPresentation`/`unitDrawOps` draw the soldier's Orders Tempo charge as a meter (alongside HP, Élan, Honour pips and condition icons), sourced from the engine's charge rather than a duplicate, and the drawing stays pure and unit-tested.

Only HP and Élan are on the world plate today (`HP_BAR`/`ELAN_BAR` in
`src/render/units.ts`); FFT Blue's readout also carries a CT bar in the rail. Add
an optional charge input (from `chargeOf`/`previewTurns`) so the world plate and
the T131 rail agree, and keep the function pure (`Unit` + numbers in, draw ops
out).

### T137 — Retire the side panel
- status: todo
- deps: [T134, T135, T136]
- files: src/ui/App.tsx, src/ui/styles.css
- verify: npm run test:e2e -- tests/e2e/animations.spec.ts
- done: the persistent `aside.hud` column is gone; the battle log sits behind a toggle and the remaining readouts are the anchored card, the bottom band, the world plate and the tempo rail; `animation-log` and `hud-phase` stay in the DOM and `animations.spec.ts` passes.

Final cleanup once T134–T136 have moved the content: delete the `aside.hud`
column, put the `animation-log` behind a details/toggle control (testid
`animation-log` preserved), and make the stage full-bleed. Sweep the e2e specs
(`skirmish`, `targeting`, `tutorial`, `tooltips`, `animations`) for layout
assumptions and update them — the `data-testid`s are the stable contract, the
pixel layout is not.

---

## Research & open questions

- [ ] Physical/magical damage formulas — documented (see `Attack_(command).md`, `Magic_(command).md`); only the ambiguous secondary line and the healing formula need decisions (T033/T036).
- [ ] FFTA MP regeneration — `MP_(stat).md` FFTA section is a stub; T040 authored a default schedule (`ELAN_REGEN_AMOUNT` every `ELAN_REGEN_INTERVAL_TICKS`) and morale thresholds, still pending a later balance pass.
- [ ] Exact Orders Tempo charge values, per-action tempo and Speed scaling (T019).
- [x] Drill-to-mastery thresholds per ability — authored as `EquipmentDef.teaches[].ap` and resolved by `src/engine/progression/drill.ts` (T048); a later balance pass may retune the per-item costs.
- [ ] Post-unlock thresholds (T046).
- [ ] Article generation frequency/pool and commended-action weighting (T055).
- [ ] Volley damage scaling with Honour and number of linkers (T061).
- [ ] FFTA-specific stat-growth formula (job tables give values + ranks) (T018/T049).
- [x] **Ability effects are wired into `step` (T117).** `declareOrResolveAction` (`src/engine/actions/resolve.ts`) now composes `executeAbility` (T041), reactions (T042) and support traits (T043) into both instant and charged resolution, drawing all randomness from the battle's seeded PRNG stream (`tempo.rng`). A live `act` reduces HP and can KO, so T113's headless skirmish reaches a decision instead of a ceasefire; replays stay byte-identical.
