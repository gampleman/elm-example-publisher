import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import elm from "node-elm-compiler";
import { Volatile } from "../borek/index.js";
import { File, withFiles } from "../borek/files.js";
import withObjectInterface from "../borek/objectInterface.js";
import gather from "../gather.js";
import { renderExamplePage, renderIndexPage } from "./buildPage.js";
import compileExample from "./compileExample.js";
import { snapPicture, resize } from "./screenshot.js";

const { compileToString, findAllDependencies } = elm;

// The build, expressed as a Borek task graph. `ctx` carries the resolved
// options plus a shared headless `browser` and the screenshot server `baseUrl`.
//
// Tasks declare file dependencies via this.dependsOnFile / dependsOnElmFile so
// that Borek re-runs exactly the work affected by a given change. Options and
// directory listings are Volatile (re-checked every run); everything else is
// cached by its inputs.
export const makeTasks = (ctx) =>
  withFiles(
    withObjectInterface({
      main: async function () {
        const examples = await this.gather();
        await Promise.all(
          examples
            .flatMap((example) => [
              this.buildExamplePage(example),
              ...(ctx.screenshots ? [this.screenshots(example)] : []),
            ])
            .concat([this.buildIndexPage(), this.copyAssets()]),
        );
        return true;
      },

      options: async function (option) {
        return Volatile(ctx[option]);
      },

      gather: async function () {
        if (ctx.examplesOverride) return Volatile(ctx.examplesOverride);
        return Volatile(await gather(ctx.inputDir, ctx.width, ctx.height));
      },

      dependsOnFile: async function (file) {
        return File(file);
      },

      dependsOnElmFile: async function (file) {
        const dependencies = await findAllDependencies(file);
        await Promise.all(dependencies.map((dep) => this.dependsOnFile(dep)));
        return File(file);
      },

      copyStaticAsset: async function (from, to) {
        await this.dependsOnFile(from);
        await fs.mkdir(path.dirname(to), { recursive: true });
        await fs.copyFile(from, to);
        return File(to);
      },

      gatherAssets: async function () {
        const entries = await fs.readdir(ctx.assetDir).catch(() => []);
        return Volatile(entries);
      },

      copyAssets: async function () {
        const files = await this.gatherAssets();
        await Promise.all(
          files.map((file) =>
            this.copyStaticAsset(
              path.join(ctx.assetDir, file),
              path.join(ctx.outputDir, path.basename(ctx.assetDir), file),
            ),
          ),
        );
        return true;
      },

      // Downloads Elm dependencies once (by compiling the first example) so the
      // parallel per-example compiles below don't race on the package cache.
      downloadDependencies: async function () {
        const [example] = await this.gather();
        await compileExample(example, ctx.inputDir, ctx.outputDir);
        return File(path.join(ctx.inputDir, "elm.json"));
      },

      compileExample: async function (example) {
        await this.downloadDependencies();
        await this.dependsOnElmFile(example.filename);
        const result = await compileExample(
          example,
          ctx.inputDir,
          ctx.outputDir,
        );
        await Promise.all(
          [example.tags.requires || []]
            .flat()
            .map((dep) =>
              this.copyStaticAsset(
                path.join(ctx.inputDir, dep),
                path.join(ctx.outputDir, example.basename, dep),
              ),
            ),
        );
        return File(result);
      },

      prepareTemplate: async function () {
        const workDir = await fs.mkdtemp(
          path.join(os.tmpdir(), "elm-example-publisher-"),
        );
        const curDir = path.dirname(ctx.templateFile);
        const elmJsonPath = path.join(curDir, "elm.json");
        await this.dependsOnFile(elmJsonPath);
        const elmJson = await fs.readFile(elmJsonPath, "utf8").then(JSON.parse);
        elmJson["source-directories"] = elmJson["source-directories"]
          .map((p) => path.resolve(curDir, p))
          .concat([ctx.publisherDir]);
        await fs.writeFile(
          path.join(workDir, "elm.json"),
          JSON.stringify(elmJson),
          "utf8",
        );

        await this.dependsOnElmFile(ctx.templateFile);
        const source = await compileToString([ctx.templateFile], {
          optimize: true,
          cwd: workDir,
        });
        return source;
      },

      buildIndexPage: async function () {
        const examples = await this.gather();
        return File(
          await renderIndexPage(
            ctx.outputDir,
            await this.prepareTemplate(),
            examples,
          ),
        );
      },

      buildExamplePage: async function (example) {
        const [, page] = await Promise.all([
          this.compileExample(example),
          renderExamplePage(
            ctx.outputDir,
            await this.prepareTemplate(),
            await this.gather(),
            example,
          ),
        ]);
        return File(page);
      },

      screenshots: async function (example) {
        const snaps = ["preview", ...[example.tags.screenshot || []].flat()];
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
      },

      mainScreenshot: async function (example, name) {
        await this.compileExample(example);
        const url = `${ctx.baseUrl}${example.basename}/iframe.html${
          name === "preview" ? "" : "#" + name
        }`;
        return File(
          await snapPicture(
            ctx.browser,
            ctx.outputDir,
            example.basename,
            name,
            url,
            example.tags.delay || 0,
            example.width,
            example.height,
            ctx.debug,
          ),
        );
      },

      resizedScreenshot: async function (example, name, scale, format) {
        const picture = await this.mainScreenshot(example, name);
        const baseName = path.join(ctx.outputDir, example.basename, name);
        const w = Math.floor(example.width / 3);
        const h = Math.floor(example.height / 3);
        return File(await resize(baseName, picture.path, w, h, scale, format));
      },
    }),
  );
