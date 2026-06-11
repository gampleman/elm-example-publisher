import chalk from "chalk";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const Path = (relative, absolute) => {
  absolute = absolute || path.resolve(relative);
  return {
    relative,
    absolute,
    join(...segments) {
      return Path(
        path.join(relative, ...segments),
        path.join(absolute, ...segments),
      );
    },
    toString() {
      return relative;
    },
    ensure() {
      fs.mkdirSync(absolute, { recursive: true });
      return this;
    },
    ifNotExists(other) {
      if (!fs.existsSync(absolute)) {
        console.log(
          chalk.yellow(
            `The path ${relative} doesn't exist. Falling back to ${other}.`,
          ),
        );
        return Path(other, other);
      }
      return this;
    },
  };
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
  compile = true,
  ...opts
}) => {
  if (ellie || Object.entries(opts.ellieDep).length > 0) {
    ellie = {
      baseUrl,
      additionalDependencies: opts.ellieDep,
    };
  }
  const options = {
    inputDir: Path(inputDir),
    outputDir: Path(outputDir).ensure(),
    width,
    height,
    templateFile: Path(templateFile).ifNotExists(
      path.resolve(__dirname, "templates", "Docs.elm"),
    ),
    assetDir: Path(assetDir).ifNotExists(
      path.resolve(__dirname, "templates", "assets"),
    ),
    debug,
    ellie,
    screenshots: compile && screenshots,
    compile,
  };
  if (debug) {
    console.log(
      chalk.yellow("Resolved options: ") + JSON.stringify(options, null, 2),
    );
  }
  return options;
};
