import elm from "node-elm-compiler";
import path from "node:path";
import { promises as fs } from "node:fs";
import { minify } from "html-minifier-terser";

const { compileToString } = elm;

async function compileElm(input, output, cwd, disableMinification) {
  const src = await compileToString([input], {
    output,
    optimize: true,
    cwd,
  });
  const result = disableMinification
    ? src
    : await minify(src, {
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
      });
  await fs.writeFile(output, result);
}

// Compiles a single example's Elm program to a self-contained iframe.html.
export default async (example, inputDir, outputDir) => {
  await fs.mkdir(path.join(outputDir, example.basename), { recursive: true });
  const target = path.join(outputDir, example.basename, "iframe.html");
  await compileElm(
    path.relative(inputDir, example.filename),
    target,
    inputDir,
    example.tags.minify === "false",
  );
  return target;
};
