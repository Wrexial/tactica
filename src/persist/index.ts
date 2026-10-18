/**
 * Persistence layer (T100+). Save/load behind the versioned
 * {@link SaveStore} interface, with an IndexedDB browser backend and an
 * in-memory test double (`saveStore.ts`), plus the campaign snapshot format and
 * its JSON/SaveStore round-trips (`campaign.ts`, T101).
 */
export * from "./saveStore";
export * from "./campaign";
