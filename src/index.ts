import path from "node:path";
import {
  onDiskStore,
  invalidateChangedFiles,
  watchBuild,
} from "./borek/index.js";
import type { WatchEmitter } from "./borek/index.js";
import { Site, type SiteRuntime } from "./site.js";
import { startServer, launchBrowser } from "./screenshot.js";
import gather from "./gather.js";
import publishEllies from "./publishEllies.js";
import { startDevServer } from "./devServer.js";
import * as log from "./log.js";
import type { Options } from "./types.js";

// Builds a Site instance wired to a persisted cache (in the output dir), plus
// the screenshot server + headless browser when screenshots are enabled, and
// Ellie-augmented examples when requested. Returns the site and a teardown.
const setup = async (
  options: Options,
): Promise<{ site: Site; teardown: () => Promise<void> }> => {
  const runtime: SiteRuntime = {
    baseUrl: null,
    browser: null,
    examplesOverride: null,
  };

  if (options.ellie) {
    const examples = await gather(
      options.inputDir,
      options.width,
      options.height,
    );
    runtime.examplesOverride = await publishEllies(
      examples,
      options.inputDir,
      options.ellie,
    );
  }

  let closeServer: (() => void) | null = null;
  if (options.screenshots) {
    const { server, baseUrl } = await startServer(options.outputDir);
    runtime.baseUrl = baseUrl;
    runtime.browser = await launchBrowser(options.debug);
    closeServer = () => server.close();
  }

  const store = await onDiskStore(
    path.join(options.outputDir, ".borek-cache.json"),
  );
  const site = new Site(options, runtime, {
    store,
    invalidator: invalidateChangedFiles,
  });

  const teardown = async () => {
    if (runtime.browser) await runtime.browser.close();
    if (closeServer) closeServer();
  };

  return { site, teardown };
};

// A single full (incremental) build.
export const build = async (options: Options): Promise<void> => {
  const start = Date.now();
  log.heading("Building website");
  const { site, teardown } = await setup(options);
  try {
    await site.main();
  } finally {
    await teardown();
  }
  log.heading(
    `Done. Completed in ${Math.ceil((Date.now() - start) / 1000)} seconds`,
  );
};

// A watch build: rebuild incrementally whenever a touched file changes. Returns
// the watch emitter; call .close() to stop and tear down resources.
export const watch = async (
  options: Options,
  onBuildComplete?: () => void,
): Promise<WatchEmitter> => {
  const { site, teardown } = await setup(options);
  const emitter = watchBuild(site, () => site.main());
  emitter.on("buildComplete", () => {
    log.heading("Build complete — watching for changes…");
    if (onBuildComplete) onBuildComplete();
  });
  emitter.on("error", (e) => console.error(e));
  const originalClose = emitter.close;
  emitter.close = () => {
    originalClose();
    void teardown();
  };
  return emitter;
};

// Entry point used by the CLI.
export default async (options: Options): Promise<void> => {
  if (options.watch) {
    await startDevServer(options, watch);
  } else {
    await build(options);
  }
};
