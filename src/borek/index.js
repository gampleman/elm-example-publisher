import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

// Borek is a small incremental build system, inspired by the paper
// "Build Systems à la Carte". Tasks declare dependencies on other tasks by
// awaiting them through a recorder; Borek records the dependency graph and, on
// subsequent runs, recomputes only the tasks whose inputs actually changed.
//
// A store entry has the shape:
//   { value, dependencies: Array<Key>, stale: boolean, volatile?: boolean }

// A stable, order-independent serialization of an arbitrary JSON-ish value.
// Used to key the store by (method, args) without relying on object identity
// or key insertion order.
const stableStringify = (value) => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  const keys = Object.keys(value).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + stableStringify(value[k]))
      .join(",") +
    "}"
  );
};

const hash = (value) =>
  createHash("sha1").update(stableStringify(value)).digest("hex");

const formatKey = (key) => {
  const argStr = key.args.map((d) => JSON.stringify(d)).join(", ");
  return `${key.method}(${argStr.substring(0, 100)}${
    argStr.length > 100 ? "..." : ""
  })`;
};

const isVolatile = (val) =>
  val !== null && typeof val === "object" && val.type === "Volatile";

const normalizeResult = (val) => (isVolatile(val) ? val.value : val);

const executeMissingDependencies = async (store, guardRunning, key, fn) => {
  if (store.has(key) && !store.get(key).stale) {
    const cached = store.get(key);
    const results = await Promise.all(
      cached.dependencies.map((dep) =>
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
      return !isDeepStrictEqual(normalizeResult(result), cached.value);
    }
    return false;
  } else if (store.has(key)) {
    const cached = store.get(key);
    const result = await guardRunning(key, "execute", () =>
      execute(store, guardRunning, key, fn),
    );
    return !isDeepStrictEqual(cached.value, normalizeResult(result));
  } else {
    await guardRunning(key, "execute", () =>
      execute(store, guardRunning, key, fn),
    );
    return true;
  }
};

const execute = async (store, guardRunning, key, fn) => {
  const dependencies = [];
  const recorder = (newKey) => {
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

const build = async (store, guardRunning, key, fn) => {
  if (!store.has(key)) {
    return await guardRunning(key, "execute", () =>
      execute(store, guardRunning, key, fn),
    );
  } else {
    await executeMissingDependencies(store, guardRunning, key, fn);
    return store.get(key).value;
  }
};

export const buildSystem =
  ({ tasks, store, invalidator }) =>
  async (target) => {
    // Volatile tasks are non-deterministic, so they must be reconsidered on
    // every run. Marking them stale (rather than always recomputing downstream)
    // lets the early-exit logic still skip dependents whose value is stable.
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
 * Guards async function execution by a particular key, so that concurrent
 * requests for the same task share a single in-flight promise rather than
 * recomputing it in parallel.
 */
const running = () => {
  const internalStore = new Map();

  return (target, type, fn) => {
    const key = hash({ target, type });
    if (internalStore.has(key)) {
      return internalStore.get(key);
    } else {
      const promise = fn();
      internalStore.set(key, promise);
      return promise.then((value) => {
        internalStore.delete(key);
        return value;
      });
    }
  };
};

// Common store behaviour shared by the on-disk and in-memory stores. `backing`
// is a Map of hashKey -> entry.
const makeStore = (backing, finalize) => {
  const makeKey = (key) => (key.$$hashKey ? key.$$hashKey : hash(key));
  return {
    invalidate(target) {
      const key = makeKey(target);
      if (backing.has(key)) {
        backing.set(key, { ...backing.get(key), stale: true });
      }
    },
    finalize,
    has(key) {
      return backing.has(makeKey(key));
    },
    get(key) {
      return backing.get(makeKey(key));
    },
    set(key, value) {
      return backing.set(makeKey(key), value);
    },
    entries() {
      return Array.from(backing.entries()).map(([key, val]) => [
        { $$hashKey: key },
        val,
      ]);
    },
  };
};

// A store that persists to disk as JSON, so dependency graphs and computed
// values survive between runs (this is what makes rebuilds incremental).
export const onDiskStore = async (path) => {
  let backing;
  try {
    backing = new Map(
      JSON.parse(await fs.readFile(path, "utf8")).map(
        ([key, { value, volatile, dependencies }]) => [
          key,
          { value, volatile, dependencies, stale: volatile },
        ],
      ),
    );
  } catch {
    backing = new Map();
  }
  return makeStore(backing, async () => {
    const data = Array.from(backing.entries()).map(
      ([key, { value, volatile, dependencies }]) => [
        key,
        { value, volatile, dependencies },
      ],
    );
    await fs.writeFile(path, JSON.stringify(data));
  });
};

// An in-memory store, useful for tests and one-off builds where persistence
// isn't wanted.
export const inMemoryStore = () => makeStore(new Map(), async () => {});

// Wraps a value to mark it as non-deterministic: tasks returning Volatile are
// always re-run, but downstream tasks still early-exit if the value is stable.
export const Volatile = (value) => ({ type: "Volatile", value });

export { hash, formatKey };
