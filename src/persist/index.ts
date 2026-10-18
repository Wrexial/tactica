/**
 * Persistence layer (T100+). Save/load behind the versioned
 * {@link SaveStore} interface, with an IndexedDB browser backend and an
 * in-memory test double. See `src/persist/saveStore.ts`.
 */
export * from "./saveStore";
