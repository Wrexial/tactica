/**
 * Battle-map & location content (T074) — the public surface of `src/data/maps`.
 *
 * Consumers import from here (`import { BATTLE_MAPS, LOCATIONS, ... }`) rather
 * than reaching into the individual modules. The schemas, authored tables,
 * lookups and the layout expander are all re-exported so the engine and the
 * campaign layer have a single import path.
 *
 * Reference: `docs/NAPOLEONIC_MAPPING.md` §10 (world map / area tokens →
 * Campaign Map + Markers; shops, depots and regions) and §12 (Height →
 * Elevation, on a square-isometric grid, D10).
 */

export * from "./schema";
export * from "./layout";
export * from "./locations";
export * from "./battleMaps";
