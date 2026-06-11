import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSystem, onDiskStore } from "../borek/index.js";
import { invalidateChangedFiles, watchRebuilder } from "../borek/files.js";
import { makeTasks } from "./tasks.js";
import { startServer, launchBrowser } from "./screenshot.js";
import gather from "../gather.js";
import publishEllies from "../publishEllies.js";
import * as log from "../log.js";

const publisherDir = path.dirname(fileURLToPath(import.meta.url)) + "/..";

const TARGET = { method: "main", args: [] };

// Resolves shared resources (cache store, screenshot server + browser) and
// builds the task context. Ellie publishing, when requested, runs up front and
// its augmented examples are injected so the template can link to them.
const setup = async (options) => {
  const {
    inputDir,
    outputDir,
    width,
    height,
    templateFile,
    assetDir,
    debug,
    ellie,
    screenshots,
  } = options;

  let examplesOverride = null;
  if (ellie) {
    const examples = await gather(inputDir, width, height);
    examplesOverride = await publishEllies(examples, inputDir, ellie);
  }

  const store = await onDiskStore(path.join(outputDir, ".borek-cache.json"));

  let server = null;
  let browser = null;
  let baseUrl = null;
  if (screenshots) {
    ({ server, baseUrl } = await startServer(outputDir));
    browser = await launchBrowser(debug);
  }

  const ctx = {
    inputDir,
    outputDir,
    width,
    height,
    templateFile,
    assetDir,
    debug,
    screenshots,
    publisherDir,
    baseUrl,
    browser,
    examplesOverride,
  };

  const teardown = async () => {
    if (browser) await browser.close();
    if (server) server.close();
  };

  return { store, ctx, teardown };
};

// Single, full (incremental) build: build everything reachable from `main`,
// reusing any cached work whose inputs are unchanged.
export const build = async (options) => {
  const start = Date.now();
  log.heading("Building website");
  const { store, ctx, teardown } = await setup(options);
  try {
    const runBuild = buildSystem({
      tasks: makeTasks(ctx),
      store,
      invalidator: invalidateChangedFiles,
    });
    await runBuild(TARGET);
  } finally {
    await teardown();
  }
  log.heading(
    `Done. Completed in ${Math.ceil((Date.now() - start) / 1000)} seconds`,
  );
};

// Watch build: rebuild incrementally whenever a touched file changes. Returns
// the watch emitter (emits "buildComplete"/"error"); call .close() to stop.
export const watch = async (options, onBuildComplete) => {
  const { store, ctx, teardown } = await setup(options);
  const emitter = watchRebuilder(
    {
      tasks: makeTasks(ctx),
      store,
      invalidator: invalidateChangedFiles,
    },
    TARGET,
  );
  emitter.on("buildComplete", () => {
    log.heading("Build complete — watching for changes…");
    if (onBuildComplete) onBuildComplete();
  });
  emitter.on("error", (e) => console.error(e));
  const originalClose = emitter.close;
  emitter.close = async () => {
    originalClose();
    await teardown();
  };
  return emitter;
};
