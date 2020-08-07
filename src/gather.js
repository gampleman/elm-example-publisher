const util = require("util"),
  glob = util.promisify(require("glob")),
  path = require("path"),
  fs = require("fs").promises,
  chalk = require("chalk");

const findElligibleFiles = async (inputDir) => {
  const files = await glob(inputDir + "/*.elm");
  const fileDetails = await Promise.all(
    files.map(async (file) => [file, await fs.readFile(file, "utf8")])
  );
  return fileDetails.filter(([_, source]) =>
    source.match(/module \w*( exposing \((?:.*\bmain\b.*|\.\.)\))?\w*\n/i)
  );
};

const firstCommentRegexp = /\{\-\|((?:.|\n)*?)\s*\-\}\n+/m;

const parseDocComment = (filename, source, width, height) => {
  var m = source.match(firstCommentRegexp);
  var tags = {};
  var description = "";
  if (m) {
    var firstComment = m[1];
    const atTagRegexp = /@(\w+)\s+(.+?)(?:\n|$)/g;

    let match;
    while ((match = atTagRegexp.exec(firstComment))) {
      const [_, tag, value] = match;
      if (tags[tag]) {
        if (Array.isArray(tags[tag])) {
          tags[tag].push(value);
        } else {
          tags[tag] = [tags[tag], value];
        }
      } else {
        tags[tag] = value;
      }
    }
    description = firstComment.replace(atTagRegexp, "");
    source = source.replace(firstCommentRegexp, "\n");
  }
  return {
    filename,
    source,
    description,
    tags,
    basename: path.basename(filename, ".elm"),
    width: tags.width || width,
    height: tags.height || height,
  };
};

module.exports = async (inputDir, width, height) => {
  // console.log(chalk.green.bold("Gathering all elligble examples"));
  const examples = await findElligibleFiles(inputDir);
  return examples.map(([name, source]) =>
    parseDocComment(name, source, width, height)
  );
};
