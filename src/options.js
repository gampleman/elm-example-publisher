module.exports = ({
  inputDir = ".",
  outputDir = "../build",
  width = 990,
  height = 504,
  templateFile = "../docs/Docs.elm",
  assetDir = "../docs/assets"
}) => {
  console.log("resolved options", {
    inputDir,
    outputDir,
    width,
    height,
    templateFile,
    assetDir
  });
  return { inputDir, outputDir, width, height, templateFile, assetDir };
};
