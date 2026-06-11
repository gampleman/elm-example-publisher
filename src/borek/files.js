import { promises as fs, watch } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import EventEmitter from "node:events";
import { buildSystem } from "./index.js";

// A File result marks that a task produced (or depends on) a file on disk.
// Borek hashes the file's contents so the task is invalidated when it changes.
export const File = (...paths) => ({
  type: "File",
  path: path.join(...paths),
});

export const Dir = (dirPath) => ({ type: "Dir", path: dirPath });

const hashFile = async (filePath) => {
  const contents = await fs.readFile(filePath);
  return createHash("sha1").update(contents).digest("hex");
};

// Wraps a `tasks` function so that any task returning a File result gets the
// file's content hash recorded alongside it. That hash is what
// invalidateChangedFiles compares against to detect changes on disk.
export const withFiles = (tasks) => async (target, get) => {
  const result = await tasks(target, get);
  if (result && result.type === "File") {
    return { ...result, hash: await hashFile(result.path) };
  }
  return result;
};

// An invalidator: marks any File-valued store entry stale if its on-disk
// contents have changed (or the file has gone away) since the last build.
export const invalidateChangedFiles = async (store) => {
  for (const [key, { value }] of store.entries()) {
    if (value && value.type === "File") {
      try {
        const hash = await hashFile(value.path);
        if (value.hash !== hash) store.invalidate(key);
      } catch {
        // File unreadable/removed: force a recompute.
        store.invalidate(key);
      }
    }
  }
  return store;
};

// Drives an initial build and then rebuilds whenever any file the build touched
// changes on disk. Emits "buildComplete" after each successful build and
// "error" on failure. Returns an EventEmitter; call `.close()` to stop watching.
export const watchRebuilder = (buildSystemConfig, target) => {
  const emitter = new EventEmitter();
  const { store } = buildSystemConfig;
  const builder = buildSystem(buildSystemConfig);
  let watchers = [];
  let stopped = false;

  const closeWatchers = () => {
    watchers.forEach((w) => w.close());
    watchers = [];
  };

  const run = async () => {
    try {
      await builder(target);
      emitter.emit("buildComplete");
    } catch (error) {
      emitter.emit("error", error);
    }
    if (stopped) return;

    // Re-arm watchers on the (possibly changed) set of touched files. A change
    // on any of them tears down all watchers and triggers a fresh rebuild.
    const seen = new Set();
    for (const [, { value }] of store.entries()) {
      if (value && value.type === "File" && !seen.has(value.path)) {
        seen.add(value.path);
        try {
          watchers.push(
            watch(value.path, () => {
              closeWatchers();
              process.nextTick(run);
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

  run();
  return emitter;
};
