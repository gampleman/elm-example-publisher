import chalk from "chalk";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolves a path to an absolute one, falling back to a default (e.g. the
// bundled template) when the given path doesn't exist.
const resolveOr = (p, fallback) => {
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
  ...opts
}) => {
  if (ellie || Object.entries(opts.ellieDep || {}).length > 0) {
    ellie = {
      baseUrl,
      additionalDependencies: opts.ellieDep || {},
    };
  }

  const absOutputDir = path.resolve(outputDir);
  fs.mkdirSync(absOutputDir, { recursive: true });

  const options = {
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
    ellie,
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
