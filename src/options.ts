import chalk from "chalk";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { Options } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Raw options as parsed by commander (paths unresolved, flags possibly unset).
export type RawOptions = {
  inputDir?: string;
  outputDir?: string;
  width?: number;
  height?: number;
  templateFile?: string;
  assetDir?: string;
  debug?: boolean;
  ellie?: boolean;
  baseUrl?: string | null;
  screenshots?: boolean;
  watch?: boolean;
  port?: number;
  ellieDep?: Record<string, string>;
};

// Resolves a path to an absolute one, falling back to a default (e.g. the
// bundled template) when the given path doesn't exist.
const resolveOr = (p: string, fallback: string): string => {
  const absolute = path.resolve(p);
  if (fs.existsSync(absolute)) return absolute;
  console.log(
    chalk.yellow(`The path ${p} doesn't exist. Falling back to ${fallback}.`),
  );
  return fallback;
};

export default ({
  inputDir = "./examples",
  outputDir = "./build",
  width = 990,
  height = 504,
  templateFile = "./docs/Docs.elm",
  assetDir = "./docs/assets",
  debug = false,
  ellie = false,
  baseUrl = null,
  screenshots = true,
  watch = false,
  port = 8181,
  ellieDep = {},
}: RawOptions): Options => {
  const absOutputDir = path.resolve(outputDir);
  fs.mkdirSync(absOutputDir, { recursive: true });

  const options: Options = {
    inputDir: path.resolve(inputDir),
    outputDir: absOutputDir,
    width,
    height,
    templateFile: resolveOr(
      templateFile,
      path.resolve(__dirname, "templates", "Docs.elm"),
    ),
    assetDir: resolveOr(
      assetDir,
      path.resolve(__dirname, "templates", "assets"),
    ),
    debug,
    ellie:
      ellie || Object.keys(ellieDep).length > 0
        ? { baseUrl, additionalDependencies: ellieDep }
        : false,
    screenshots,
    watch,
    port,
  };
  if (debug) {
    console.log(
      chalk.yellow("Resolved options: ") + JSON.stringify(options, null, 2),
    );
  }
  return options;
};
