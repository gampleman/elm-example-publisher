#!/usr/bin/env node

var program = require("commander"),
  main = require('./index.js'),
  fs = require("fs"),
  _ = require("lodash");

function templateData(value, object) {
  if (fs.existsSync(value)) {
    return _.merge(object, JSON.parse(fs.readFileSync(value, "utf8")));
  } else {
    return _.merge(object, JSON.parse(value));
  }
}

program
  .version(require("../package.json").version)
  .description(
    "Processes files in the input directory and outputs generated HTML in the output-directory"
  )
  .option('--output-dir <dir>', 'Where to put the built website. (default = ../build)')
  .option(
    "--template-file <file>",
    "Use this file to make the site (default = ../docs/assets)"
  )
  .option("--width <pixels>", "Width of the webpage (default = 990)", parseInt)
  .option(
    "--height <pixels>",
    "Height of the webpage (default = 504)",
    parseInt
  )
  .parse(process.argv);

main({
  outputDir: program.outputDir,
  templateFile: program.templateFile,
  width: program.width,
  height: program.height,
}).catch(function (e) {
  console.error("Something went wrong");
  console.error(e);
  process.exit(1);
});
