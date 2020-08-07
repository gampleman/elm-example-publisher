const elm = require("node-elm-compiler"),
  path = require("path"),
  fs = require("fs").promises,
  minify = require("html-minifier").minify;

async function compileElm(input, output, cwd) {
  const src = await elm.compileToString(input, {
    output: output,
    optimize: true,
    cwd,
  });
  return await fs.writeFile(
    output,
    minify(src, {
      minifyJS: {
        mangle: true,
        compress: {
          pure_funcs: [
            "F2",
            "F3",
            "F4",
            "F5",
            "F6",
            "F7",
            "F8",
            "F9",
            "A2",
            "A3",
            "A4",
            "A5",
            "A6",
            "A7",
            "A8",
            "A9",
          ],
          pure_getters: true,
          keep_fargs: false,
          unsafe_comps: true,
          unsafe: true,
          passes: 2,
        },
      },
    })
  );
}

module.exports = async (example, inputDir, outputDir) => {
  await fs.mkdir(path.join(outputDir, example.basename), {
    recursive: true,
  });
  const target = path.join(outputDir, example.basename, "iframe.html");

  await compileElm(path.relative(inputDir, example.filename), target, inputDir);
  return target;

  //   await Promise.all(
  //     [example.tags.requires || []].flat().map(async (dep) => {
  //       const targetDir = path.dirname(
  //         path.join(outputDir.absolute, example.basename, dep)
  //       );
  //       await fs.mkdir(targetDir, { recursive: true });
  //       await fs.copyFile(
  //         path.join(inputDir.absolute, dep),
  //         path.join(outputDir.absolute, example.basename, dep)
  //       );
  //       log.generated(path.join(outputDir.relative, example.basename, dep));
  //     })
  //   );
};
