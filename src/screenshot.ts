import path from "node:path";
import http from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import puppeteer, { type Browser } from "puppeteer";
import sharp from "sharp";

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

export type RunningServer = { server: http.Server; baseUrl: string };

// A minimal static file server for serving compiled examples to the browser.
export const startServer = (rootPath: string): Promise<RunningServer> =>
  new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      try {
        const urlPath = decodeURIComponent(
          new URL(req.url ?? "/", "http://localhost").pathname,
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
          CONTENT_TYPES[path.extname(filePath).toLowerCase()] ??
            "application/octet-stream",
        );
        createReadStream(filePath).pipe(res);
      } catch (error) {
        res.statusCode = 500;
        res.end(String(error));
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}/` });
    });
  });

// Launch flags that keep Chrome happy in CI (commonly runs as root, where Chrome
// refuses to start without --no-sandbox). Puppeteer downloads its own Chrome;
// PUPPETEER_EXECUTABLE_PATH can override it.
export const launchBrowser = (debug: boolean): Promise<Browser> =>
  puppeteer.launch({
    headless: !debug,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    ...(debug ? { slowMo: 100 } : {}),
  });

type ImageFormat = "png" | "webp";

// Takes the full-resolution (3x) screenshot of a single page and writes it to
// <outputDir>/<exampleDir>/<name>@3x.png. Returns the file path.
export async function snapPicture(
  browser: Browser,
  outputDir: string,
  exampleDir: string,
  name: string,
  url: string,
  delay: number,
  width: number,
  height: number,
  debug: boolean,
): Promise<string> {
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
    await page.screenshot({ path: bigPicture as `${string}.png` });
  } finally {
    await page.close();
  }
  return bigPicture;
}

// Produces one resized derivative of a screenshot at the given scale (1/2/3)
// and format (png/webp). The 3x file is the source produced by snapPicture.
export async function resize(
  baseName: string,
  sourcePath: string,
  w: number,
  h: number,
  scale: number,
  format: ImageFormat,
): Promise<string> {
  const fileName =
    baseName + (scale > 1 ? "@" + scale + "x" : "") + "." + format;
  const resized = sharp(sourcePath).resize(w * scale, h * scale);
  await (format === "webp" ? resized.webp() : resized.png()).toFile(fileName);
  return fileName;
}
