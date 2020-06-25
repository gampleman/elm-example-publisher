const processOptions = require("./options"),
  gather = require("./gather"),
  buildExamples = require("./buildExamples"),
  makeScreenshots = require("./screenshots"),
  buildSite = require("./buildSite"),
  // generateServiceWorker = require("./generateServiceWorker"),
  publishEllies = require("./publishEllies"),
  chalk = require("chalk");

module.exports = async (options) => {
  const start = new Date();
  const {
    inputDir,
    outputDir,
    width,
    height,
    templateFile,
    assetDir,
    debug,
    ellie,
    screenshots,
    compile,
  } = processOptions(options);
  let examples = await gather(inputDir, width, height);
  if (compile) await buildExamples(examples, inputDir, outputDir);
  if (screenshots)
    await makeScreenshots(examples, outputDir, debug, width, height);
  if (ellie) {
    examples = await publishEllies(examples, inputDir, ellie);
  }
  await buildSite(examples, inputDir, outputDir, templateFile, assetDir);
  // await generateServiceWorker(outputDir);
  console.log(
    chalk.bold.green(
      `Done. Completed in ${Math.ceil((new Date() - start) / 1000)} seconds`
    )
  );
};
