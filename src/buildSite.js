const { JSDOM } = require("jsdom"),
  { compileToString } = require("node-elm-compiler"),
  path = require("path"),
  os = require("os"),
  fs = require("fs").promises,
  minify = require("html-minifier").minify,
  copyDir = require("copy-dir").sync,
  hljs = require("highlight.js"),
  log = require("./log");

const prepareTemplate = async (inputDir, outputDir, templateFile, assetDir) => {
  const workDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "elm-example-publisher-")
  );
  const curDir = path.dirname(templateFile.absolute);

  const elmJsonPath = path.join(curDir, "elm.json");
  const elmJson = await fs.readFile(elmJsonPath, "utf8").then(JSON.parse);
  elmJson["source-directories"] = elmJson["source-directories"]
    .map((p) => path.resolve(curDir, p))
    .concat(["."]);
  await fs.writeFile(
    path.join(workDir, "elm.json"),
    JSON.stringify(elmJson),
    "utf8"
  );
  await fs.copyFile(
    path.join(__dirname, "ExamplePublisher.elm"),
    path.join(workDir, "ExamplePublisher.elm")
  );

  const oldcwd = process.cwd();
  process.chdir(workDir);
  const source = await compileToString([templateFile.absolute], {
    optimize: true,
  });
  process.chdir(oldcwd);
  log.generated("Compiled template");
  copyDir(
    assetDir.absolute,
    path.join(outputDir.absolute, path.basename(assetDir.absolute))
  );
  log.generated(
    path.join(outputDir.relative, path.basename(assetDir.absolute))
  );
  return source;
};

const runTemplate = async (source, examples) => {
  const dom = new JSDOM(
    `<!DOCTYPE html><html><head><!--replace-headers--></head><body><div></div></body></html>`,
    { pretendToBeVisual: true, runScripts: "outside-only" }
  );

  dom.window.eval(source);

  return await new Promise((resolve, reject) => {
    let expecting = "index";
    let remaining = examples.slice();
    const results = examples.reduce(
      (res, example) => {
        res[example.basename] = { html: "", meta: [], example };
        return res;
      },
      { index: { html: "", meta: [] } }
    );
    const observer = new dom.window.MutationObserver((ml) => {
      results[expecting].html = dom.serialize();
      const next = remaining.shift();
      if (next) {
        expecting = next.basename;
        elmApp.ports.proceed.send(expecting);
      } else {
        resolve(results);
      }
    });
    observer.observe(dom.window.document.body, {
      subtree: true,
      childList: true,
      attribute: true,
      characterData: true,
    });
    const elmApp = dom.window.Elm.Docs.init({
      flags: examples,
    });

    elmApp.ports.errorPort.subscribe((err) => {
      console.error("port error:", err);
      reject(err);
    });

    elmApp.ports.renderPagePort.subscribe(({ name, meta }) => {
      results[name].meta = meta;
    });
  });
};

const postprocessOutput = async (htmls) =>
  Object.entries(htmls).map(([key, item]) => {
    const dom = new JSDOM(item.html);
    dom.window.document.querySelectorAll("pre code").forEach((block) => {
      hljs.highlightBlock(block);
    });
    return [
      key,
      dom
        .serialize()
        .replace(
          "<!--replace-headers-->",
          item.meta
            .map(({ key, value }) => `<meta name="${key}" content="${value}">`)
            .join("\n")
        ),
    ];
  });

module.exports = async (
  examples,
  inputDir,
  outputDir,
  templateFile,
  assetDir
) => {
  log.heading("Building website");
  const source = await prepareTemplate(
    inputDir,
    outputDir,
    templateFile,
    assetDir
  );
  const htmls = await postprocessOutput(await runTemplate(source, examples));
  // write files

  await Promise.all(
    htmls.map(async ([key, item]) => {
      const html = minify(item, {
        html5: true,
        minifyCSS: {
          level: {
            2: {
              all: true,
            },
          },
        },
        removeRedundantAttributes: true,
        sortAttributes: true,
      });
      let target;
      if (key === "index") {
        target = path.join(outputDir.absolute, "index.html");
      } else {
        target = path.join(outputDir.absolute, key, "index.html");
        await fs.mkdir(path.join(outputDir.absolute, key), { recursive: true });
      }
      await fs.writeFile(target, html, "utf8");
      log.generated(
        key === "index"
          ? path.join(outputDir.relative, "index.html")
          : path.join(outputDir.relative, key, "index.html")
      );
    })
  );
};
