import { glob } from "glob";
import path from "node:path";
import { promises as fs } from "node:fs";
import chalk from "chalk";

// An example is eligible if it is a module that exposes `main` (either
// explicitly, or via `(..)`). The exposing list may span multiple lines, as
// produced by elm-format, and module names may be dotted (e.g. Pages.Home), so
// we capture the whole exposing list and inspect it rather than trying to match
// `main` on the module line directly.
const exposingRegexp =
  /^(?:port\s+|effect\s+)?module\s+[\w.]+\s+exposing\s*\(([\s\S]*?)\)/m;

export const exposesMain = (source) => {
  const match = source.match(exposingRegexp);
  if (!match) return false;
  const exposed = match[1];
  return exposed.includes("..") || /\bmain\b/.test(exposed);
};

const findElligibleFiles = async (inputDir) => {
  const files = await glob(inputDir.absolute + "/*.elm", {
    windowsPathsNoEscape: true,
  });
  const fileDetails = await Promise.all(
    files.map(async (file) => [file, await fs.readFile(file, "utf8")]),
  );
  return fileDetails.filter(([_, source]) => exposesMain(source));
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

export default async (inputDir, width, height) => {
  console.log(chalk.green.bold("Gathering all elligble examples"));
  const examples = await findElligibleFiles(inputDir);
  return examples.map(([name, source]) =>
    parseDocComment(name, source, width, height),
  );
};
