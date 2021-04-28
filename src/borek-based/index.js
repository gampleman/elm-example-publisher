const { buildSystem, onDiskStore, Volatile } = require("../borek"),
  {
    File,
    Dir,
    withFiles,
    invalidateChangedFiles,
    watchRebuilder,
  } = require("../borek/files"),
  withObjectInterface = require("../borek/objectInterface");
path = require("path");
liveServer = require("live-server");

const util = require("util"),
  glob = util.promisify(require("glob")),
  fs = require("fs").promises,
  os = require("os"),
  { findAllDependencies } = require("find-elm-dependencies");

const gather = require("../gather"),
  { compileToString } = require("node-elm-compiler");

const { renderExamplePage, renderIndexPage } = require("./buildPage"),
  compileExample = require("./compileExample");

const { runServer, snapPicture, resize } = require("./screenshots");

const tasks = (opts) =>
  withFiles(
    withObjectInterface({
      main: async function () {
        const examples = await this.gather();
        // console.log(examples);
        await Promise.all(
          examples
            .flatMap((example) => [
              this.buildExamplePage(example),
              this.screenshots(example),
            ])
            .concat([this.buildIndexPage(), this.copyAssets()])
        );

        return true;
      },

      copyAssets: async function () {
        const files = await this.gatherAssets();
        const assetDir = await this.options("assetDir");
        const outputDir = await this.options("outputDir");
        await Promise.all(
          files.map((file) =>
            this.copyStaticAsset(
              path.join(assetDir, file),
              path.join(outputDir, path.basename(assetDir), file)
            )
          )
        );
        return true;
      },

      gatherAssets: async function () {
        const assetDir = await this.options("assetDir");
        const dir = await fs.opendir(assetDir);
        const results = [];
        for await (const dirent of dir) {
          results.push(dirent.name);
        }
        return Volatile(results);
      },

      prepareTemplate: async function () {
        const workDir = await fs.mkdtemp(
          path.join(os.tmpdir(), "elm-example-publisher-")
        );
        const templateFile = await this.options("templateFile");
        const curDir = path.dirname(templateFile);
        const elmJsonPath = path.join(curDir, "elm.json");
        await this.dependsOnFile(elmJsonPath);
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
        await this.dependsOnElmFile(templateFile);
        const source = await compileToString([templateFile], {
          optimize: true,
        });
        process.chdir(oldcwd);
        return source;
      },
      buildIndexPage: async function () {
        const examples = await this.gather();
        const index = await renderIndexPage(
          await this.options("outputDir"),
          await this.prepareTemplate(),
          examples
        );

        return File(index);
      },

      screenshots: async function (example) {
        const snaps = ["preview", ...[example.tags.screenshot || []].flat()];
        await Promise.all(
          snaps.flatMap((snap) => [
            this.mainScreenshot(example, snap),

            this.resizedScreenshot(example, snap, 3, "webp"),
            this.resizedScreenshot(example, snap, 2, "png"),
            this.resizedScreenshot(example, snap, 2, "webp"),
            this.resizedScreenshot(example, snap, 1, "webp"),
            this.resizedScreenshot(example, snap, 1, "png"),
          ])
        );
        return true;
      },

      mainScreenshot: async function (example, name) {
        await this.compileExample(example);
        return File(
          await snapPicture(
            await this.options("outputDir"),
            example.basename,
            name,
            `http://localhost:4985/${example.basename}/iframe.html${
              name === "preview" ? "" : "#" + name
            }`,
            example.tags.delay || 0,
            example.width,
            example.height,
            await this.options("debug")
          )
        );
      },

      resizedScreenshot: async function (example, name, scale, format) {
        const picture = await this.mainScreenshot(example, name);
        const baseName = path.join(
          await this.options("outputDir"),
          example.basename,
          name
        );
        const w = Math.floor(example.width / 3),
          h = Math.floor(example.height / 3);
        return File(await resize(baseName, picture.path, w, h, scale, format));
      },
      buildExamplePage: async function (example) {
        const [_, page] = await Promise.all([
          this.compileExample(example),
          renderExamplePage(
            await this.options("outputDir"),
            await this.prepareTemplate(),
            await this.gather(),
            example
          ),
        ]);
        return File(page);
      },
      downloadDependencies: async function () {
        const [example, ...examples] = await this.gather();
        const inputDir = await this.options("inputDir");
        await compileExample(
          example,
          inputDir,
          await this.options("outputDir")
        );
        return File(path.join(inputDir, "elm.json"));
      },
      compileExample: async function (example) {
        await this.downloadDependencies();
        await this.dependsOnFile(example.filename);
        const dependencies = await findAllDependencies(example.filename);
        await Promise.all(dependencies.map((dep) => this.dependsOnFile(dep)));
        const inputDir = await this.options("inputDir");
        const outputDir = await this.options("outputDir");
        const result = await compileExample(example, inputDir, outputDir);
        await Promise.all(
          [example.tags.requires || []]
            .flat()
            .map((dep) =>
              this.copyStaticAsset(
                path.join(inputDir, dep),
                path.join(outputDir, example.basename, dep)
              )
            )
        );
        return File(result);
      },
      gather: async function () {
        return Volatile(
          await gather(
            await this.options("inputDir"),
            await this.options("width"),
            await this.options("height")
          )
        );
      },
      options: async function (option) {
        return Volatile(opts[option]);
      },
      dependsOnFile: async function (file) {
        return File(file);
      },
      copyStaticAsset: async function (from, to) {
        await this.dependsOnFile(from);
        await fs.mkdir(path.dirname(to), { recursive: true });
        await fs.copyFile(from, to);
        return File(to);
      },
      dependsOnElmFile: async function (file) {
        // TODO: inline in caller
        const dependencies = await findAllDependencies(file);
        await Promise.all(dependencies.map((dep) => this.dependsOnFile(dep)));
        return File(file);
      },
    })
  );

// const withObjectInterface = (obj) => {
//   return async (target, get) => {
//     const wrappedObj = Object.keys(obj).reduce(
//       (wrapper, key) => ({
//         ...wrapper,
//         [key]: (...args) => get({ method: key, args }),
//       }),
//       {}
//     );
//     if (target.method && obj[target.method])
//       return await obj[target.method].apply(wrappedObj, target.args);
//     else console.error(`undefined method ${target.method}`);
//   };
// };
const main = async () => {
  const store = await onDiskStore("./cache.json");

  // const builder = buildSystem({
  //   tasks: tasks({
  //     inputDir: "/Users/gampleman/Programming/elm-visualization/examples",
  //     outputDir: "/Users/gampleman/Programming/elm-visualization/build",
  //     width: 330,
  //     height: 200,
  //     templateFile:
  //       "/Users/gampleman/Programming/elm-visualization/docs/Docs.elm",
  //   }),
  //   store,
  //   invalidator: invalidateChangedFiles,
  // });
  // try {
  //   await builder({ method: "main", args: [] });
  //   // console.log(Array.from(store.entries()));
  //   await store.finalize();
  //   console.log("DONE");
  // } catch (e) {
  //   console.error(e);
  // }
  runServer(
    "/Users/gampleman/Programming/elm-visualization/build",
    (baseUrl) => {
      const rebuilder = watchRebuilder(
        {
          store,
          invalidator: invalidateChangedFiles,
          tasks: tasks({
            inputDir: "/Users/gampleman/Programming/elm-visualization/examples",
            outputDir: "/Users/gampleman/Programming/elm-visualization/build",
            assetDir:
              "/Users/gampleman/Programming/elm-visualization/docs/assets",
            width: 990,
            height: 504,
            debug: false,
            templateFile:
              "/Users/gampleman/Programming/elm-visualization/docs/Docs.elm",
          }),
        },
        { method: "main", args: [] }
      ).once("buildComplete", () => {
        liveServer.start({
          port: 8181,
          root: "/Users/gampleman/Programming/elm-visualization/build",
        });
      });
    }
  );
};

main();
