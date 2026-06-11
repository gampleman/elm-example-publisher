import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import type { Store } from "./engine.js";

// A File result marks that a task produced (or depends on) a file on disk.
// Borek hashes the file's contents and stores the hash with the result, so the
// task's value changes — and dependents are invalidated — when the file does.
export type FileResult = { type: "File"; path: string; hash?: string };
export type DirResult = { type: "Dir"; path: string };

export const File = (...paths: string[]): FileResult => ({
  type: "File",
  path: path.join(...paths),
});

export const Dir = (dirPath: string): DirResult => ({
  type: "Dir",
  path: dirPath,
});

export const isFile = (value: unknown): value is FileResult =>
  typeof value === "object" &&
  value !== null &&
  (value as { type?: unknown }).type === "File";

export const hashFile = async (filePath: string): Promise<string> =>
  createHash("sha1")
    .update(await fs.readFile(filePath))
    .digest("hex");

// An invalidator: marks any File-valued store entry stale if its on-disk
// contents have changed (or the file has gone away) since the last build.
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
    }
  }
};
