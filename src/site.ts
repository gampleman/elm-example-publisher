import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import elm from "node-elm-compiler";
import { Borek, Volatile } from "./borek/index.js";
import type { FileResult } from "./borek/index.js";
import { parseExample } from "./gather.js";
import { renderExamplePage, renderIndexPage } from "./buildPage.js";
import compileExample from "./compileExample.js";
import { snapPicture, resize } from "./screenshot.js";
import type { Semaphore } from "./semaphore.js";
import type { Browser } from "puppeteer";
import type { Example, Options } from "./types.js";

const { compileToString, findAllDependencies } = elm;

// Directory of the published package (so the template compile can add the
// bundled ExamplePublisher.elm to its source path). In dist/ this resolves to
// dist/, where copy-assets puts ExamplePublisher.elm.
const publisherDir = path.dirname(fileURLToPath(import.meta.url));

// Runtime resources shared across the build that aren't plain options: the
// screenshot server URL, the headless browser, a semaphore bounding how many
// browser pages are open at once, and an optional examples list pre-augmented
// with Ellie links.
export type SiteRuntime = {
  baseUrl: string | null;
  browser: Browser | null;
  screenshotLimit: Semaphore;
  examplesOverride: Example[] | null;
};

// The whole build expressed as a Borek task graph. Each example compile, each
// resized screenshot, each page render, asset copy, and the template compile is
// a cached task; file dependencies are recorded implicitly by the tracked-IO
// helpers (this.readFile / this.copyFile / this.globFiles) so a change re-runs
// exactly the affected work.
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

  // Parses a single example file, keyed by its path. readFile both reads and
  // records the dependency, so editing the file re-runs only this task (and its
  // dependents). Returns null for files that aren't eligible examples.
  async parseExample(file: string): Promise<Example | null> {
    const source = await this.readFile(file);
    return parseExample(
      file,
      source,
      await this.input("width"),
      await this.input("height"),
    );
  }

  async gather(): Promise<Example[]> {
    // When Ellie publishing ran up front, use its augmented list verbatim.
    if (this.runtime.examplesOverride) {
      return Volatile(this.runtime.examplesOverride);
    }
    // globFiles tracks the set of *.elm paths: adding/removing one re-runs
    // gather, while editing one flows through parseExample's readFile instead.
    const inputDir = await this.input("inputDir");
    const paths = await this.globFiles(path.join(inputDir, "*.elm"));
    const parsed = await Promise.all(
      paths.map((file) => this.parseExample(file)),
    );
    return parsed.filter((e): e is Example => e !== null);
  }

  // Records a dependency on an Elm module and all of its transitive imports.
  // The Elm compiler reads these files itself, so we track them in parallel:
  // this is the one place tracking can't be folded into the read.
  //
  // Returns the files' content hashes (sorted by path). This matters: the value
  // must change when any tracked file changes, otherwise a task that depends on
  // trackElmModule would early-exit ("value unchanged") and never see the edit —
  // e.g. editing the template wouldn't rebuild the pages.
  async trackElmModule(file: string): Promise<string[]> {
    const dependencies = await findAllDependencies(file);
    const files = await Promise.all(
      [file, ...dependencies].map((f) => this.file(f)),
    );
    return files.map((f) => `${f.path}:${f.hash ?? ""}`).sort();
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
        this.copyFile(
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
    return this.file(path.join(inputDir, "elm.json"));
  }

  async compileExample(example: Example): Promise<FileResult> {
    await this.downloadDependencies();
    await this.trackElmModule(example.filename);
    const inputDir = await this.input("inputDir");
    const outputDir = await this.input("outputDir");
    const result = await compileExample(example, inputDir, outputDir);
    await Promise.all(
      [example.tags.requires ?? []]
        .flat()
        .map((dep) =>
          this.copyFile(
            path.join(inputDir, dep),
            path.join(outputDir, example.basename, dep),
          ),
        ),
    );
    return this.file(result);
  }

  async prepareTemplate(): Promise<string> {
    const templateFile = await this.input("templateFile");
    const workDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "elm-example-publisher-"),
    );
    const curDir = path.dirname(templateFile);
    const elmJsonPath = path.join(curDir, "elm.json");
    const elmJson = JSON.parse(await this.readFile(elmJsonPath)) as {
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
    await this.trackElmModule(templateFile);
    return compileToString([templateFile], { optimize: true, cwd: workDir });
  }

  async buildIndexPage(): Promise<FileResult> {
    return this.file(
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
    return this.file(page);
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
    const outputDir = await this.input("outputDir");
    const debug = await this.input("debug");
    // Bound concurrency: open at most N browser pages at once. Opening one per
    // example in parallel starves constrained CI machines and times out.
    const file = await this.runtime.screenshotLimit(() =>
      snapPicture(
        this.runtime.browser!,
        outputDir,
        example.basename,
        name,
        url,
        delay,
        example.width,
        example.height,
        debug,
      ),
    );
    return this.file(file);
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
    return this.file(await resize(baseName, picture.path, w, h, scale, format));
  }
}
