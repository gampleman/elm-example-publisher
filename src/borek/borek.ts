import EventEmitter from "node:events";
import { watch as fsWatch, type FSWatcher } from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
import {
  buildSystem,
  Volatile,
  type Key,
  type Store,
  type Getter,
  type Invalidator,
  type Reporter,
} from "./engine.js";
import {
  File,
  Glob,
  hashFile,
  invalidateChangedFiles,
  isFile,
  isGlob,
  expandGlob,
  globBaseDir,
  type FileResult,
  type GlobResult,
} from "./files.js";

export type BorekConfig = {
  store: Store;
  invalidator?: Invalidator;
  // Receives a progress event each time a real (non-cached) task runs. The
  // built-in plumbing tasks (input/file/glob and the tracked-IO helpers) are
  // filtered out, so a reporter only sees the subclass's own task methods.
  reporter?: Reporter;
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

// `input`, `file`, and `glob` are real (built-in) tasks: they participate in
// dependency tracking and Volatile unwrapping, so they dispatch through the
// proxy. The tracked-IO helpers (readFile/readJSON/copyFile/globFiles) and the
// constructor are NOT tasks — they run directly, recording dependencies via the
// primitives above. Excluding them from dispatch keeps `this` inside them bound
// to the recording instance so their `this.file(...)` calls record correctly.
const RESERVED = new Set<string>([
  "constructor",
  "readFile",
  "readJSON",
  "copyFile",
  "globFiles",
]);

// Built-in tasks that DO dispatch through the engine but are plumbing, not
// user-meaningful work — filtered out of progress reporting so a reporter only
// sees the subclass's own task methods.
const BUILTIN_TASKS = new Set<string>(["input", "file", "glob"]);

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
 *
 * To depend on the filesystem, use the tracked-IO helpers (`this.readFile`,
 * `this.readJSON`, `this.copyFile`, `this.globFiles`) rather than `node:fs`
 * directly: each one both reads and records the dependency in a single call, so
 * there is no separate "declare a dependency" step to forget.
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

  // Built-in task: declares a dependency on a file's contents. The engine hashes
  // the file, so the task's value (and its dependents) change when the file
  // does. Prefer the readFile/copyFile helpers, which call this for you.
  async file(filePath: string): Promise<FileResult> {
    return File(filePath);
  }

  // Built-in task: declares a dependency on the set of paths matching a glob
  // pattern (add/remove of a match invalidates dependents; modifications are
  // tracked per-file via file()). Prefer globFiles, which returns the paths.
  async glob(pattern: string): Promise<GlobResult> {
    return Glob(pattern);
  }

  // Tracked IO: read a file and depend on it in one call. Use these instead of
  // node:fs so the path you read is always the path you track.
  async readFile(filePath: string): Promise<string> {
    await this.file(filePath);
    return fsp.readFile(filePath, "utf8");
  }

  async readJSON<T = unknown>(filePath: string): Promise<T> {
    return JSON.parse(await this.readFile(filePath)) as T;
  }

  // Copies `from` to `to`, depending on the source's contents. Returns a File
  // marker for the destination so the caller can also record it as an output
  // (its hash then participates in invalidation like any other File result).
  async copyFile(from: string, to: string): Promise<FileResult> {
    await this.file(from);
    await fsp.mkdir(path.dirname(to), { recursive: true });
    await fsp.copyFile(from, to);
    return File(to);
  }

  // Tracked glob: returns the sorted matching paths and depends on that set.
  async globFiles(pattern: string): Promise<string[]> {
    const result = await this.glob(pattern);
    return result.paths ?? [];
  }
}

// Dispatches a task-method call: record a dependency when executing inside a
// task body, otherwise start a build targeting the key.
const dispatch = (target: object, key: Key): Promise<unknown> => {
  const state = internals.get(target)!;
  if (state.record) return state.record(key);
  const userReporter = state.config.reporter;
  // Filter built-in plumbing tasks out of progress events.
  const reporter: Reporter | undefined = userReporter
    ? (event) => {
        if (!BUILTIN_TASKS.has(event.key.method)) userReporter(event);
      }
    : undefined;
  return buildSystem({
    tasks: makeTasks(target),
    store: state.config.store,
    invalidator: state.config.invalidator ?? invalidateChangedFiles,
    reporter,
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
    // Clone the instance (prototype + own fields, e.g. subclass properties set
    // in the constructor) with the recorder installed, so nested this.x() calls
    // record dependencies instead of starting new builds.
    const recording = Object.create(
      Object.getPrototypeOf(instance),
      Object.getOwnPropertyDescriptors(instance),
    ) as object;
    internals.set(recording, { ...internals.get(instance)!, record: get });
    const result = await (
      method as (...a: unknown[]) => Promise<unknown>
    ).apply(wrap(recording), key.args);
    if (isFile(result) && result.hash === undefined) {
      return { ...result, hash: await hashFile(result.path) };
    }
    if (isGlob(result) && result.paths === undefined) {
      return { ...result, paths: await expandGlob(result.pattern) };
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
    const onChange = () => {
      closeWatchers();
      process.nextTick(cycle);
    };
    const seen = new Set<string>();
    const watchPath = (target: string) => {
      if (seen.has(target)) return;
      seen.add(target);
      try {
        watchers.push(fsWatch(target, onChange));
      } catch {
        // Ignore paths that can't be watched (e.g. just deleted).
      }
    };
    for (const [, entry] of store.entries()) {
      const value = entry.value;
      if (isFile(value)) {
        watchPath(value.path);
      } else if (isGlob(value)) {
        // Watch the glob's base directory so files added to or removed from the
        // matched set trigger a rebuild (per-file watchers can't see new files).
        watchPath(globBaseDir(value.pattern));
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
