/**
 * SaveStore — versioned persistence behind one small interface (T100).
 *
 * The engine is a pure, deterministic value (`agents.md` §2, §7), so a game can
 * be described as `seed + setup + command log` plus the campaign sandbox. All
 * that needs a home between sessions is a **JSON-safe payload** written to a
 * named **slot**. This module owns the boundary where that payload becomes a
 * durable record:
 *
 * ```
 *   SaveStore.save(slot, data)  ──►  { version, savedAt, label, data }
 *   SaveStore.load(slot)        ──►  the envelope (or null when the slot is empty)
 *   SaveStore.list()            ──►  slot metadata, newest first
 *   SaveStore.remove(slot)      ──►  whether something was deleted
 *   SaveStore.clear()           ──►  wipe every slot
 * ```
 *
 * Two implementations ship here:
 *
 * - {@link createIndexedDbSaveStore} — the browser backend. A single
 *   `lines-of-glory` database with one `saves` object store, opened lazily and
 *   reused. The `IDBFactory` is injectable so the backend can be exercised in
 *   Node tests with a fake (the runtime default is `globalThis.indexedDB`).
 * - {@link createMemorySaveStore} — an in-memory test double. It satisfies the
 *   same contract, so the campaign save logic (T101) can be tested without a
 *   browser.
 *
 * ## Versioning
 *
 * Every record carries the {@link SAVE_FORMAT_VERSION} it was written with and
 * the epoch-millisecond timestamp it was written at ({@link SaveEnvelope}).
 * `load` returns older records untouched and rejects ones from the **future**
 * ({@link SaveStoreError} code `version`): a build must never guess at a shape
 * it does not know. Migrating old records forward lives in `migrations.ts`
 * (T104); the store simply reports the version it read.
 *
 * Contract (`agents.md` §2, §3, §7, §9):
 * - **Edge layer.** `src/persist` may talk to the DOM; the engine
 *   (`src/engine`) stays framework-free. Nothing here imports from the engine.
 * - **Serialisable payloads.** Saves must survive `structuredClone`/JSON, the
 *   same shape a replay or a network message needs.
 * - **Trust boundary.** Slots, envelopes and versions are validated on the way
 *   in and out, so a corrupt or hostile record fails loudly with a
 *   {@link SaveStoreError} instead of poisoning a campaign.
 */

/* --------------------------------------------------------------------------
 * Constants
 * ------------------------------------------------------------------------ */

/** Current save-format version. Bump when the persisted shape changes (T104). */
export const SAVE_FORMAT_VERSION = 1;

/** IndexedDB database name used by the default browser backend. */
export const SAVE_STORE_DB_NAME = "lines-of-glory";

/** IndexedDB object-store name that holds the save slots. */
export const SAVE_STORE_STORE_NAME = "saves";

/** IndexedDB schema version (object stores/indexes), independent of save format. */
export const SAVE_STORE_DB_VERSION = 1;

/** Conventional slot name for the rolling autosave (T102). */
export const AUTOSAVE_SLOT = "autosave";

/* --------------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------------ */

/** A persisted save: its format version, write time, label and payload. */
export interface SaveEnvelope<T = unknown> {
  /** {@link SAVE_FORMAT_VERSION} the payload was written with. */
  readonly version: number;
  /** Epoch milliseconds when the slot was written. */
  readonly savedAt: number;
  /** Human-readable label for the slot list; defaults to the slot name. */
  readonly label: string;
  /** The game payload. Must be JSON-safe / structured-cloneable. */
  readonly data: T;
}

/** Lightweight metadata for one slot, as returned by {@link SaveStore.list}. */
export interface SaveSlotInfo {
  readonly slot: string;
  readonly version: number;
  readonly savedAt: number;
  readonly label: string;
}

/** Per-write options for {@link SaveStore.save}. */
export interface SaveOptions {
  /** Overrides the slot name shown in the save list. */
  readonly label?: string;
}

/** Construction options shared by every backend. */
export interface SaveStoreOptions {
  /** Format version stamped onto new records; defaults to {@link SAVE_FORMAT_VERSION}. */
  readonly version?: number;
  /** Clock used for `savedAt`; defaults to `Date.now`. Injectable for tests. */
  readonly now?: () => number;
}

/** Options for the IndexedDB backend. */
export interface IndexedDbSaveStoreOptions extends SaveStoreOptions {
  /** Database name; defaults to {@link SAVE_STORE_DB_NAME}. */
  readonly databaseName?: string;
  /** Object-store name; defaults to {@link SAVE_STORE_STORE_NAME}. */
  readonly storeName?: string;
  /** Overrides `globalThis.indexedDB` (used by tests). */
  readonly factory?: IDBFactory;
}

/** The persistent-slot contract the rest of the app programs against. */
export interface SaveStore {
  /** Which implementation backs this store. */
  readonly backend: "memory" | "indexeddb";
  /** Format version new records are written with. */
  readonly version: number;
  /** Write `data` to `slot`, replacing any existing record. */
  save<T>(slot: string, data: T, options?: SaveOptions): Promise<SaveEnvelope<T>>;
  /** Read `slot`, or `null` when it is empty. Newer-format records throw. */
  load<T = unknown>(slot: string): Promise<SaveEnvelope<T> | null>;
  /** Whether `slot` holds a record. */
  has(slot: string): Promise<boolean>;
  /** Delete `slot`; resolves `true` when a record was removed. */
  remove(slot: string): Promise<boolean>;
  /** Metadata for every slot, newest first (ties broken by slot name). */
  list(): Promise<SaveSlotInfo[]>;
  /** Delete every slot. */
  clear(): Promise<void>;
  /** Release any backend resources (closes the IndexedDB connection). */
  close(): Promise<void>;
}

/** Machine-readable cause for a {@link SaveStoreError}. */
export type SaveStoreErrorCode =
  | "unavailable"
  | "invalid-slot"
  | "version"
  | "corrupt"
  | "backend";

/** Thrown when a slot cannot be read or written. */
export class SaveStoreError extends Error {
  readonly code: SaveStoreErrorCode;

  constructor(code: SaveStoreErrorCode, message: string) {
    super(message);
    this.name = "SaveStoreError";
    this.code = code;
  }
}

/* --------------------------------------------------------------------------
 * Validation & helpers
 * ------------------------------------------------------------------------ */

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A slot must be a non-empty, non-blank string. */
function assertSlot(slot: string): string {
  if (typeof slot !== "string" || slot.trim().length === 0) {
    throw new SaveStoreError("invalid-slot", "save slot must be a non-empty string");
  }
  return slot;
}

/** A format version must be a positive integer. */
function resolveVersion(version: number | undefined): number {
  const resolved = version ?? SAVE_FORMAT_VERSION;
  if (!Number.isInteger(resolved) || resolved < 1) {
    throw new SaveStoreError("version", "save format version must be a positive integer");
  }
  return resolved;
}

/** Deep-copy a JSON-compatible value so stored data cannot alias the caller's. */
function cloneValue<T>(value: T): T {
  try {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value)) as T;
  } catch (error) {
    throw new SaveStoreError("corrupt", `save data is not cloneable: ${describe(error)}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether `value` looks like a {@link SaveEnvelope}. */
function isSaveEnvelope(value: unknown): value is SaveEnvelope<unknown> {
  if (!isRecord(value)) return false;
  return (
    typeof value.version === "number" &&
    Number.isInteger(value.version) &&
    value.version >= 1 &&
    typeof value.savedAt === "number" &&
    Number.isFinite(value.savedAt) &&
    typeof value.label === "string" &&
    "data" in value
  );
}

/** Strip foreign properties so only the envelope's own fields survive a load. */
function normalizeEnvelope(envelope: SaveEnvelope<unknown>): SaveEnvelope<unknown> {
  return {
    version: envelope.version,
    savedAt: envelope.savedAt,
    label: envelope.label,
    data: envelope.data,
  };
}

/* --------------------------------------------------------------------------
 * Backend seam (shared by both implementations)
 * ------------------------------------------------------------------------ */

/**
 * The minimal keyed record store the {@link SaveStore} contract is built on.
 * Keeping this tiny means the two backends share all versioning/validation
 * logic and only differ in where bytes live.
 */
interface SaveBackend {
  read(slot: string): Promise<SaveEnvelope<unknown> | null>;
  write(slot: string, envelope: SaveEnvelope<unknown>): Promise<void>;
  remove(slot: string): Promise<boolean>;
  keys(): Promise<string[]>;
  clear(): Promise<void>;
  close(): Promise<void>;
}

/** Build the public {@link SaveStore} around a backend, adding the version logic. */
function buildSaveStore(
  backend: SaveBackend,
  kind: SaveStore["backend"],
  options: SaveStoreOptions,
): SaveStore {
  const version = resolveVersion(options.version);
  const now = options.now ?? Date.now;

  return {
    backend: kind,
    version,

    async save<T>(slot: string, data: T, options: SaveOptions = {}): Promise<SaveEnvelope<T>> {
      const key = assertSlot(slot);
      const label =
        typeof options.label === "string" && options.label.trim().length > 0
          ? options.label
          : key;
      const envelope: SaveEnvelope<T> = {
        version,
        savedAt: now(),
        label,
        data: cloneValue(data),
      };
      await backend.write(key, envelope as SaveEnvelope<unknown>);
      return envelope;
    },

    async load<T = unknown>(slot: string): Promise<SaveEnvelope<T> | null> {
      const key = assertSlot(slot);
      const stored = await backend.read(key);
      if (stored === null) return null;
      if (!isSaveEnvelope(stored)) {
        throw new SaveStoreError("corrupt", `save slot "${key}" is not a valid save record`);
      }
      if (stored.version > version) {
        throw new SaveStoreError(
          "version",
          `save slot "${key}" was written by format v${stored.version}; this build reads up to v${version}`,
        );
      }
      return normalizeEnvelope(stored) as SaveEnvelope<T>;
    },

    async has(slot: string): Promise<boolean> {
      return (await backend.read(assertSlot(slot))) !== null;
    },

    async remove(slot: string): Promise<boolean> {
      return backend.remove(assertSlot(slot));
    },

    async list(): Promise<SaveSlotInfo[]> {
      const keys = await backend.keys();
      const infos: SaveSlotInfo[] = [];
      for (const key of keys) {
        const stored = await backend.read(key);
        if (stored === null || !isSaveEnvelope(stored)) continue;
        infos.push({
          slot: key,
          version: stored.version,
          savedAt: stored.savedAt,
          label: stored.label,
        });
      }
      infos.sort(
        (a, b) =>
          b.savedAt - a.savedAt || (a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0),
      );
      return infos;
    },

    async clear(): Promise<void> {
      await backend.clear();
    },

    async close(): Promise<void> {
      await backend.close();
    },
  };
}

/* --------------------------------------------------------------------------
 * In-memory backend (tests / SSR)
 * ------------------------------------------------------------------------ */

/**
 * An in-memory {@link SaveStore}. Same semantics as the browser backend, but
 * nothing is persisted and no DOM is touched, so it is the default double in
 * unit tests and a harmless fallback where IndexedDB is unavailable.
 */
export function createMemorySaveStore(options: SaveStoreOptions = {}): SaveStore {
  const records = new Map<string, SaveEnvelope<unknown>>();

  const backend: SaveBackend = {
    async read(slot) {
      const stored = records.get(slot);
      return stored === undefined ? null : cloneValue(stored);
    },
    async write(slot, envelope) {
      records.set(slot, cloneValue(envelope));
    },
    async remove(slot) {
      return records.delete(slot);
    },
    async keys() {
      return [...records.keys()];
    },
    async clear() {
      records.clear();
    },
    async close() {
      // Nothing to release.
    },
  };

  return buildSaveStore(backend, "memory", options);
}

/* --------------------------------------------------------------------------
 * IndexedDB backend (browser)
 * ------------------------------------------------------------------------ */

/** A record as physically stored: the envelope plus the object-store key. */
type StoredSave = SaveEnvelope<unknown> & { readonly slot: string };

/** Wrap an `IDBRequest` in a promise, mapping failures to a `SaveStoreError`. */
function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        new SaveStoreError(
          "backend",
          `IndexedDB request failed: ${request.error?.message ?? "unknown error"}`,
        ),
      );
  });
}

/** Open (and, on first run, create) the save database. */
function openDatabase(
  factory: IDBFactory,
  databaseName: string,
  storeName: string,
): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    let openRequest: IDBOpenDBRequest;
    try {
      openRequest = factory.open(databaseName, SAVE_STORE_DB_VERSION);
    } catch (error) {
      reject(
        new SaveStoreError("backend", `could not open IndexedDB database: ${describe(error)}`),
      );
      return;
    }

    openRequest.onupgradeneeded = () => {
      const database = openRequest.result;
      if (!database.objectStoreNames.contains(storeName)) {
        database.createObjectStore(storeName, { keyPath: "slot" });
      }
    };
    openRequest.onsuccess = () => {
      const database = openRequest.result;
      // Another tab upgrading the schema must be allowed to proceed.
      database.onversionchange = () => database.close();
      resolve(database);
    };
    openRequest.onerror = () =>
      reject(
        new SaveStoreError(
          "backend",
          `could not open IndexedDB database: ${openRequest.error?.message ?? "unknown error"}`,
        ),
      );
    openRequest.onblocked = () =>
      reject(
        new SaveStoreError(
          "backend",
          "could not open IndexedDB database: blocked by another connection",
        ),
      );
  });
}

/**
 * The browser {@link SaveStore} backed by IndexedDB. The connection is opened
 * lazily on first use and reused until {@link SaveStore.close}.
 */
export function createIndexedDbSaveStore(options: IndexedDbSaveStoreOptions = {}): SaveStore {
  const factory =
    options.factory ?? (typeof indexedDB === "undefined" ? undefined : indexedDB);
  if (factory === undefined) {
    throw new SaveStoreError(
      "unavailable",
      "IndexedDB is not available in this environment; use createMemorySaveStore instead",
    );
  }

  const databaseName = options.databaseName ?? SAVE_STORE_DB_NAME;
  const storeName = options.storeName ?? SAVE_STORE_STORE_NAME;

  let databasePromise: Promise<IDBDatabase> | null = null;
  const open = (): Promise<IDBDatabase> => {
    if (databasePromise === null) {
      databasePromise = openDatabase(factory, databaseName, storeName).catch((error: unknown) => {
        // Do not cache a failed connection; the next call may succeed.
        databasePromise = null;
        throw error;
      });
    }
    return databasePromise;
  };

  const backend: SaveBackend = {
    async read(slot) {
      const database = await open();
      const stored = await requestResult<StoredSave | undefined>(
        database.transaction(storeName, "readonly").objectStore(storeName).get(slot),
      );
      return stored ?? null;
    },
    async write(slot, envelope) {
      const database = await open();
      await requestResult(
        database
          .transaction(storeName, "readwrite")
          .objectStore(storeName)
          .put({ slot, ...envelope }),
      );
    },
    async remove(slot) {
      const database = await open();
      const key = await requestResult<IDBValidKey | undefined>(
        database.transaction(storeName, "readonly").objectStore(storeName).getKey(slot),
      );
      if (key === undefined) return false;
      await requestResult(
        database.transaction(storeName, "readwrite").objectStore(storeName).delete(slot),
      );
      return true;
    },
    async keys() {
      const database = await open();
      const stored = await requestResult<StoredSave[]>(
        database.transaction(storeName, "readonly").objectStore(storeName).getAll(),
      );
      return stored.map((record) => record.slot);
    },
    async clear() {
      const database = await open();
      await requestResult(
        database.transaction(storeName, "readwrite").objectStore(storeName).clear(),
      );
    },
    async close() {
      if (databasePromise === null) return;
      const database = await databasePromise.catch(() => null);
      database?.close();
      databasePromise = null;
    },
  };

  return buildSaveStore(backend, "indexeddb", options);
}

/** Whether the current environment exposes IndexedDB. */
export function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}
