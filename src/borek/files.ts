import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { glob } from "glob";
import type { Store } from "./engine.js";

// A File result marks that a task produced (or depends on) a file on disk.
// Borek hashes the file's contents and stores the hash with the result, so the
// task's value changes — and dependents are invalidated — when the file does.
export type FileResult = { type: "File"; path: string; hash?: string };
export type DirResult = { type: "Dir"; path: string };

// A Glob result marks that a task depends on the *set of paths* matching a glob
// pattern. It deliberately tracks only which files match — not their contents —
// so add/remove of a matching file invalidates dependents, while modifications
// flow through ordinary per-file File hashing. `paths` is filled in by the
// engine (sorted, for stable comparison).
export type GlobResult = { type: "Glob"; pattern: string; paths?: string[] };

export const File = (...paths: string[]): FileResult => ({
  type: "File",
  path: path.join(...paths),
});

export const Dir = (dirPath: string): DirResult => ({
  type: "Dir",
  path: dirPath,
});

export const Glob = (pattern: string): GlobResult => ({
  type: "Glob",
  pattern,
});

export const isFile = (value: unknown): value is FileResult =>
  typeof value === "object" &&
  value !== null &&
  (value as { type?: unknown }).type === "File";

export const isGlob = (value: unknown): value is GlobResult =>
  typeof value === "object" &&
  value !== null &&
  (value as { type?: unknown }).type === "Glob";

export const hashFile = async (filePath: string): Promise<string> =>
  createHash("sha1")
    .update(await fs.readFile(filePath))
    .digest("hex");

// Expands a glob pattern to its sorted set of matching paths. Sorting makes the
// result order-independent so equality checks are stable across runs.
export const expandGlob = async (pattern: string): Promise<string[]> => {
  const matches = await glob(pattern, { windowsPathsNoEscape: true });
  return matches.sort();
};

// The directory to watch for a glob pattern: everything up to the first segment
// containing a magic character. Used by watch mode to detect added/removed
// files (which fs.watch on individual files cannot).
export const globBaseDir = (pattern: string): string => {
  const segments = pattern.split(path.sep);
  const magic = segments.findIndex((s) => /[*?[\]{}()!+@]/.test(s));
  const baseSegments =
    magic === -1 ? segments.slice(0, -1) : segments.slice(0, magic);
  return baseSegments.join(path.sep) || ".";
};

// An invalidator: marks a store entry stale when the filesystem state it depends
// on has changed — a File's contents (by hash), or a Glob's matched path set.
export const invalidateChangedFiles = async (store: Store): Promise<void> => {
  for (const [key, entry] of store.entries()) {
    const value = entry.value;
    if (isFile(value)) {
      try {
        const hash = await hashFile(value.path);
        if (value.hash !== hash) store.invalidate(key);
      } catch {
        // File unreadable/removed: force a recompute.
        store.invalidate(key);
      }
    } else if (isGlob(value)) {
      const paths = await expandGlob(value.pattern);
      const previous = value.paths ?? [];
      if (
        paths.length !== previous.length ||
        paths.some((p, i) => p !== previous[i])
      ) {
        store.invalidate(key);
      }
    }
  }
};
