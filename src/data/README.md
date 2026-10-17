# `src/data/` — authored content

All game content is **data, not code**. Adding a post, ability, weapon, enemy,
article or contract should rarely mean touching the engine. This directory
holds the authored definitions and the Zod schemas that validate them.

> Read `agents.md` §2 (data-driven content), §8 (naming / glossary) and
> `docs/NAPOLEONIC_MAPPING.md` before adding content.

## Files

| File        | Purpose                                                                 |
| ----------- | ----------------------------------------------------------------------- |
| `schema.ts` | Zod schemas + inferred types for every content kind. **Start here.**    |
| `index.ts`  | Re-exports the schema surface for consumers.                            |
| `maps/`     | Locations + battle maps (schemas, layout expander, authored tables).    |
| `equipment/`| Authored kit split by slot (weapons, armour, accessories) + registry.    |
| `abilities/`| Authored action/reaction/trait/volley catalogue per power.               |
| `*.ts`      | Content collections, added in later phases (posts, enemies, ...).        |

Later tasks populate the collections named in the schema bundle:

| Collection             | Authored in | Task  |
| ---------------------- | ----------- | ----- |
| `posts` (roles)        | Phase 4     | T046+ |
| `equipment` (kit)      | Phase 4     | T050+ |
| `abilities`            | Phase 8     | T089+ |
| `enemies` (irregulars) | Phase 8     | T091+ |
| `articles`             | Phase 5/8   | T054+ |
| `contracts`            | Phase 6/8   | T070+ |
| `elements`             | Phase 3     | T038  |
| `conditions`           | Phase 3     | T039  |
| `locations` / `maps`   | Phase 6     | T074+ |

## Naming convention (the important part)

The retheme is a **skin over preserved FFTA mechanics**, so the schema keeps
the two layers apart:

- **Type names are rethemed** — `PostDef`, not `JobDef`; `ArticleDef`, not
  `LawDef`. Code reads like *Lines of Glory*.
- **Mechanical keys stay FFTA-shaped** — `mpCost`, `ap`, `power`, `range`,
  `chargeTime`, `element`, `slot`, `growth`, `skillsetId`. A developer who knows
  FFTA can read our data, and the engine formulas map 1:1 to the reference.
- **Display fields carry the fiction** — every definition has `name`
  (Napoleonic label, e.g. *Rifleman*), `description` (mechanical rules text)
  and `flavour` (in-world prose). Never put period names into ids.

Examples:

| FFTA concept | id key (stable)          | `name` (display)          |
| ------------ | ------------------------ | ------------------------- |
| Fire         | `fire`                   | Incendiary                |
| Holy         | `holy`                   | Colours                   |
| Poison       | `poison`                 | Bleeding                  |
| MP           | `mp` / `mpCost`          | Élan                      |
| AP           | `ap`                     | Drill                     |
| JP           | `honour`                 | Honour                    |
| Job          | `postId`                 | Post (e.g. Fusilier)      |

## Validation model

Schemas are pure Zod validators — no side effects. Parse content at load/test
time and fail loudly on bad data:

```ts
import { PostDefSchema, DataBundleSchema } from "./schema";

const post = PostDefSchema.parse(raw);
const bundle = DataBundleSchema.parse(loaded);
```

- Required fields are non-empty; display strings are `.min(1)` (see T009's
  integrity test for the `TBD` sweep).
- Sensible defaults (`mpCost: 0`, `aoeShape: "single"`, ...) keep hand-authored
  content terse.
- Ids are non-empty strings here; the engine brands them in `src/engine/ids.ts`
  (T012) so the data layer stays free of engine imports.

## Collection-specific schemas

Not every schema belongs in `schema.ts`. Collections that own a rich,
self-contained shape keep their Zod schema beside their data (see
`weapons.ts`, `guards.ts` and `maps/schema.ts`), importing only the shared
primitives (`IdSchema`, `DisplayFields`, ...) from `./schema`. This keeps
`schema.ts` focused on the cross-cutting vocabulary.

One deliberate exception to "no duplicate vocabulary": `maps/schema.ts`
restates the engine's terrain key set (`TERRAIN_KEYS`) because `src/data/` may
not import `src/engine/`. `tests/unit/maps.test.ts` pins the two lists
together, so the mirror cannot silently drift.

## Determinism & layering

- No `Math.random`, no `Date.now`, no DOM. Content is static data.
- `src/data/` may be imported by the engine, AI, app, UI and render layers, but
  it must never import from them.
- Balance numbers are **ours**, inspired by the scraped reference — cite the
  page in a comment when a value comes from `docs/wiki/`.
