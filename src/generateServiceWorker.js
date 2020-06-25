const path = require("path"),
  workboxBuild = require("workbox-build"),
  log = require("./log");

module.exports = async (outputDir) => {
  log.heading("Generating service worker");
  const target = path.join(outputDir.absolute, "service-worker.js");
  await workboxBuild.generateSW({
    swDest: target,
    globDirectory: outputDir.absolute,
    globPatterns: ["**/*.{html,css}", "**/preview.png"],
  });
  log.generated(path.join(outputDir.relative, "service-worker.js"));
};
