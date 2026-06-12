import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { Borek, inMemoryStore } from "./index.js";

// A build that globs *.txt under the input dir and "parses" each matched file,
// using the tracked-IO API (globFiles + readFile). `parseLog` records which
// files were (re-)parsed in a given run.
class Files extends Borek<{ dir: string }> {
  parseLog: string[] = [];

  async parse(file: string): Promise<string> {
    const contents = await this.readFile(file);
    this.parseLog.push(file);
    return contents;
  }

  async all(): Promise<string[]> {
    const paths = await this.globFiles(join(await this.input("dir"), "*.txt"));
    return Promise.all(paths.map((p) => this.parse(p)));
  }
}

// A fresh instance over a dir, sharing a store (so the cache persists between
// "runs" while parseLog starts empty each time).
const make = (dir: string, store: ReturnType<typeof inMemoryStore>) =>
  new Files({ dir }, { store });

test("glob: add/delete/modify selectivity", async () => {
  const dir = await mkdtemp(join(tmpdir(), "glob-test-"));
  const store = inMemoryStore();
  try {
    await writeFile(join(dir, "a.txt"), "a");
    await writeFile(join(dir, "b.txt"), "b");

    let f = make(dir, store);
    let result = await f.all();
    assert.deepEqual(result.sort(), ["a", "b"], "reads both files' contents");
    assert.equal(f.parseLog.length, 2, "first run parses both");

    // No change -> nothing re-parses.
    f = make(dir, store);
    await f.all();
    assert.equal(f.parseLog.length, 0, "no-op run re-parses nothing");

    // Modify a.txt -> only a re-parses.
    await writeFile(join(dir, "a.txt"), "a2");
    f = make(dir, store);
    await f.all();
    assert.deepEqual(
      f.parseLog.map((p) => p.endsWith("a.txt")),
      [true],
      "modify re-parses only the changed file",
    );

    // Add c.txt -> only c parses (a, b are cache hits); listing changed.
    await writeFile(join(dir, "c.txt"), "c");
    f = make(dir, store);
    const withC = await f.all();
    assert.equal(withC.length, 3, "added file appears in results");
    assert.deepEqual(
      f.parseLog.map((p) => p.endsWith("c.txt")),
      [true],
      "add parses only the new file",
    );

    // Delete b.txt -> it drops out of results; surviving files (a, c) are cache
    // hits and are not re-parsed. (The deleted file's task may be probed once
    // during verification before it errors out; that's expected.)
    await rm(join(dir, "b.txt"));
    f = make(dir, store);
    const afterDelete = await f.all();
    assert.equal(afterDelete.length, 2, "deleted file drops from results");
    assert.ok(
      f.parseLog.every((p) => p.endsWith("b.txt")),
      "no surviving file is re-parsed on delete",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
