import { JSDOM } from "jsdom";
import { minify } from "html-minifier-terser";
import path from "node:path";
import hljs from "highlight.js";
import { promises as fs } from "node:fs";
import type { Example } from "./types.js";

type Meta = { key: string; value: string };

// Runs the compiled Elm template (`source`) for a single page identified by
// `target` ("index" or an example basename), applies syntax highlighting to
// any code blocks, and returns the minified HTML.
const renderPage = async (
  source: string,
  examples: Example[],
  target: string,
): Promise<string> => {
  const dom = new JSDOM(
    `<!DOCTYPE html><html><head><!--replace-headers--></head><body><div></div></body></html>`,
    { pretendToBeVisual: true, runScripts: "outside-only" },
  );
  const window = dom.window as unknown as {
    eval: (code: string) => void;
    document: Document;
    MutationObserver: typeof MutationObserver;
    Elm: {
      Docs: {
        init: (opts: { flags: unknown }) => {
          ports: {
            errorPort: { subscribe: (cb: (err: string) => void) => void };
            renderPagePort: {
              subscribe: (cb: (data: { meta: Meta[] }) => void) => void;
            };
          };
        };
      };
    };
    close: () => void;
  };

  window.eval(source);

  const renderedHtml = await new Promise<string>((resolve, reject) => {
    const result: { meta: Meta[] } = { meta: [] };
    const observer = new window.MutationObserver(() => {
      observer.disconnect();
      window.document.querySelectorAll("pre code").forEach((block) => {
        hljs.highlightElement(block as HTMLElement);
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
    observer.observe(window.document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    const elmApp = window.Elm.Docs.init({
      flags: { examples, render: target },
    });
    elmApp.ports.errorPort.subscribe((err) => reject(new Error(err)));
    elmApp.ports.renderPagePort.subscribe(({ meta }) => {
      result.meta = meta;
    });
  });

  window.close();

  return minify(renderedHtml, {
    html5: true,
    minifyCSS: { level: { 2: { all: true } } },
    removeRedundantAttributes: true,
    sortAttributes: true,
  });
};

export const renderExamplePage = async (
  outputDir: string,
  source: string,
  examples: Example[],
  example: Example,
): Promise<string> => {
  const html = await renderPage(source, examples, example.basename);
  await fs.mkdir(path.join(outputDir, example.basename), { recursive: true });
  const target = path.join(outputDir, example.basename, "index.html");
  await fs.writeFile(target, html, "utf8");
  return target;
};

export const renderIndexPage = async (
  outputDir: string,
  source: string,
  examples: Example[],
): Promise<string> => {
  const html = await renderPage(source, examples, "index");
  const target = path.join(outputDir, "index.html");
  await fs.writeFile(target, html, "utf8");
  return target;
};
