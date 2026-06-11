import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

// The core of Borek: an incremental build engine in the style of the paper
// "Build Systems à la Carte". A `Tasks` function computes a value for a key,
// declaring dependencies by awaiting other keys through the `get` callback.
// On rebuild, only tasks whose inputs actually changed are recomputed (with
// early-exit when a recomputed value turns out unchanged).

export type Key = { method: string; args: unknown[] };

export type StoreEntry = {
  value: unknown;
  dependencies: Key[];
  stale: boolean;
  volatile: boolean;
};

export interface Store {
  invalidate(key: Key): void;
  finalize(): Promise<void>;
  has(key: Key): boolean;
  get(key: Key): StoreEntry | undefined;
  set(key: Key, value: StoreEntry): void;
  entries(): [Key, StoreEntry][];
}

export type Getter = (key: Key) => Promise<unknown>;
export type Tasks = (key: Key, get: Getter) => Promise<unknown>;
export type Invalidator = (store: Store) => unknown | Promise<unknown>;

// A wrapper marking a value as non-deterministic: a task returning Volatile is
// reconsidered on every run, but downstream tasks still early-exit if its value
// is stable. At the type level it is the identity — the engine unwraps it
// before any caller sees the result.
const VOLATILE = Symbol("volatile");
type VolatileBox = { [VOLATILE]: true; value: unknown };

export const Volatile = <T>(value: T): T =>
  ({ [VOLATILE]: true, value }) as unknown as T;

const isVolatile = (val: unknown): val is VolatileBox =>
  typeof val === "object" && val !== null && VOLATILE in val;

const normalizeResult = (val: unknown): unknown =>
  isVolatile(val) ? val.value : val;

// A stable, order-independent serialization, used to key the store by
// (method, args) without depending on object identity or key insertion order.
const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k]))
      .join(",") +
    "}"
  );
};

export const hash = (value: unknown): string =>
  createHash("sha1").update(stableStringify(value)).digest("hex");

type GuardRunning = <T>(
  target: Key,
  type: string,
  fn: () => Promise<T>,
) => Promise<T>;

const executeMissingDependencies = async (
  store: Store,
  guardRunning: GuardRunning,
  key: Key,
  fn: Tasks,
): Promise<boolean> => {
  const existing = store.get(key);
  if (existing && !existing.stale) {
    const results = await Promise.all(
      existing.dependencies.map((dep) =>
        guardRunning(dep, "executeMissingDependencies", () =>
          executeMissingDependencies(store, guardRunning, dep, fn),
        ),
      ),
    );
    // If any dependency changed, recompute this task and report whether its
    // own value changed (so callers up the chain can early-exit if not).
    if (results.some((changed) => changed)) {
      const result = await guardRunning(key, "execute", () =>
        execute(store, guardRunning, key, fn),
      );
      return !isDeepStrictEqual(normalizeResult(result), existing.value);
    }
    return false;
  } else if (existing) {
    const result = await guardRunning(key, "execute", () =>
      execute(store, guardRunning, key, fn),
    );
    return !isDeepStrictEqual(existing.value, normalizeResult(result));
  } else {
    await guardRunning(key, "execute", () =>
      execute(store, guardRunning, key, fn),
    );
    return true;
  }
};

const execute = async (
  store: Store,
  guardRunning: GuardRunning,
  key: Key,
  fn: Tasks,
): Promise<unknown> => {
  const dependencies: Key[] = [];
  const recorder: Getter = (newKey) => {
    dependencies.push(newKey);
    return build(store, guardRunning, newKey, fn);
  };
  const result = await fn(key, recorder);
  store.set(key, {
    value: normalizeResult(result),
    dependencies,
    stale: false,
    volatile: isVolatile(result),
  });
  return normalizeResult(result);
};

const build = async (
  store: Store,
  guardRunning: GuardRunning,
  key: Key,
  fn: Tasks,
): Promise<unknown> => {
  if (!store.has(key)) {
    return await guardRunning(key, "execute", () =>
      execute(store, guardRunning, key, fn),
    );
  }
  await executeMissingDependencies(store, guardRunning, key, fn);
  return store.get(key)!.value;
};

export type BuildConfig = {
  tasks: Tasks;
  store: Store;
  invalidator?: Invalidator;
};

export const buildSystem =
  ({ tasks, store, invalidator }: BuildConfig) =>
  async (target: Key): Promise<unknown> => {
    // Volatile tasks are non-deterministic, so they must be reconsidered every
    // run; marking them stale (rather than always recomputing dependents) lets
    // the early-exit logic still skip dependents whose value is stable.
    for (const [key, entry] of store.entries()) {
      if (entry.volatile) store.invalidate(key);
    }
    if (invalidator) await invalidator(store);
    const guardRunning = running();
    try {
      return await build(store, guardRunning, target, tasks);
    } finally {
      await store.finalize();
    }
  };

/**
 * Guards async execution by key, so concurrent requests for the same task share
 * a single in-flight promise instead of recomputing in parallel.
 */
const running = (): GuardRunning => {
  const internalStore = new Map<string, Promise<unknown>>();
  return <T>(target: Key, type: string, fn: () => Promise<T>): Promise<T> => {
    const key = hash({ target, type });
    const inFlight = internalStore.get(key);
    if (inFlight) return inFlight as Promise<T>;
    const promise = fn();
    internalStore.set(key, promise);
    return promise.then((value) => {
      internalStore.delete(key);
      return value;
    });
  };
};

// A persisted store entry, as written to disk (the transient `stale` flag is
// recomputed on load).
type PersistedEntry = Pick<StoreEntry, "value" | "dependencies" | "volatile">;

const makeStore = (
  backing: Map<string, StoreEntry>,
  finalize: () => Promise<void>,
): Store => {
  const makeKey = (key: Key): string =>
    "$$hashKey" in key ? (key as { $$hashKey: string }).$$hashKey : hash(key);
  return {
    invalidate(target) {
      const key = makeKey(target);
      const entry = backing.get(key);
      if (entry) backing.set(key, { ...entry, stale: true });
    },
    finalize,
    has(key) {
      return backing.has(makeKey(key));
    },
    get(key) {
      return backing.get(makeKey(key));
    },
    set(key, value) {
      backing.set(makeKey(key), value);
    },
    entries() {
      return Array.from(backing.entries()).map(([key, val]) => [
        { method: "", args: [], $$hashKey: key } as Key,
        val,
      ]);
    },
  };
};

// A store that persists to disk as JSON, so dependency graphs and computed
// values survive between runs — this is what makes rebuilds incremental.
export const onDiskStore = async (path: string): Promise<Store> => {
  let backing: Map<string, StoreEntry>;
  try {
    const raw = JSON.parse(await fs.readFile(path, "utf8")) as [
      string,
      PersistedEntry,
    ][];
    backing = new Map(
      raw.map(([key, { value, volatile, dependencies }]) => [
        key,
        { value, volatile, dependencies, stale: volatile },
      ]),
    );
  } catch {
    backing = new Map();
  }
  return makeStore(backing, async () => {
    const data: [string, PersistedEntry][] = Array.from(backing.entries()).map(
      ([key, { value, volatile, dependencies }]) => [
        key,
        { value, volatile, dependencies },
      ],
    );
    await fs.writeFile(path, JSON.stringify(data));
  });
};

// An in-memory store, useful for tests and one-off builds.
export const inMemoryStore = (): Store => makeStore(new Map(), async () => {});
