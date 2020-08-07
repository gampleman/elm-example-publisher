const StaticServer = require("static-server"),
  path = require("path"),
  captureWebsite = require("capture-website"),
  sharp = require("sharp");

const runServer = (rootPath, cb) => {
  const port = 4985;
  const server = new StaticServer({ rootPath, port });
  server.start(() => cb(`http://localhost:${port}/`));
};

async function snapPicture(
  outputDir,
  exampleDir,
  name,
  output,
  delay,
  width,
  height,
  debug
) {
  const dir = path.join(outputDir, exampleDir);
  var bigPicture = path.join(dir, name + "@3x.png");
  await captureWebsite.file(output, bigPicture, {
    inputType: "url",
    scaleFactor: 1,
    overwrite: true,
    debug,
    width,
    height,
    delay,
  });
  return bigPicture;
}

async function resize(baseName, picturePath, w, h, scale, format) {
  console.log(`resizing ${baseName} to ${w}x${h} format=${format}`);
  var resizer = sharp(picturePath);
  const fileName =
    baseName + (scale > 1 ? "@" + scale + "x" : "") + "." + format;
  await resizer.resize(w * scale, h * scale).toFile(fileName);
  return fileName;
}

module.exports = {
  runServer,
  snapPicture,
  resize,
};
