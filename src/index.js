const processOptions = require("./options"),
  gather = require("./gather"),
  buildExamples = require("./buildExamples"),
  makeScreenshots = require("./screenshots"),
  buildSite = require("./buildSite"),
  generateServiceWorker = require("./generateServiceWorker");

module.exports = async options => {
  const {
    inputDir,
    outputDir,
    width,
    height,
    templateFile,
    assetDir
  } = processOptions(options);
  const examples = await gather(inputDir, width, height);
  await Promise.all([
    buildExamples(examples, inputDir, outputDir).then(() =>
      makeScreenshots(examples, outputDir, width, height)
    ),
    buildSite(examples, inputDir, outputDir, templateFile, assetDir)
  ]);
  await generateServiceWorker(outputDir);
};
