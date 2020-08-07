const { emit } = require("process");

const { buildSystem } = require("."),
  fsBase = require("fs"),
  fs = fsBase.promises,
  watch = fsBase.watch,
  path = require("path"),
  md5 = require("md5"),
  EventEmitter = require("events");

const File = (...paths) => ({
  type: "File",
  path: path.join(...paths),
});

const Dir = (path) => ({ type: "Dir", path });

// const invalidateChangedFiles = async (store) => {
//   for (const [key, value] of store) {
//     if (key.type === "File") {
//       try {
//         const hash = md5(await fs.readFile(path));
//         if (value.value !== hash) {
//           store.invalidate(key);
//         }
//       } catch (e) {
//         store.invalidate(key);
//       }
//     }
//   }
// };

// const withFiles = (tasks) => async (target, get) => {
//   // TODO: add some independent directory setting, so we can have relative paths
//   if (target.type && target.type === "File") {
//     await tasks(target, get);
//     return md5(await fs.readFile(target.path));
//   } else if (target.type && target.type === "Dir") {
//     return Volatile(await fs.readdir(target.path));
//   }
//   return await tasks(target, get);
// };

const invalidateChangedFiles = async (store) => {
  const iterator = await store.entries();
  for (const [key, { value }] of iterator) {
    if (value.type && value.type === "File") {
      try {
        const hash = md5(await fs.readFile(value.path));
        console.log(
          `Checking file ${value.path}. \n    Stored hash: ${value.hash}\n  Computed hash: ${hash}`
        );

        if (value.hash !== hash) {
          console.log("   --> Invalidating");
          store.invalidate(key);
        }
      } catch (e) {
        console.error(`Invalidation failed: ${e}`);
        store.invalidate(key);
      }
    }
  }
  return store;
};

const withFiles = (tasks) => async (target, get) => {
  const result = await tasks(target, get);
  if (!result) {
    console.error(target, "returned undefined");
  }
  if (result && result.type && result.type === "File") {
    return { ...result, hash: md5(await fs.readFile(result.path)) };
  }

  return result;
};

const watchRebuilder = (buildSystemConfig, target) => {
  const emitter = new EventEmitter();
  const { store } = buildSystemConfig;
  const builder = buildSystem(buildSystemConfig);
  const run = async () => {
    try {
      await builder(target);
      await store.finalize();
      emitter.emit("buildComplete");
    } catch (e) {
      console.error(e);
      emitter.emit("error", e);
    }

    const iterator = await store.entries();
    const watchers = [];
    for (const [key, { value }] of iterator) {
      if (value && value.type && value.type === "File") {
        console.log(`watching ${value.path} for changes...`);
        watchers.push(
          watch(value.path, (...args) => {
            console.log("event:", args);
            // store.invalidate(key);
            watchers.forEach((watcher) => watcher.close());
            process.nextTick(run);
          }).on("close", () => {
            console.log(`Stopping watch on ${value.path}`);
          })
        );
      }
    }
  };
  run();
  return emitter;
};

module.exports = {
  File,
  Dir,
  withFiles,
  invalidateChangedFiles,
  watchRebuilder,
};
