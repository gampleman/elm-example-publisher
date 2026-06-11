import http from "node:http";
import path from "node:path";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import * as log from "./log.js";
import type { WatchEmitter } from "./borek/index.js";
import type { Options } from "./types.js";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".csv": "text/csv",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
};

// Injected into every served HTML page: opens a Server-Sent Events stream and
// reloads the page when the build emits a "reload" event. No client dependency.
const LIVE_RELOAD_SNIPPET = `
<script>
  (function () {
    var es = new EventSource("/__livereload");
    es.addEventListener("reload", function () { location.reload(); });
    es.onerror = function () { /* server restarting; EventSource auto-retries */ };
  })();
</script>`;

type WatchFn = (
  options: Options,
  onBuildComplete?: () => void,
) => Promise<WatchEmitter>;

// Starts a dev server that serves `outputDir` with live reload, and drives an
// incremental watch build. Each successful rebuild pushes a reload to every
// connected browser. Resolves once the server is listening and the first build
// has completed.
export const startDevServer = async (
  options: Options,
  watch: WatchFn,
): Promise<{ server: http.Server; emitter: WatchEmitter }> => {
  const { outputDir, port } = options;
  const clients = new Set<http.ServerResponse>();

  const server = http.createServer(async (req, res) => {
    const urlPath = decodeURIComponent(
      new URL(req.url ?? "/", "http://localhost").pathname,
    );

    if (urlPath === "/__livereload") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write("retry: 1000\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }

    try {
      let filePath = path.join(outputDir, urlPath);
      if (!filePath.startsWith(outputDir)) {
        res.statusCode = 403;
        return res.end("Forbidden");
      }
      let stats = await stat(filePath).catch(() => null);
      if (stats && stats.isDirectory()) {
        filePath = path.join(filePath, "index.html");
        stats = await stat(filePath).catch(() => null);
      }
      if (!stats) {
        res.statusCode = 404;
        return res.end("Not found");
      }
      const ext = path.extname(filePath).toLowerCase();
      res.setHeader(
        "Content-Type",
        CONTENT_TYPES[ext] ?? "application/octet-stream",
      );
      // Inject the live-reload client into HTML responses.
      if (ext === ".html") {
        const html = await readFile(filePath, "utf8");
        return res.end(
          html.replace("</body>", LIVE_RELOAD_SNIPPET + "</body>"),
        );
      }
      createReadStream(filePath).pipe(res);
    } catch (error) {
      res.statusCode = 500;
      res.end(String(error));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        reject(
          new Error(`Port ${port} is already in use. Pass a different --port.`),
        );
      } else {
        reject(err);
      }
    });
    server.listen(port, () => {
      server.removeAllListeners("error");
      resolve();
    });
  });
  log.heading(`Dev server running at http://localhost:${port}`);

  // First build done -> nothing to reload yet; later builds push a reload.
  let firstBuild = true;
  const emitter = await watch(options, () => {
    if (firstBuild) {
      firstBuild = false;
      return;
    }
    for (const client of clients) {
      client.write("event: reload\ndata: {}\n\n");
    }
  });

  const shutdown = () => {
    for (const client of clients) client.end();
    server.close();
    emitter.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return { server, emitter };
};
