const { JSDOM } = require("jsdom"),
  { compileToString } = require("node-elm-compiler"),
  path = require("path"),
  os = require("os"),
  fs = require("fs").promises,
  minify = require("html-minifier").minify,
  copyDir = require("copy-dir").sync;

module.exports = async (
  examples,
  inputDir,
  outputDir,
  templateFile,
  assetDir
) => {
  const workDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "elm-example-publisher-")
  );
  const curDir = path.dirname(templateFile);

  const elmJsonPath = path.join(curDir, "elm.json");
  const elmJson = await fs.readFile(elmJsonPath, "utf8").then(JSON.parse);
  elmJson["source-directories"] = elmJson["source-directories"]
    .map(p => path.resolve(curDir, p))
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
  const absTemplatePath = path.resolve(templateFile);

  const oldcwd = process.cwd();
  process.chdir(workDir);
  const source = await compileToString([absTemplatePath], { optimize: true });
  process.chdir(oldcwd);

  const dom = new JSDOM(
    `<!DOCTYPE html><html><head><!--replace-headers--></head><body><div></div></body></html>`,
    { pretendToBeVisual: true, runScripts: "outside-only" }
  );

  dom.window.eval(source);

  const htmls = await new Promise((resolve, reject) => {
    let expecting = "index";
    let remaining = examples.slice();
    const results = examples.reduce(
      (res, example) => {
        res[example.basename] = { html: "", meta: [], example };
        return res;
      },
      { index: { html: "", meta: [] } }
    );
    const observer = new dom.window.MutationObserver(ml => {
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
      characterData: true
    });
    const elmApp = dom.window.Elm.Docs.init({
      flags: examples
    });

    elmApp.ports.errorPort.subscribe(err => {
      console.error("port error:", err);
      reject(err);
    });

    elmApp.ports.renderPagePort.subscribe(({ name, meta }) => {
      results[name].meta = meta;
    });
  });

  // write files

  await Promise.all(
    Object.entries(htmls).map(async ([key, item]) => {
      const html = minify(
        item.html.replace(
          "<!--replace-headers-->",
          item.meta
            .map(({ key, value }) => `<meta name="${key}" content="${value}">`)
            .join("\n")
        ),
        {
          html5: true,
          minifyCSS: {
            level: {
              2: {
                all: true
              }
            }
          },
          removeRedundantAttributes: true,
          sortAttributes: true
        }
      );
      let target;
      if (key === "index") {
        target = path.join(outputDir, "index.html");
      } else {
        target = path.join(outputDir, key, "index.html");
        await fs.mkdir(path.join(outputDir, key), { recursive: true });
      }
      await fs.writeFile(target, html, "utf8");
      console.log("Succesfully generated ", target);
    })
  );

  copyDir(assetDir, path.join(outputDir, path.relative(curDir, assetDir)));
};
