import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { buildSystem, inMemoryStore } from "../src/borek/index.js";
import withObjectInterface from "../src/borek/objectInterface.js";
import { File, withFiles, invalidateChangedFiles } from "../src/borek/files.js";

test("invalidateChangedFiles re-runs only tasks whose files changed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "borek-files-"));
  const a = join(dir, "a.txt");
  const b = join(dir, "b.txt");
  try {
    await writeFile(a, "a1");
    await writeFile(b, "b1");

    const log = [];
    const tasks = withFiles(
      withObjectInterface({
        readA: async function () {
          log.push("readA");
          return File(a);
        },
        readB: async function () {
          log.push("readB");
          return File(b);
        },
        both: async function () {
          await this.readA();
          await this.readB();
          return true;
        },
      }),
    );
    const store = inMemoryStore();
    const root = { method: "both", args: [] };

    const build = buildSystem({
      tasks,
      store,
      invalidator: invalidateChangedFiles,
    });
    await build(root);
    assert.deepEqual(log.sort(), ["readA", "readB"]);

    // No file changed -> nothing re-runs.
    log.length = 0;
    await build(root);
    assert.deepEqual(log, []);

    // Change only a.txt -> only readA re-runs.
    log.length = 0;
    await writeFile(a, "a2");
    await build(root);
    assert.deepEqual(log, ["readA"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
