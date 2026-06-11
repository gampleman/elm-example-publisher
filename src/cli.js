#!/usr/bin/env node

import { program } from "commander";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import main from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(path.join(__dirname, "..", "package.json"), "utf8"),
);

const dependency = (dep, previous) => {
  const [name, version] = dep.trim().split("@");
  if (!name.match(/^\S+\/\S+$/)) {
    console.warn(
      "Expected dependency name to be author/package, but found: " + name,
    );
    console.warn("Proceeding anyway. Hit ^C to abort.");
  }
  if (!version.match(/^\d+\.\d+\.\d+$/)) {
    console.error(
      "Expected dependency version to be MAJOR.MINOR.PATCH, instead found: " +
        version,
    );
    throw "Aborting";
  }
  return { ...previous, [name]: version };
};

program
  .version(pkg.version)
  .description(
    "Turns a directory of small example Elm programs into a beautiful website to browse them",
  )
  .option(
    "--input-dir <dir>",
    "Where to find the examples. (default = ./examples)",
  )
  .option(
    "--output-dir <dir>",
    "Where to put the built website. (default = ./build)",
  )
  .option(
    "--template-file <file>",
    "Use this file to make the site (default = ./docs/Docs.elm)",
  )
  .option(
    "--asset-dir <dir>",
    "Copy this directory to outp (default = ./docs/assets)",
  )
  .option("--width <pixels>", "Width of the webpage (default = 990)", parseInt)
  .option(
    "--height <pixels>",
    "Height of the webpage (default = 504)",
    parseInt,
  )
  .option("--no-screenshots", "Skips taking screenshots of the examples")
  .option(
    "--watch",
    "Rebuild incrementally on changes and serve the site with live reload",
  )
  .option(
    "--port <port>",
    "Port for the --watch dev server (default = 8181)",
    (v) => parseInt(v, 10),
  )
  .option("--debug", "Turns on debug mode which will spit out more output")
  .option("--ellie", "Will create a new Ellie for each example")
  .option(
    "--ellie-dep <dependency>",
    "Add an additional extra dependency to the created Ellie. Format is username/packagename@version. Can be passed multiple times. Useful to include the published version of the package itself.",
    dependency,
    {},
  )
  .option(
    "--base-url <url>",
    "The url where the site will be deployed. Used for examples requiring resources from Ellie.",
  )
  .parse(process.argv);

main(program.opts()).catch(function (e) {
  console.error("Something went wrong");
  console.error(e);
  process.exit(1);
});
