import path from "node:path";
import http from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import puppeteer from "puppeteer";
import sharp from "sharp";

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

// A minimal static file server for serving compiled examples to the browser.
// Returns the running server plus its base URL; call `server.close()` to stop.
export const startServer = (rootPath) =>
  new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      try {
        const urlPath = decodeURIComponent(
          new URL(req.url, "http://localhost").pathname,
        );
        let filePath = path.join(rootPath, urlPath);
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
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}/` });
    });
  });

// Launch flags that keep Chrome happy in CI (commonly runs as root, where Chrome
// refuses to start without --no-sandbox). Puppeteer downloads its own Chrome;
// PUPPETEER_EXECUTABLE_PATH can override it.
export const launchBrowser = (debug) =>
  puppeteer.launch({
    headless: !debug,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    ...(debug ? { slowMo: 100 } : {}),
  });

// Takes the full-resolution (3x) screenshot of a single page and writes it to
// <outputDir>/<exampleDir>/<name>@3x.png. Returns the file path.
export async function snapPicture(
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
  const bigPicture = path.join(outputDir, exampleDir, name + "@3x.png");
  const page = await browser.newPage();

  if (debug) {
    page.on("console", (message) => {
      const { url: u, lineNumber } = message.location();
      const loc = u ? ` (${u}${lineNumber ? `:${lineNumber}` : ""})` : "";
      console.log(`\nPage log:${loc}\n${message.text()}\n`);
    });
    page.on("pageerror", (error) => console.log("\nPage error:", error, "\n"));
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
  return bigPicture;
}

// Produces one resized derivative of a screenshot at the given scale (1/2/3)
// and format (png/webp). The 3x file is the source produced by snapPicture.
export async function resize(baseName, sourcePath, w, h, scale, format) {
  const fileName =
    baseName + (scale > 1 ? "@" + scale + "x" : "") + "." + format;
  await sharp(sourcePath)
    .resize(w * scale, h * scale)
    [format]()
    .toFile(fileName);
  return fileName;
}
