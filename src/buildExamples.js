const elm = require("node-elm-compiler"),
  path = require("path"),
  fs = require("fs").promises,
  minify = require("html-minifier").minify;

async function compileElm(input, output) {
  const src = await elm.compileToString(input, {
    output: output,
    optimize: true
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
            "A9"
          ],
          pure_getters: true,
          keep_fargs: false,
          unsafe_comps: true,
          unsafe: true,
          passes: 2
        }
      }
    })
  );
}

const buildExample = async (example, inputDir, outputDir) => {
  await fs.mkdir(path.join(outputDir, example.basename), { recursive: true });
  const target = path.join(outputDir, example.basename, "iframe.html");

  await compileElm(example.filename, path.resolve(target));
  console.log("Succesfully generated " + target);
  await Promise.all(
    [example.tags.requires || []].flat().map(async dep => {
      const targetDir = path.dirname(
        path.join(outputDir, example.basename, dep)
      );
      await fs.mkdir(targetDir, { recursive: true });
      await fs.copyFile(
        path.join(inputDir, dep),
        path.join(outputDir, example.basename, dep)
      );
      console.log(
        "Succesfully generated " + path.join(outputDir, example.basename, dep)
      );
    })
  );
};

module.exports = async (examples, inputDir, outputDir) => {
  if (examples.length === 0) return [];
  // We compile the first example before all the others, so we only download
  // dependencies once. When that is done, we can compile everything else
  // in parallel.
  const [head, ...tail] = examples;
  // console.log("building head");
  await buildExample(head, inputDir, outputDir);
  // console.log("done with head");
  await Promise.all(
    tail.map(example => buildExample(example, inputDir, outputDir))
  );
  // for (let example of tail) {
  //   console.log("building", example.basename);
  //   await buildExample(example, inputDir, outputDir);
  // }
  return examples;
};
