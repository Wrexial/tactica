import { describe, expect, it } from "vitest";

import {
  AUTOSAVE_SLOT,
  SAVE_FORMAT_VERSION,
  SaveStoreError,
  createIndexedDbSaveStore,
  createMemorySaveStore,
  isIndexedDbAvailable,
} from "../../src/persist/saveStore";

/* --------------------------------------------------------------------------
 * T100 — SaveStore + IndexedDB
 *
 * Pins the task's "done when": a **versioned** `SaveStore` interface, an
 * **IndexedDB** implementation and an **in-memory test double**.
 *
 * The in-memory double is exercised directly; the IndexedDB backend is driven
 * through a tiny fake `IDBFactory` below, so the async connection/transaction
 * plumbing is covered in Node without a browser or an `idb-keyval`-style
 * dependency.
 * ------------------------------------------------------------------------ */

/* --------------------------------------------------------------------------
 * Minimal fake IndexedDB (only the surface saveStore.ts touches)
 * ------------------------------------------------------------------------ */

type Handler = () => void;

class FakeRequest<T> {
  result: T | undefined;
  onsuccess: Handler | null = null;
  onerror: Handler | null = null;
  onupgradeneeded: Handler | null = null;
}

class FakeObjectStore {
  constructor(
    private readonly records: Map<string, Record<string, unknown>>,
    private readonly keyPath: string,
  ) {}

  put(value: Record<string, unknown>): FakeRequest<string> {
    const request = new FakeRequest<string>();
    queueMicrotask(() => {
      const key = String(value[this.keyPath]);
      this.records.set(key, value);
      request.result = key;
      request.onsuccess?.();
    });
    return request;
  }

  get(key: string): FakeRequest<unknown> {
    const request = new FakeRequest<unknown>();
    queueMicrotask(() => {
      request.result = this.records.get(key);
      request.onsuccess?.();
    });
    return request;
  }

  getKey(key: string): FakeRequest<string | undefined> {
    const request = new FakeRequest<string | undefined>();
    queueMicrotask(() => {
      request.result = this.records.has(key) ? key : undefined;
      request.onsuccess?.();
    });
    return request;
  }

  delete(key: string): FakeRequest<undefined> {
    const request = new FakeRequest<undefined>();
    queueMicrotask(() => {
      this.records.delete(key);
      request.result = undefined;
      request.onsuccess?.();
    });
    return request;
  }

  getAll(): FakeRequest<Record<string, unknown>[]> {
    const request = new FakeRequest<Record<string, unknown>[]>();
    queueMicrotask(() => {
      request.result = [...this.records.values()];
      request.onsuccess?.();
    });
    return request;
  }

  clear(): FakeRequest<undefined> {
    const request = new FakeRequest<undefined>();
    queueMicrotask(() => {
      this.records.clear();
      request.result = undefined;
      request.onsuccess?.();
    });
    return request;
  }
}

class FakeDatabase {
  private readonly stores = new Map<string, Map<string, Record<string, unknown>>>();
  readonly objectStoreNames = { contains: (name: string) => this.stores.has(name) };
  onversionchange: Handler | null = null;

  createObjectStore(name: string): void {
    this.stores.set(name, new Map());
  }

  transaction(name: string): { objectStore: (storeName: string) => FakeObjectStore } {
    let records = this.stores.get(name);
    if (records === undefined) {
      records = new Map();
      this.stores.set(name, records);
    }
    const target = records;
    return { objectStore: () => new FakeObjectStore(target, "slot") };
  }

  close(): void {
    // Nothing to release in the fake.
  }
}

class FakeIndexedDbFactory {
  private readonly databases = new Map<string, FakeDatabase>();

  open(name: string): FakeRequest<FakeDatabase> {
    const request = new FakeRequest<FakeDatabase>();
    queueMicrotask(() => {
      const existing = this.databases.get(name);
      if (existing !== undefined) {
        request.result = existing;
      } else {
        const database = new FakeDatabase();
        request.result = database;
        request.onupgradeneeded?.();
        this.databases.set(name, database);
      }
      request.onsuccess?.();
    });
    return request;
  }
}

function fakeFactory(): IDBFactory {
  return new FakeIndexedDbFactory() as unknown as IDBFactory;
}

/* --------------------------------------------------------------------------
 * In-memory backend
 * ------------------------------------------------------------------------ */

describe("createMemorySaveStore", () => {
  it("round-trips a payload and stamps version, label and clock", async () => {
    const store = createMemorySaveStore({ now: () => 1_700_000_000_000 });
    const saved = await store.save("alpha", { crowns: 12 }, { label: "First Company" });

    expect(saved).toEqual({
      version: SAVE_FORMAT_VERSION,
      savedAt: 1_700_000_000_000,
      label: "First Company",
      data: { crowns: 12 },
    });
    await expect(store.load<{ crowns: number }>("alpha")).resolves.toEqual(saved);
  });

  it("defaults the label to the slot and clones stored data", async () => {
    const store = createMemorySaveStore();
    const payload = { soldiers: [{ name: "Rifleman" }] };
    const saved = await store.save(AUTOSAVE_SLOT, payload);

    expect(saved.label).toBe(AUTOSAVE_SLOT);

    // Mutating the caller's object must not reach the stored record...
    payload.soldiers[0]!.name = "Lancer";
    const loaded = await store.load<typeof payload>(AUTOSAVE_SLOT);
    expect(loaded?.data).toEqual({ soldiers: [{ name: "Rifleman" }] });

    // ...nor must mutating a previously returned envelope reach the store.
    saved.data.soldiers.push({ name: "Dragoon" });
    expect((await store.load<typeof payload>(AUTOSAVE_SLOT))?.data).toEqual({
      soldiers: [{ name: "Rifleman" }],
    });
  });

  it("reports empty slots through load and has", async () => {
    const store = createMemorySaveStore();
    await expect(store.load("missing")).resolves.toBeNull();
    expect(await store.has("missing")).toBe(false);
    await store.save("present", 1);
    expect(await store.has("present")).toBe(true);
  });

  it("lists slots newest-first, breaking ties by name", async () => {
    let clock = 100;
    const store = createMemorySaveStore({ now: () => clock++ });
    await store.save("first", 1);
    await store.save("second", 2);
    await store.save("third", 3);

    const listed = await store.list();
    expect(listed.map((info) => info.slot)).toEqual(["third", "second", "first"]);
    expect(listed[0]).toEqual({
      slot: "third",
      version: SAVE_FORMAT_VERSION,
      savedAt: 102,
      label: "third",
    });
  });

  it("removes one slot and clears them all", async () => {
    const store = createMemorySaveStore();
    await store.save("a", 1);
    await store.save("b", 2);

    expect(await store.remove("a")).toBe(true);
    expect(await store.remove("a")).toBe(false);
    expect(await store.has("a")).toBe(false);
    expect(await store.has("b")).toBe(true);

    await store.clear();
    await expect(store.list()).resolves.toEqual([]);
    expect(await store.has("b")).toBe(false);
  });

  it("rejects blank slots and invalid format versions", async () => {
    const store = createMemorySaveStore();
    await expect(store.save("", {})).rejects.toMatchObject({ code: "invalid-slot" });
    await expect(store.save("   ", {})).rejects.toBeInstanceOf(SaveStoreError);
    await expect(store.load("")).rejects.toMatchObject({ code: "invalid-slot" });
    await expect(store.remove("")).rejects.toMatchObject({ code: "invalid-slot" });

    expect(() => createMemorySaveStore({ version: 0 })).toThrow(SaveStoreError);
    expect(() => createMemorySaveStore({ version: 1.5 })).toThrow(SaveStoreError);
  });

  it("closes cleanly", async () => {
    const store = createMemorySaveStore();
    await expect(store.close()).resolves.toBeUndefined();
    expect(store.backend).toBe("memory");
  });
});

/* --------------------------------------------------------------------------
 * IndexedDB backend
 * ------------------------------------------------------------------------ */

describe("createIndexedDbSaveStore", () => {
  it("round-trips a save through the object store", async () => {
    const store = createIndexedDbSaveStore({ factory: fakeFactory(), now: () => 500 });
    const saved = await store.save("slot-a", { gold: 7 }, { label: "Alpha" });

    expect(saved).toEqual({
      version: SAVE_FORMAT_VERSION,
      savedAt: 500,
      label: "Alpha",
      data: { gold: 7 },
    });
    await expect(store.load<{ gold: number }>("slot-a")).resolves.toEqual(saved);
    expect(await store.has("slot-a")).toBe(true);
    expect(store.backend).toBe("indexeddb");

    await store.close();
  });

  it("lists, removes and clears stored slots", async () => {
    const store = createIndexedDbSaveStore({ factory: fakeFactory(), now: () => 42 });
    await store.save("one", 1);
    await store.save("two", 2);

    expect((await store.list()).map((info) => info.slot)).toEqual(["one", "two"]);
    expect(await store.remove("one")).toBe(true);
    expect(await store.remove("one")).toBe(false);
    expect((await store.list()).map((info) => info.slot)).toEqual(["two"]);

    await store.clear();
    await expect(store.list()).resolves.toEqual([]);
    await store.close();
  });

  it("rejects a record written by a newer save format", async () => {
    const factory = fakeFactory();

    const writer = createIndexedDbSaveStore({ factory, version: 2 });
    await writer.save("future", { from: "v2" });
    await writer.close();

    const reader = createIndexedDbSaveStore({ factory, version: 1 });
    await expect(reader.load("future")).rejects.toMatchObject({ code: "version" });

    // Older-than-current records load untouched so migrations (T104) can run.
    await reader.save("current", { from: "v1" });
    await expect(reader.load("current")).resolves.toMatchObject({ version: 1 });
    await reader.close();
  });

  it("uses a named database and store", async () => {
    const factory = fakeFactory();
    const store = createIndexedDbSaveStore({
      factory,
      databaseName: "custom-db",
      storeName: "custom-saves",
      now: () => 1,
    });
    await store.save("only", true);
    expect(await store.load("only")).toMatchObject({ data: true });
    await store.close();
  });

  it("throws when IndexedDB is unavailable", () => {
    expect(isIndexedDbAvailable()).toBe(false);
    expect(() => createIndexedDbSaveStore()).toThrowError(/IndexedDB is not available/);
  });
});
