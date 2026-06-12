import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { Borek, Volatile, File, inMemoryStore, onDiskStore } from "./index.js";

// A small task graph used across tests:
//     foo = bar + 1
//     bar = baz * 2
// `log` records which tasks actually executed; `baz` reads from input.
class Graph extends Borek<{ baz: number }> {
  log: string[] = [];
  async foo(): Promise<number> {
    this.log.push("foo");
    return (await this.bar()) + 1;
  }
  async bar(): Promise<number> {
    this.log.push("bar");
    return (await this.baz()) * 2;
  }
  async baz(): Promise<number> {
    this.log.push("baz");
    return this.input("baz");
  }
}

const FOO = { method: "foo", args: [] };
const BAZ = { method: "baz", args: [] };

test("computes a value through its dependency chain", async () => {
  const store = inMemoryStore();
  const g = new Graph({ baz: 1 }, { store });
  assert.equal(await g.foo(), 3);
  assert.deepEqual(g.log, ["foo", "bar", "baz"]);
});

test("serves cached values without re-executing", async () => {
  const store = inMemoryStore();
  const g = new Graph({ baz: 1 }, { store });
  await g.foo();
  g.log.length = 0;
  assert.equal(await g.foo(), 3);
  assert.deepEqual(g.log, []);
});

test("early-exits when an invalidated dep recomputes to the same value", async () => {
  const store = inMemoryStore();
  const g = new Graph({ baz: 1 }, { store });
  await g.foo();
  g.log.length = 0;
  // input("baz") is Volatile, so it is reconsidered every build; but it returns
  // 1 again, so baz (and bar, foo) all early-exit and none re-run.
  assert.equal(await g.foo(), 3);
  assert.deepEqual(g.log, []);
});

test("propagates a real input change up the whole chain", async () => {
  const store = inMemoryStore();
  const g = new Graph({ baz: 1 }, { store });
  await g.foo();
  g.log.length = 0;
  // Build a new instance sharing the store but with a different input.
  const g2 = new Graph({ baz: 10 }, { store });
  assert.equal(await g2.foo(), 21);
});

test("Volatile re-runs every build but allows downstream early-exit", async () => {
  let counter = 0;
  const log: string[] = [];
  class V extends Borek {
    async top(): Promise<number> {
      log.push("top");
      return (await this.vol()) + 100;
    }
    async vol(): Promise<number> {
      log.push("vol");
      counter++;
      return Volatile(5);
    }
  }
  const v = new V({}, { store: inMemoryStore() });
  assert.equal(await v.top(), 105);
  log.length = 0;
  assert.equal(await v.top(), 105);
  assert.ok(log.includes("vol"), "volatile re-runs");
  assert.ok(!log.includes("top"), "stable downstream -> top not re-run");
  assert.equal(counter, 2);
});

test("deduplicates concurrent requests for the same task", async () => {
  const log: string[] = [];
  class D extends Borek {
    async root(): Promise<number> {
      const [a, b] = await Promise.all([this.shared(), this.shared()]);
      return a + b;
    }
    async shared(): Promise<number> {
      log.push("shared");
      await new Promise((r) => setTimeout(r, 10));
      return 21;
    }
  }
  const d = new D({}, { store: inMemoryStore() });
  assert.equal(await d.root(), 42);
  assert.equal(log.filter((x) => x === "shared").length, 1);
});

test("keys tasks by arguments", async () => {
  const log: number[] = [];
  class S extends Borek {
    async square(n: number): Promise<number> {
      log.push(n);
      return n * n;
    }
  }
  const s = new S({}, { store: inMemoryStore() });
  assert.equal(await s.square(3), 9);
  assert.equal(await s.square(4), 16);
  assert.equal(await s.square(3), 9);
  assert.deepEqual(log, [3, 4]);
});

test("typed input() reads from the constructor argument", async () => {
  class C extends Borek<{ name: string; count: number }> {
    async greet(): Promise<string> {
      const name = await this.input("name");
      const count = await this.input("count");
      return `${name}:${count}`;
    }
  }
  const c = new C({ name: "x", count: 7 }, { store: inMemoryStore() });
  assert.equal(await c.greet(), "x:7");
});

test("onDiskStore persists the graph across runs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "borek-disk-"));
  const cachePath = join(dir, "cache.json");
  try {
    const g1 = new Graph({ baz: 1 }, { store: await onDiskStore(cachePath) });
    assert.equal(await g1.foo(), 3);
    const g2 = new Graph({ baz: 1 }, { store: await onDiskStore(cachePath) });
    assert.equal(await g2.foo(), 3);
    // Everything is cached on disk and the Volatile input is unchanged, so a
    // fresh-from-disk build re-runs nothing.
    assert.deepEqual(g2.log, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("File dependencies re-run only the task whose file changed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "borek-file-"));
  const a = join(dir, "a.txt");
  const b = join(dir, "b.txt");
  try {
    await writeFile(a, "a1");
    await writeFile(b, "b1");
    const log: string[] = [];
    class T extends Borek<{ a: string; b: string }> {
      async both(): Promise<boolean> {
        await this.readA();
        await this.readB();
        return true;
      }
      async readA() {
        log.push("A");
        return File(await this.input("a"));
      }
      async readB() {
        log.push("B");
        return File(await this.input("b"));
      }
    }
    const t = new T({ a, b }, { store: inMemoryStore() });
    await t.both();
    assert.deepEqual(log.sort(), ["A", "B"]);
    log.length = 0;
    await t.both();
    assert.deepEqual(log, []);
    log.length = 0;
    await writeFile(a, "a2");
    await t.both();
    assert.deepEqual(log, ["A"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readFile tracks the dependency without a separate declare call", async () => {
  const dir = await mkdtemp(join(tmpdir(), "borek-readfile-"));
  const a = join(dir, "a.txt");
  const b = join(dir, "b.txt");
  try {
    await writeFile(a, "a1");
    await writeFile(b, "b1");
    const log: string[] = [];
    // Note: no File()/dependsOnFile — readFile both reads and tracks.
    class T extends Borek<{ a: string; b: string }> {
      async both() {
        return [await this.readA(), await this.readB()];
      }
      async readA() {
        log.push("A");
        return this.readFile(await this.input("a"));
      }
      async readB() {
        log.push("B");
        return this.readFile(await this.input("b"));
      }
    }
    const t = new T({ a, b }, { store: inMemoryStore() });
    assert.deepEqual(await t.both(), ["a1", "b1"]);
    log.length = 0;
    await t.both();
    assert.deepEqual(log, [], "no-op: nothing re-reads");
    log.length = 0;
    await writeFile(b, "b2");
    assert.deepEqual(await t.both(), ["a1", "b2"]);
    assert.deepEqual(log, ["B"], "only the changed file re-reads");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a file change propagates through a tracking task to its dependents", async () => {
  // Regression: a task that records file deps must return a value derived from
  // those files (e.g. their hashes), not void. If it returns a constant, the
  // engine early-exits ("value unchanged") when the file changes and dependents
  // never re-run — which previously meant editing the template didn't rebuild
  // pages.
  const dir = await mkdtemp(join(tmpdir(), "borek-propagate-"));
  const src = join(dir, "src.txt");
  try {
    await writeFile(src, "v1");
    const log: string[] = [];
    class T extends Borek<{ src: string }> {
      // mimics trackElmModule: records a file dep, returns its hash so the value
      // changes when the file does.
      async track() {
        const f = await this.file(await this.input("src"));
        return f.hash;
      }
      async compile() {
        log.push("compile");
        await this.track();
        return "output";
      }
    }
    const store = inMemoryStore();
    await new T({ src }, { store }).compile();
    assert.deepEqual(log, ["compile"]);

    // No change -> no recompile.
    log.length = 0;
    await new T({ src }, { store }).compile();
    assert.deepEqual(log, []);

    // Change the tracked file -> compile must re-run.
    log.length = 0;
    await writeFile(src, "v2");
    await new T({ src }, { store }).compile();
    assert.deepEqual(log, ["compile"], "file change must propagate to compile");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
