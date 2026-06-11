import { JSDOM } from "jsdom";
import { minify } from "html-minifier-terser";
import path from "node:path";
import hljs from "highlight.js";
import { promises as fs } from "node:fs";

// Runs the compiled Elm template (`source`) for a single page identified by
// `target` ("index" or an example basename), applies syntax highlighting to
// any code blocks, and returns the minified HTML.
const renderPage = async (source, examples, target) => {
  const dom = new JSDOM(
    `<!DOCTYPE html><html><head><!--replace-headers--></head><body><div></div></body></html>`,
    { pretendToBeVisual: true, runScripts: "outside-only" },
  );

  dom.window.eval(source);

  const renderedHtml = await new Promise((resolve, reject) => {
    const result = { meta: [] };
    const observer = new dom.window.MutationObserver(() => {
      observer.disconnect();
      dom.window.document.querySelectorAll("pre code").forEach((block) => {
        hljs.highlightElement(block);
      });
      resolve(
        dom
          .serialize()
          .replace(
            "<!--replace-headers-->",
            result.meta
              .map(
                ({ key, value }) => `<meta name="${key}" content="${value}">`,
              )
              .join("\n"),
          ),
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
      reject(new Error(err));
    });

    elmApp.ports.renderPagePort.subscribe(({ meta }) => {
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

export const renderExamplePage = async (
  outputDir,
  source,
  examples,
  example,
) => {
  const html = await renderPage(source, examples, example.basename);
  await fs.mkdir(path.join(outputDir, example.basename), { recursive: true });
  const target = path.join(outputDir, example.basename, "index.html");
  await fs.writeFile(target, html, "utf8");
  return target;
};

export const renderIndexPage = async (outputDir, source, examples) => {
  const html = await renderPage(source, examples, "index");
  const target = path.join(outputDir, "index.html");
  await fs.writeFile(target, html, "utf8");
  return target;
};
