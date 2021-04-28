const fs = require("fs").promises,
  deepEqual = require("deep-equal"),
  hash = require("object-hash");

// types
// StoreItem value = { dependencies : Array<String>, value: value, stale: Boolean }
const shortJSON = (d) => {
  const str = JSON.stringify(d, null, 2);
  return str.substring(0, 300) + (str.length > 300 ? "..." : "");
};
const formatKey = (key) => {
  const argStr = key.args.map((d) => JSON.stringify(d, null, 2)).join(", ");
  return `${key.method}(${argStr.substring(0, 100)}${
    argStr.length > 100 ? "..." : ""
  })`;
};

const normalizeResult = (val) =>
  !val.type || val.type !== "Volatile" ? val : val.value;

const executeMissingDependencies = async (store, guardRunning, key, fn) => {
  // console.log("executeMissingDependencies", JSON.stringify(key));
  if (store.has(key) && !store.get(key).stale) {
    // console.log("unchanged dep", key);
    const cached = store.get(key);
    // console.log("cached", cached);
    const results = await Promise.all(
      cached.dependencies.map((dep) =>
        guardRunning(dep, "executeMissingDependencies", () =>
          executeMissingDependencies(store, guardRunning, dep, fn)
        )
      )
    );
    // recurse
    if (results.some((id) => id)) {
      // console.log("a dep changed");
      // something changed here
      const result = await guardRunning(key, "execute", () =>
        execute(store, guardRunning, key, fn)
      );
      return !deepEqual(normalizeResult(result), cached.value, {
        strict: true,
      });
    }
    return false;
  } else {
    console.log(`Changed deps ${formatKey(key)}`);

    if (store.has(key)) {
      const cached = store.get(key);
      const result = await guardRunning(key, "execute", () =>
        execute(store, guardRunning, key, fn)
      );
      const changed = !deepEqual(cached.value, normalizeResult(result), {
        strict: true,
      });
      console.log(
        `Comparing for ${formatKey(key)}`,
        shortJSON(cached.value),
        shortJSON(normalizeResult(result)),
        !changed
      );

      return changed;
    } else {
      await guardRunning(key, "execute", () =>
        execute(store, guardRunning, key, fn)
      );
      return true;
    }
  }
};

const execute = async (store, guardRunning, key, fn) => {
  console.log(`Building ${formatKey(key)}`);
  let dependencies = [];
  const recorder = (newKey) => {
    dependencies.push(newKey);
    return build(store, guardRunning, newKey, fn);
  };
  const result = await fn(key, recorder);
  // console.log("Finished ", JSON.stringify(key));
  if (!result.type || result.type !== "Volatile")
    store.set(key, { value: result, dependencies, stale: false });
  else
    store.set(key, {
      value: result.value,
      dependencies,
      stale: false,
      volatile: true,
    });
  return normalizeResult(result);
};

const build = async (store, guardRunning, key, fn) => {
  if (!store.has(key)) {
    return await guardRunning(key, "execute", () =>
      execute(store, guardRunning, key, fn)
    );
  } else {
    await executeMissingDependencies(store, guardRunning, key, fn);
    return store.get(key).value;
  }
};

const buildSystem = ({ tasks, store, invalidator }) => async (target) => {
  await invalidator(store);
  const guardRunning = running();
  try {
    return await build(store, guardRunning, target, tasks);
  } finally {
    await store.finalize();
  }
};

/**
 * Guards async function execution by a particular key.
 * This ensures that only a single execution is started in parallel.
 * All the other executions will get the same promise to await.
 */
const running = () => {
  const internalStore = new Map();

  return (target, type, fn) => {
    const key = hash(
      { target, type },
      {
        respectFunctionProperties: false,
        respectType: false,
      }
    );
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

const onDiskStore = async (path) => {
  let internalStore;
  try {
    internalStore = new Map(
      JSON.parse(await fs.readFile(path)).map(
        ([key, { value, volatile, dependencies }]) => [
          key,
          {
            value,
            volatile,
            dependencies,
            stale: volatile,
          },
        ]
      )
    );
  } catch (e) {
    internalStore = new Map();
  }
  const makeKey = (key) => {
    if (key.$$hashKey) return key.$$hashKey;
    return hash(key, { respectFunctionProperties: false, respectType: false });
  };

  return {
    invalidate(target) {
      const key = makeKey(target);
      if (internalStore.has(key)) {
        internalStore.set(key, { ...internalStore.get(key), stale: true });
      }
    },
    finalize: async function () {
      const data = Array.from(
        internalStore.entries()
      ).map(([key, { value, volatile, dependencies }]) => [
        key,
        { value, volatile, dependencies },
      ]);
      await fs.writeFile(path, JSON.stringify(data));
    },
    has(key) {
      return internalStore.has(makeKey(key));
    },
    get(key) {
      return internalStore.get(makeKey(key));
    },
    set(key, value) {
      return internalStore.set(makeKey(key), value);
    },
    entries() {
      return Array.from(internalStore.entries()).map(([key, val]) => [
        { $$hashKey: key },
        val,
      ]);
    },
  };
};

const inMemoryStore = () => new Map();

const Volatile = (value) => ({
  type: "Volatile",
  value,
});

module.exports = {
  buildSystem,
  onDiskStore,
  inMemoryStore,
  Volatile,
};
