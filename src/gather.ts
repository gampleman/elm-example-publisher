import { glob } from "glob";
import path from "node:path";
import { promises as fs } from "node:fs";
import chalk from "chalk";
import type { Example, Tags } from "./types.js";

// An example is eligible if it is a module that exposes `main` (either
// explicitly, or via `(..)`). The exposing list may span multiple lines, as
// produced by elm-format, and module names may be dotted (e.g. Pages.Home), so
// we capture the whole exposing list and inspect it rather than trying to match
// `main` on the module line directly.
const exposingRegexp =
  /^(?:port\s+|effect\s+)?module\s+[\w.]+\s+exposing\s*\(([\s\S]*?)\)/m;

export const exposesMain = (source: string): boolean => {
  const match = source.match(exposingRegexp);
  if (!match) return false;
  const exposed = match[1];
  return exposed.includes("..") || /\bmain\b/.test(exposed);
};

const findElligibleFiles = async (
  inputDir: string,
): Promise<[string, string][]> => {
  // Sort so the example order is deterministic: glob returns filesystem order,
  // which is unstable across machines (macOS vs Linux CI) and even between runs.
  // An unstable order would defeat incremental caching (every task sees a
  // different examples list) and make the generated site's order nondeterministic.
  const files = (
    await glob(inputDir + "/*.elm", { windowsPathsNoEscape: true })
  ).sort();
  const fileDetails = await Promise.all(
    files.map(
      async (file): Promise<[string, string]> => [
        file,
        await fs.readFile(file, "utf8"),
      ],
    ),
  );
  return fileDetails.filter(([, source]) => exposesMain(source));
};

const firstCommentRegexp = /\{\-\|((?:.|\n)*?)\s*\-\}\n+/m;

const parseDocComment = (
  filename: string,
  source: string,
  width: number,
  height: number,
): Example => {
  const m = source.match(firstCommentRegexp);
  const tags: Tags = {};
  let description = "";
  if (m) {
    const firstComment = m[1];
    const atTagRegexp = /@(\w+)\s+(.+?)(?:\n|$)/g;

    let match: RegExpExecArray | null;
    while ((match = atTagRegexp.exec(firstComment))) {
      const [, tag, value] = match;
      const existing = tags[tag];
      if (existing !== undefined) {
        if (Array.isArray(existing)) existing.push(value);
        else tags[tag] = [existing, value];
      } else {
        tags[tag] = value;
      }
    }
    description = firstComment.replace(atTagRegexp, "");
    source = source.replace(firstCommentRegexp, "\n");
  }
  const tagWidth = typeof tags.width === "string" ? Number(tags.width) : NaN;
  const tagHeight = typeof tags.height === "string" ? Number(tags.height) : NaN;
  return {
    filename,
    source,
    description,
    tags,
    basename: path.basename(filename, ".elm"),
    width: Number.isNaN(tagWidth) ? width : tagWidth,
    height: Number.isNaN(tagHeight) ? height : tagHeight,
  };
};

// Parses one example from already-read source. Returns null if it doesn't
// expose `main` (and so isn't an eligible example). The caller reads the file
// (via tracked IO) so this stays a pure function of its inputs.
export const parseExample = (
  filename: string,
  source: string,
  width: number,
  height: number,
): Example | null => {
  if (!exposesMain(source)) return null;
  return parseDocComment(filename, source, width, height);
};

export default async (
  inputDir: string,
  width: number,
  height: number,
): Promise<Example[]> => {
  console.log(chalk.green.bold("Gathering all elligble examples"));
  const examples = await findElligibleFiles(inputDir);
  return examples.map(([name, source]) =>
    parseDocComment(name, source, width, height),
  );
};
