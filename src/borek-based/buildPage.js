const { JSDOM } = require("jsdom"),
  minify = require("html-minifier").minify,
  path = require("path"),
  hljs = require("highlight.js"),
  fs = require("fs").promises;

const renderPage = async (source, examples, target) => {
  const dom = new JSDOM(
    `<!DOCTYPE html><html><head><!--replace-headers--></head><body><div></div></body></html>`,
    { pretendToBeVisual: true, runScripts: "outside-only" }
  );

  dom.window.eval(source);

  const renderedHtml = await new Promise((resolve, reject) => {
    const result = { html: "", meta: [] };
    const observer = new dom.window.MutationObserver((ml) => {
      observer.disconnect();
      dom.window.document.querySelectorAll("pre code").forEach((block) => {
        hljs.highlightBlock(block);
      });
      resolve(
        dom
          .serialize()
          .replace(
            "<!--replace-headers-->",
            result.meta
              .map(
                ({ key, value }) => `<meta name="${key}" content="${value}">`
              )
              .join("\n")
          )
      );
    });
    observer.observe(dom.window.document.body, {
      subtree: true,
      childList: true,
      attribute: true,
      characterData: true,
    });
    const elmApp = dom.window.Elm.Docs.init({
      flags: { examples, render: target },
    });

    elmApp.ports.errorPort.subscribe((err) => {
      console.error("port error:", err);
      reject(err);
    });

    elmApp.ports.renderPagePort.subscribe(({ name, meta }) => {
      result.meta = meta;
    });
  });

  dom.window.close();

  return minify(renderedHtml, {
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
};

const renderExamplePage = async (outputDir, source, examples, example) => {
  const html = await renderPage(source, examples, example.basename);
  const target = path.join(outputDir, example.basename, "index.html");
  await fs.mkdir(path.join(outputDir, example.basename), {
    recursive: true,
  });

  await fs.writeFile(target, html, "utf8");
  return target;
};

const renderIndexPage = async (outputDir, source, examples) => {
  const html = await renderPage(source, examples, "index");
  const target = path.join(outputDir, "index.html");

  await fs.writeFile(target, html, "utf8");
  return target;
};

module.exports = { renderExamplePage, renderIndexPage };
