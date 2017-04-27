# elm-example-publisher

Create examples to publish in gh-pages from elm examples.

The main idea is that you create a directory full of small elm programs that
serve as examples of the library you are using. You configure GitHub to use your
docs folder as the source for gh-pages. Then you run

    $ elm example-publisher examples docs

This will generate html versions with highlighted source code to show off the
examples.

## Install

Will be published to NPM soon. (Please post an issue if you need this urgently).

In the meantime you can clone the repo and run `npm link`.

## Usage

Run this from the directory as you would run elm make.

## License

MIT
