# elm-example-publisher

This is a small script that generates a static website for showcasing visual examples of small Elm programs.
An example in the wild is [elm-visualization examples](https://elm-visualization.netlify.app).

## How it works?

This program will process stuff in stages:

#### 1. Gathering all elligible examples

Generally you will want to make a directory (usually this is called `/examples`) full of little Elm programs that you will want to showcase. This script will read every Elm file in the directory and provided that it explicitely exports `main` it will consider it an example and process it.

**Customized with:**

- `--input-dir <dir>` tells it where to find the examples. Defaults to a directory called `/examples`.

#### 2. Compiling examples

These programs should render some output that should all fit into some dimensions (the default is 990x504, but you can adjust the size as long as all examples have the same one). The script will compile each program (for this to work, you will also want to have an `elm.json` in the examples directory), compress and optimize it, and write it to a file.

**Customized with:**

- `--output-dir <dir>` tells it where to write the output files. Defaults to a directory called `/build`
- `--no-compile` will skip this step. Useful mostly for quickly iterating on the templates (see below).

#### 3. Taking screenshots

For each program a Chromium instance will navigate to it and take a screenshot of the output. These screenshots are then made into a series of responsive images - the full size screenshot is the 3x version, and a smaller 2x and 1x version is made. These are then written to disk.

**Customized with:**

- `--output-dir <dir>` tells it where to write the output files
- `--no-screenshots` will skip this step. Not all example websites are visual and need screenshots.
- `--width <pixels>` and `--height <pixels>` set the dimensions of the screenshots (defaults to 990x504.)
- `--debug` runs Chromium visibly so you can see what is going on

#### 4. Publishing Ellies

Optionally, these programs will be automatically uploaded to [Elllie](https://ellie-app.com), where users can play with them.

**Customized with:**

- `--ellie` enables this step. To be gentle to the Ellie service, only enable this when you need it.
- `--ellie-dep <username/package@version>` allows to add additional dependencies. Typically for development, you will use the parent `/src` directory to develop your examples. But once you publish your package, you will want to the Ellies to include the published package.
- `--base-url <url>` the base url where the produced website will be published. This will be used to fix links to external resources like styles and images.

#### 5. Building website

Then, the script will load a template Elm program (by default this program resides in `/docs/Docs.elm`) and run it to produce the relevant HTML. It will then compress and optimize this. It will copy any files from `/docs/assets` and write this all to the output dir.

**Customized with:**

- `--output-dir <dir>` tells it where to write the output files
- `--template-file <file>` tells it the path to the Elm template file used to produce the docs website. Defaults to `/docs/Docs.elm`.
- `--asset-path <dir>` this directory will be copied to the output path verbatim. Useful for things like styles or images for the website.

## Installation

```
npm i -g elm-example-publisher
```

## Customizing the behavior

`elm-example-publisher --help` will show options that can be configured at runtime.

You can most easily modify the output by changing the `/docs/Docs.elm` template file. We provide a default template for you (used if `/docs/Docs.elm` isn't found), but we recommend you copy this to your project and customize as you see fit. You can [find it here](https://github.com/gampleman/elm-example-publisher/tree/master/src/templates).

Finally, you can add `@tags` to your examples in the module comment. There are a few built in tags, but you also get access to the tags in your template. You can use that to implement categories for example.

### Built in tags

#### `@delay <seconds>`

This will cause the screenshot to wait the specifified number of seconds. Useful if you need some time (for example to load some resources) before you want the screenshot taken.

#### `@requires <relative file path>`

Sometimes example depend on some asset being available - a texture, data file, etc. This attribute ensures that the build time server correctly serves this asset when screenshotting as well as copying the asset to the correct directory. It will also prefix this path with `--base-url` when uploading to Ellie.

#### `@screenshot <string>`

If the example is an app that can respond to fragment URLs you might want to take screenshots of every screen. You can repeat this tag and a screenshot will be created. For example

```elm
{-|
@screenshot foo
@screenshot bar
-}
```

Will create:

- `preview@3x.png`, `preview@3x.webp`, `preview@2x.png`, `preview@2x.webp`, `preview.png` and `preview.webp` for `/example`
- `foo@3x.png`, `foo@3x.webp`, `foo@2x.png`, `foo@2x.webp`, `foo.png` and `foo.webp` for `/example#foo`
- `bar@3x.png`, `bar@3x.webp`, `bar@2x.png`, `bar@2x.webp`, `bar.png` and `bar.webp` for `/example#bar`

## License

MIT
