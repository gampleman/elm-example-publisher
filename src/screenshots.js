const StaticServer = require("static-server"),
  path = require("path"),
  captureWebsite = require("capture-website"),
  sharp = require("sharp");

function snapPicture(dir, name, output, delay, width, height) {
  var bigPicture = path.join(dir, name + "@3x.png");
  return captureWebsite
    .file(output, bigPicture, {
      inputType: "url",
      scaleFactor: 1,
      overwrite: true,
      width,
      height,
      delay
    })
    .then(function() {
      console.log("Succesfully generated " + bigPicture);
      var w = Math.floor(width / 3),
        h = Math.floor(height / 3);
      var resizer = sharp(bigPicture);

      return Promise.all(
        [1, 2]
          .flatMap(factor => {
            var fName = path.join(
              dir,
              name + (factor > 1 ? "@" + factor + "x.png" : ".png")
            );
            var resized = resizer.clone().resize(w * factor, h * factor);

            return [
              resized
                .clone()
                .webp()
                .toFile(
                  path.join(
                    dir,
                    name + (factor > 1 ? "@" + factor + "x.webp" : ".webp")
                  )
                ),

              resized.toFile(fName).then(function() {
                console.log("Succesfully generated " + fName);
              })
            ];
          })
          .concat(
            resizer
              .clone()
              .webp()
              .toFile(path.join(dir, name + "@3x.webp"))
          )
      );
    });
}

const runServer = (rootPath, cb) => {
  const port = 4985;
  const server = new StaticServer({ rootPath, port });
  return new Promise((resolve, reject) => {
    server.start(
      cb(`http://localhost:${port}/`).then(result => {
        server.stop();
        resolve(result);
      }, reject)
    );
  });
};

module.exports = (examples, outputDir) => {
  return runServer(outputDir, baseUrl =>
    Promise.all(
      examples.flatMap(example => {
        const snaps = ["preview", ...[example.tags.screenshot || []].flat()];
        return snaps.map(snap => {
          const url = `${baseUrl}${example.basename}/iframe.html${
            snap === "preview" ? "" : "#" + snap
          }`;
          return snapPicture(
            path.join(outputDir, example.basename),
            snap,
            url,
            example.tags.delay || 0,
            example.width,
            example.height
          );
        });
      })
    )
  );
};
