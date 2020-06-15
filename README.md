# elm-example-publisher

This is a small script that generates a static website for showcasing visual examples of small Elm programs.
An example in the wild is [elm-visualization examples](https://elm-visualization.netlify.app).

## How it works?

Generally you will want to make a directory (usually this is called `/examples`) full of little Elm programs that you will want to showcase. This script will read every Elm file in the directory and provided that it explicitely exports `main` it will consider it an example and process it.

These programs should render some output that should all fit into some dimensions (the default is 990x504, but you can adjust the size as long as all examples have the same one). The script will compile each program (for this to work, you will also want to have an `elm.json` in the examples directory), compress and optimize it and then proceed to take a screenshot of the output.

These screenshots are then made into a series of responsive images - the full size screenshot is the 3x version, and a smaller 2x and 1x version is made.

Then, the script will load a template Elm program (by default this program resides in `/docs/Docs.elm`) and run it to produce the relevant HTML. It will then compress and optimize this. It will copy any files from `/docs/assets`. Finally, it will produce a service worker from all of these.

## Installation

```
npm i -g elm-example-publisher
```

## Customizing the behavior

`elm-example-publisher --help` will show options that can be configured at runtime.

You can most easily modify the output by changing the `/docs/Docs.elm` template file.

Finally, you can add `@tags` to your examples in the module comment. There are a few built in tags, but you also get access to the tags in your template. You can use that to implement categories for example.

### Built in tags

#### `@delay <seconds>`

This will cause the screenshot to wait the specifified number of seconds. Useful if you need some time (for example to load some resources) before you want the screenshot taken.

#### `@requires <relative file path>`

Sometimes example depend on some asset being available - a texture, data file, etc. This attribute ensures that the build time server correctly serves this asset when screenshotting as well as copying the asset to the correct directory.

#### @screenshot <string>

If the example is an app that can respond to fragment URLs you might want to take screenshots of every screen. You can repeat this tag and a screenshot will be created. For example

{-|
@screenshot foo
@screenshot bar
-}

Will create:

- `preview@3x.png`, `preview@3x.webp`, `preview@2x.png`, `preview@2x.webp`, `preview.png` and `preview.webp` for `/example`
- `foo@3x.png`, `foo@3x.webp`, `foo@2x.png`, `foo@2x.webp`, `foo.png` and `foo.webp` for `/example#foo`
- `bar@3x.png`, `bar@3x.webp`, `bar@2x.png`, `bar@2x.webp`, `bar.png` and `bar.webp` for `/example#bar`

## License

MIT
