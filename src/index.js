import processOptions from "./options.js";
import gather from "./gather.js";
import buildExamples from "./buildExamples.js";
import makeScreenshots from "./screenshots.js";
import buildSite from "./buildSite.js";
import publishEllies from "./publishEllies.js";
import chalk from "chalk";

export default async (options) => {
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
  console.log(
    chalk.bold.green(
      `Done. Completed in ${Math.ceil((new Date() - start) / 1000)} seconds`,
    ),
  );
};
