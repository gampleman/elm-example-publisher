const StaticServer = require("static-server"),
  path = require("path"),
  captureWebsite = require("capture-website"),
  sharp = require("sharp"),
  log = require("./log");

function snapPicture(
  outputDir,
  exampleDir,
  name,
  output,
  delay,
  width,
  height,
  debug
) {
  const dir = path.join(outputDir.absolute, exampleDir);
  var bigPicture = path.join(dir, name + "@3x.png");
  return captureWebsite
    .file(output, bigPicture, {
      inputType: "url",
      scaleFactor: 1,
      overwrite: true,
      debug,
      width,
      height,
      delay,
    })
    .then(function () {
      log.generated(
        path.join(outputDir.relative, exampleDir, name + "@3x.png")
      );
      var w = Math.floor(width / 3),
        h = Math.floor(height / 3);
      var resizer = sharp(bigPicture);

      return Promise.all(
        [1, 2]
          .flatMap((factor) => {
            const endName = name + (factor > 1 ? "@" + factor + "x" : "");
            var fName = path.join(dir, endName + ".png");
            var resized = resizer.clone().resize(w * factor, h * factor);

            return [
              resized
                .clone()
                .webp()
                .toFile(path.join(dir, endName + ".webp")),

              resized.toFile(fName).then(function () {
                log.generated(
                  path.join(outputDir.relative, exampleDir, endName + ".png")
                );
                log.generated(
                  path.join(outputDir.relative, exampleDir, endName + ".webp")
                );
              }),
            ];
          })
          .concat(
            resizer
              .clone()
              .webp()
              .toFile(path.join(dir, name + "@3x.webp"))
              .then(() => {
                log.generated(
                  path.join(outputDir.relative, exampleDir, name + "@3x.webp")
                );
              })
          )
      );
    });
}

const runServer = (rootPath, cb) => {
  const port = 4985;
  const server = new StaticServer({ rootPath, port });
  return new Promise((resolve, reject) => {
    server.start(
      cb(`http://localhost:${port}/`).then((result) => {
        server.stop();
        resolve(result);
      }, reject)
    );
  });
};

module.exports = (examples, outputDir, debug) => {
  log.heading("Taking screenshots");
  return runServer(outputDir.absolute, (baseUrl) =>
    Promise.all(
      examples.flatMap((example) => {
        const snaps = ["preview", ...[example.tags.screenshot || []].flat()];
        return snaps.map((snap) => {
          const url = `${baseUrl}${example.basename}/iframe.html${
            snap === "preview" ? "" : "#" + snap
          }`;
          return snapPicture(
            outputDir,
            example.basename,
            snap,
            url,
            example.tags.delay || 0,
            example.width,
            example.height,
            debug
          );
        });
      })
    )
  );
};
