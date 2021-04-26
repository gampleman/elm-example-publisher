const elm = require("node-elm-compiler"),
  path = require("path"),
  fs = require("fs").promises,
  minify = require("html-minifier").minify,
  log = require("./log");

async function compileElm(input, output, disableMinification) {
  const src = await elm.compileToString(input, {
    output: output,
    optimize: true,
  });
  return await fs.writeFile(
    output,
    disableMinification ? src : minify(src, {
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

const buildExample = async (example, inputDir, outputDir) => {
  await fs.mkdir(path.join(outputDir.absolute, example.basename), {
    recursive: true,
  });
  const target = path.join(outputDir.relative, example.basename, "iframe.html");
  const targetAbs = path.join(
    outputDir.absolute,
    example.basename,
    "iframe.html"
  );

  await compileElm(
    path.relative(inputDir.absolute, example.filename),
    targetAbs,
    example.tags.minify && example.tags.minify === "false"
  );

  log.generated(target);
  await Promise.all(
    [example.tags.requires || []].flat().map(async (dep) => {
      const targetDir = path.dirname(
        path.join(outputDir.absolute, example.basename, dep)
      );
      await fs.mkdir(targetDir, { recursive: true });
      await fs.copyFile(
        path.join(inputDir.absolute, dep),
        path.join(outputDir.absolute, example.basename, dep)
      );
      log.generated(path.join(outputDir.relative, example.basename, dep));
    })
  );
};

module.exports = async (examples, inputDir, outputDir) => {
  log.heading("Compiling examples");
  if (examples.length === 0) return [];
  // We compile the first example before all the others, so we only download
  // dependencies once. When that is done, we can compile everything else
  // in parallel.
  const oldcwd = process.cwd();

  process.chdir(inputDir.absolute);
  const [head, ...tail] = examples;
  try {
    await buildExample(head, inputDir, outputDir);
    await Promise.all(
      tail.map((example) => buildExample(example, inputDir, outputDir))
    );
  } finally {
    process.chdir(oldcwd);
  }

  return examples;
};
