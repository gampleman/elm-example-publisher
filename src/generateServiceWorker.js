const path = require("path"),
  workboxBuild = require("workbox-build");

module.exports = async outputDir => {
  const target = path.join(outputDir, "service-worker.js");
  await workboxBuild.generateSW({
    swDest: target,
    globDirectory: outputDir,
    globPatterns: ["**/*.{html,css}", "**/preview.png"]
  });
  console.log("Succesfully generated ", target);
};
