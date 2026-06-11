import path from "node:path";
import http from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import puppeteer from "puppeteer";
import sharp from "sharp";
import * as log from "./log.js";

// Launch flags that keep Chrome happy in CI: it commonly runs as root there,
// where Chrome refuses to start without --no-sandbox. Modern puppeteer
// downloads its own up-to-date Chrome for Testing, but PUPPETEER_EXECUTABLE_PATH
// can still be used to point at a system-installed browser if desired.
function launchBrowser(debug) {
  const options = {
    headless: !debug,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  };
  if (debug) {
    options.slowMo = 100;
  }
  return puppeteer.launch(options);
}

async function snapPicture(
  browser,
  outputDir,
  exampleDir,
  name,
  url,
  delay,
  width,
  height,
  debug,
) {
  const dir = path.join(outputDir.absolute, exampleDir);
  const bigPicture = path.join(dir, name + "@3x.png");

  const page = await browser.newPage();

  if (debug) {
    page.on("console", (message) => {
      let { url, lineNumber, columnNumber } = message.location();
      lineNumber = lineNumber ? `:${lineNumber}` : "";
      columnNumber = columnNumber ? `:${columnNumber}` : "";
      const location = url ? ` (${url}${lineNumber}${columnNumber})` : "";
      console.log(`\nPage log:${location}\n${message.text()}\n`);
    });
    page.on("pageerror", (error) => {
      console.log("\nPage error:", error, "\n");
    });
  }

  try {
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.goto(url, { timeout: 60 * 1000, waitUntil: "networkidle2" });
    if (delay) {
      await new Promise((resolve) => setTimeout(resolve, delay * 1000));
    }
    await page.screenshot({ path: bigPicture });
  } finally {
    await page.close();
  }

  log.generated(path.join(outputDir.relative, exampleDir, name + "@3x.png"));
  const w = Math.floor(width / 3),
    h = Math.floor(height / 3);
  const resizer = sharp(bigPicture);

  return Promise.all(
    [1, 2]
      .flatMap((factor) => {
        const endName = name + (factor > 1 ? "@" + factor + "x" : "");
        const fName = path.join(dir, endName + ".png");
        const resized = resizer.clone().resize(w * factor, h * factor);

        return [
          resized
            .clone()
            .webp()
            .toFile(path.join(dir, endName + ".webp")),

          resized.toFile(fName).then(function () {
            log.generated(
              path.join(outputDir.relative, exampleDir, endName + ".png"),
            );
            log.generated(
              path.join(outputDir.relative, exampleDir, endName + ".webp"),
            );
          }),
        ];
      })
      .concat(
        resizer
          .clone()
          .webp()
          .toFile(path.join(dir, name + "@3x.webp"))
          .then(() => {
            log.generated(
              path.join(outputDir.relative, exampleDir, name + "@3x.webp"),
            );
          }),
      ),
  );
}

const CONTENT_TYPES = {
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

// A minimal static file server, just enough to serve the compiled examples to
// the headless browser while screenshots are taken.
const runServer = (rootPath, cb) => {
  const server = http.createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname,
      );
      let filePath = path.join(rootPath, urlPath);
      // Prevent path traversal outside the served root.
      if (!filePath.startsWith(rootPath)) {
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
      res.setHeader(
        "Content-Type",
        CONTENT_TYPES[path.extname(filePath).toLowerCase()] ||
          "application/octet-stream",
      );
      createReadStream(filePath).pipe(res);
    } catch (error) {
      res.statusCode = 500;
      res.end(String(error));
    }
  });

  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      cb(`http://127.0.0.1:${port}/`).then(
        (result) => {
          server.close();
          resolve(result);
        },
        (error) => {
          server.close();
          reject(error);
        },
      );
    });
  });
};

export default (examples, outputDir, debug) => {
  log.heading("Taking screenshots");
  return runServer(outputDir.absolute, async (baseUrl) => {
    const browser = await launchBrowser(debug);
    try {
      return await Promise.all(
        examples.flatMap((example) => {
          const snaps = ["preview", ...[example.tags.screenshot || []].flat()];
          return snaps.map((snap) => {
            const url = `${baseUrl}${example.basename}/iframe.html${
              snap === "preview" ? "" : "#" + snap
            }`;
            return snapPicture(
              browser,
              outputDir,
              example.basename,
              snap,
              url,
              example.tags.delay || 0,
              example.width,
              example.height,
              debug,
            );
          });
        }),
      );
    } finally {
      await browser.close();
    }
  });
};
