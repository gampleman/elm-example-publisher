import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import elm from "node-elm-compiler";
import { Borek, Volatile, File, Glob } from "./borek/index.js";
import type { FileResult, GlobResult } from "./borek/index.js";
import { parseExampleFile } from "./gather.js";
import { renderExamplePage, renderIndexPage } from "./buildPage.js";
import compileExample from "./compileExample.js";
import { snapPicture, resize } from "./screenshot.js";
import type { Browser } from "puppeteer";
import type { Example, Options } from "./types.js";

const { compileToString, findAllDependencies } = elm;

// Directory of the published package (so the template compile can add the
// bundled ExamplePublisher.elm to its source path). In dist/ this resolves to
// dist/, where copy-assets puts ExamplePublisher.elm.
const publisherDir = path.dirname(fileURLToPath(import.meta.url));

// Runtime resources shared across the build that aren't plain options: the
// screenshot server URL, the headless browser, and an optional examples list
// pre-augmented with Ellie links.
export type SiteRuntime = {
  baseUrl: string | null;
  browser: Browser | null;
  examplesOverride: Example[] | null;
};

// The whole build expressed as a Borek task graph. Each example compile, each
// resized screenshot, each page render, asset copy, and the template compile is
// a cached task; file dependencies are declared via dependsOnFile /
// dependsOnElmFile so a change re-runs exactly the affected work.
export class Site extends Borek<Options> {
  private runtime: SiteRuntime;

  constructor(
    options: Options,
    runtime: SiteRuntime,
    config: ConstructorParameters<typeof Borek>[1],
  ) {
    super(options, config);
    this.runtime = runtime;
  }

  async main(): Promise<boolean> {
    const screenshots = await this.input("screenshots");
    const examples = await this.gather();
    await Promise.all([
      ...examples.flatMap((example) => [
        this.buildExamplePage(example),
        ...(screenshots ? [this.screenshots(example)] : []),
      ]),
      this.buildIndexPage(),
      this.copyAssets(),
    ]);
    return true;
  }

  // The set of candidate example files. A Glob result, so adding or removing a
  // *.elm file invalidates gather, but editing one does not (that flows through
  // parseExample's per-file dependency instead).
  async exampleFiles(): Promise<GlobResult> {
    const inputDir = await this.input("inputDir");
    return Glob(path.join(inputDir, "*.elm"));
  }

  // Parses a single example file, keyed by its path. Depends on the file's
  // contents, so editing it re-runs only this task (and its dependents).
  // Returns null for files that aren't eligible examples (no exposed `main`).
  async parseExample(file: string): Promise<Example | null> {
    await this.dependsOnFile(file);
    return parseExampleFile(
      file,
      await this.input("width"),
      await this.input("height"),
    );
  }

  async gather(): Promise<Example[]> {
    // When Ellie publishing ran up front, use its augmented list verbatim.
    if (this.runtime.examplesOverride) {
      return Volatile(this.runtime.examplesOverride);
    }
    const { paths } = await this.exampleFiles();
    const parsed = await Promise.all(
      (paths ?? []).map((file) => this.parseExample(file)),
    );
    return parsed.filter((e): e is Example => e !== null);
  }

  async dependsOnFile(file: string): Promise<FileResult> {
    return File(file);
  }

  async dependsOnElmFile(file: string): Promise<FileResult> {
    const dependencies = await findAllDependencies(file);
    await Promise.all(dependencies.map((dep) => this.dependsOnFile(dep)));
    return File(file);
  }

  async copyStaticAsset(from: string, to: string): Promise<FileResult> {
    await this.dependsOnFile(from);
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.copyFile(from, to);
    return File(to);
  }

  async gatherAssets(): Promise<string[]> {
    const assetDir = await this.input("assetDir");
    const entries = await fs.readdir(assetDir).catch(() => []);
    return Volatile(entries);
  }

  async copyAssets(): Promise<boolean> {
    const assetDir = await this.input("assetDir");
    const outputDir = await this.input("outputDir");
    const files = await this.gatherAssets();
    await Promise.all(
      files.map((file) =>
        this.copyStaticAsset(
          path.join(assetDir, file),
          path.join(outputDir, path.basename(assetDir), file),
        ),
      ),
    );
    return true;
  }

  // Compiles Elm deps once (by compiling the first example) so the parallel
  // per-example compiles below don't race on the package cache.
  async downloadDependencies(): Promise<FileResult> {
    const inputDir = await this.input("inputDir");
    const [example] = await this.gather();
    await compileExample(example, inputDir, await this.input("outputDir"));
    return File(path.join(inputDir, "elm.json"));
  }

  async compileExample(example: Example): Promise<FileResult> {
    await this.downloadDependencies();
    await this.dependsOnElmFile(example.filename);
    const inputDir = await this.input("inputDir");
    const outputDir = await this.input("outputDir");
    const result = await compileExample(example, inputDir, outputDir);
    await Promise.all(
      [example.tags.requires ?? []]
        .flat()
        .map((dep) =>
          this.copyStaticAsset(
            path.join(inputDir, dep),
            path.join(outputDir, example.basename, dep),
          ),
        ),
    );
    return File(result);
  }

  async prepareTemplate(): Promise<string> {
    const templateFile = await this.input("templateFile");
    const workDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "elm-example-publisher-"),
    );
    const curDir = path.dirname(templateFile);
    const elmJsonPath = path.join(curDir, "elm.json");
    await this.dependsOnFile(elmJsonPath);
    const elmJson = JSON.parse(await fs.readFile(elmJsonPath, "utf8")) as {
      "source-directories": string[];
    };
    elmJson["source-directories"] = elmJson["source-directories"]
      .map((p) => path.resolve(curDir, p))
      .concat([publisherDir]);
    await fs.writeFile(
      path.join(workDir, "elm.json"),
      JSON.stringify(elmJson),
      "utf8",
    );
    await this.dependsOnElmFile(templateFile);
    return compileToString([templateFile], { optimize: true, cwd: workDir });
  }

  async buildIndexPage(): Promise<FileResult> {
    return File(
      await renderIndexPage(
        await this.input("outputDir"),
        await this.prepareTemplate(),
        await this.gather(),
      ),
    );
  }

  async buildExamplePage(example: Example): Promise<FileResult> {
    const [, page] = await Promise.all([
      this.compileExample(example),
      this.renderExample(example),
    ]);
    return File(page);
  }

  async renderExample(example: Example): Promise<string> {
    return renderExamplePage(
      await this.input("outputDir"),
      await this.prepareTemplate(),
      await this.gather(),
      example,
    );
  }

  async screenshots(example: Example): Promise<boolean> {
    const snaps = ["preview", ...[example.tags.screenshot ?? []].flat()];
    await Promise.all(
      snaps.flatMap((snap) => [
        this.resizedScreenshot(example, snap, 3, "webp"),
        this.resizedScreenshot(example, snap, 2, "png"),
        this.resizedScreenshot(example, snap, 2, "webp"),
        this.resizedScreenshot(example, snap, 1, "png"),
        this.resizedScreenshot(example, snap, 1, "webp"),
      ]),
    );
    return true;
  }

  async mainScreenshot(example: Example, name: string): Promise<FileResult> {
    await this.compileExample(example);
    const baseUrl = this.runtime.baseUrl ?? "";
    const url = `${baseUrl}${example.basename}/iframe.html${
      name === "preview" ? "" : "#" + name
    }`;
    const delay =
      typeof example.tags.delay === "string" ? Number(example.tags.delay) : 0;
    return File(
      await snapPicture(
        this.runtime.browser!,
        await this.input("outputDir"),
        example.basename,
        name,
        url,
        delay,
        example.width,
        example.height,
        await this.input("debug"),
      ),
    );
  }

  async resizedScreenshot(
    example: Example,
    name: string,
    scale: number,
    format: "png" | "webp",
  ): Promise<FileResult> {
    const picture = await this.mainScreenshot(example, name);
    const outputDir = await this.input("outputDir");
    const baseName = path.join(outputDir, example.basename, name);
    const w = Math.floor(example.width / 3);
    const h = Math.floor(example.height / 3);
    return File(await resize(baseName, picture.path, w, h, scale, format));
  }
}
