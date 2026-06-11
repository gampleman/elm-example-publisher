import EventEmitter from "node:events";
import { watch as fsWatch, type FSWatcher } from "node:fs";
import {
  buildSystem,
  Volatile,
  type Key,
  type Store,
  type Getter,
  type Invalidator,
} from "./engine.js";
import { hashFile, invalidateChangedFiles, isFile } from "./files.js";

export type BorekConfig = {
  store: Store;
  invalidator?: Invalidator;
};

// Per-instance internal state, kept in a WeakMap so it never collides with task
// method names and passes transparently through the recording Proxy.
type Internals = {
  input: Record<string, unknown>;
  config: BorekConfig;
  // When set, task-method calls record a dependency through this getter instead
  // of starting a new build (i.e. we are executing inside a task body).
  record?: Getter;
};
const internals = new WeakMap<object, Internals>();

// `input` is a real (built-in) task so it participates in dependency tracking
// and Volatile unwrapping; only the constructor is excluded from task dispatch.
const RESERVED = new Set<string>(["constructor"]);

/**
 * Base class for a Borek build. Subclass it and define `async` methods — each
 * method is a build task. Inside a task, `this.otherTask(...)` records a
 * dependency and returns that task's built (cached) value; calling a task
 * method on the instance from outside runs a build targeting it:
 *
 *     class Site extends Borek<Options> {
 *       async main() {
 *         const examples = await this.gather();
 *         await Promise.all(examples.map((e) => this.compile(e)));
 *       }
 *       async gather() {
 *         return Volatile(await gather(await this.input("inputDir")));
 *       }
 *     }
 *
 *     const site = new Site(options, { store, invalidator });
 *     await site.main();
 *
 * `Input` is the shape of the constructor's first argument; `this.input(key)`
 * reads a value from it in a Volatile (re-checked every run) manner — the
 * intended way to thread runtime inputs such as CLI flags into the graph.
 */
export class Borek<Input extends object = Record<string, never>> {
  constructor(input: Input, config: BorekConfig) {
    internals.set(this, {
      input: input as Record<string, unknown>,
      config,
    });
    return wrap(this);
  }

  // Built-in task: reads a value from the constructor input. Volatile, so
  // inputs are re-read every run while still allowing downstream early-exit.
  async input<K extends keyof Input>(key: K): Promise<Input[K]> {
    const state = internals.get(this)!;
    return Volatile(state.input[key as string] as Input[K]);
  }
}

// Dispatches a task-method call: record a dependency when executing inside a
// task body, otherwise start a build targeting the key.
const dispatch = (target: object, key: Key): Promise<unknown> => {
  const state = internals.get(target)!;
  if (state.record) return state.record(key);
  return buildSystem({
    tasks: makeTasks(target),
    store: state.config.store,
    invalidator: state.config.invalidator ?? invalidateChangedFiles,
  })(key);
};

// The engine `tasks` function for an instance: invokes the requested method on
// a recording clone (so nested this.x() calls record deps), then hashes File
// results so the file-tracking layer can detect on-disk changes.
const makeTasks =
  (instance: object) =>
  async (key: Key, get: Getter): Promise<unknown> => {
    const method = (instance as Record<string, unknown>)[key.method];
    if (typeof method !== "function") {
      throw new Error(`Unknown task: ${key.method}`);
    }
    const recording = Object.create(Object.getPrototypeOf(instance)) as object;
    internals.set(recording, { ...internals.get(instance)!, record: get });
    const result = await (
      method as (...a: unknown[]) => Promise<unknown>
    ).apply(wrap(recording), key.args);
    if (isFile(result) && result.hash === undefined) {
      return { ...result, hash: await hashFile(result.path) };
    }
    return result;
  };

// Wraps an instance in a Proxy so that accessing a task method returns a
// function that dispatches through Borek. Non-task members read through. The
// proxy shares the target's internals entry, so method bodies (whose `this` is
// the proxy) can look up state via `internals.get(this)`.
const wrap = <T extends object>(instance: T): T => {
  const proxy = new Proxy(instance, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (
        typeof prop === "string" &&
        typeof value === "function" &&
        !RESERVED.has(prop) &&
        prop in Object.getPrototypeOf(target)
      ) {
        return (...args: unknown[]) => dispatch(target, { method: prop, args });
      }
      return value;
    },
  });
  const state = internals.get(instance);
  if (state) internals.set(proxy, state);
  return proxy;
};

export type WatchEmitter = EventEmitter & { close: () => void };

// Drives an initial build (via `run`) and rebuilds whenever a file the build
// touched changes on disk. Emits "buildComplete" after each successful build
// and "error" on failure. Call `.close()` to stop watching.
export const watchBuild = (
  instance: Borek<object>,
  run: () => Promise<unknown>,
): WatchEmitter => {
  const emitter = new EventEmitter() as WatchEmitter;
  const { store } = internals.get(instance)!.config;
  let watchers: FSWatcher[] = [];
  let stopped = false;

  const closeWatchers = () => {
    watchers.forEach((w) => w.close());
    watchers = [];
  };

  const cycle = async () => {
    try {
      await run();
      emitter.emit("buildComplete");
    } catch (error) {
      emitter.emit("error", error);
    }
    if (stopped) return;
    const seen = new Set<string>();
    for (const [, entry] of store.entries()) {
      const value = entry.value;
      if (isFile(value) && !seen.has(value.path)) {
        seen.add(value.path);
        try {
          watchers.push(
            fsWatch(value.path, () => {
              closeWatchers();
              process.nextTick(cycle);
            }),
          );
        } catch {
          // Ignore files that can't be watched (e.g. just deleted).
        }
      }
    }
  };

  emitter.close = () => {
    stopped = true;
    closeWatchers();
  };
  void cycle();
  return emitter;
};
