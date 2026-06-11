import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import {
  buildSystem,
  inMemoryStore,
  onDiskStore,
  Volatile,
} from "../src/borek/index.js";
import withObjectInterface from "../src/borek/objectInterface.js";

// A small task graph used across tests:
//     foo = bar + 1
//     bar = baz * 2
// `log` records which tasks actually executed.
const makeGraph = (overrides = {}) => {
  const log = [];
  const values = { baz: 1, ...overrides };
  const tasks = withObjectInterface({
    foo: async function () {
      log.push("foo");
      return (await this.bar()) + 1;
    },
    bar: async function () {
      log.push("bar");
      return (await this.baz()) * 2;
    },
    baz: async function () {
      log.push("baz");
      return values.baz;
    },
  });
  return { tasks, log, values };
};

const foo = { method: "foo", args: [] };
const bar = { method: "bar", args: [] };
const baz = { method: "baz", args: [] };

test("computes a value through its dependency chain", async () => {
  const { tasks, log } = makeGraph();
  const build = buildSystem({ tasks, store: inMemoryStore() });
  assert.equal(await build(foo), 3);
  assert.deepEqual(log, ["foo", "bar", "baz"]);
});

test("serves cached values without re-executing", async () => {
  const { tasks, log } = makeGraph();
  const build = buildSystem({ tasks, store: inMemoryStore() });
  await build(foo);
  log.length = 0;
  assert.equal(await build(foo), 3);
  assert.deepEqual(log, [], "nothing should re-run when nothing changed");
});

test("early-exits when an invalidated dep recomputes to the same value", async () => {
  const { tasks, log } = makeGraph();
  const store = inMemoryStore();
  const build = buildSystem({ tasks, store });
  await build(foo);
  log.length = 0;

  // baz is marked stale but still returns 1 -> bar recomputes to 2 (unchanged)
  // -> foo must NOT recompute.
  store.invalidate(baz);
  assert.equal(await build(foo), 3);
  assert.deepEqual(log, ["baz"], "only baz should re-run; bar/foo unchanged");
});

test("propagates a real change up the whole chain", async () => {
  const graph = makeGraph();
  const store = inMemoryStore();
  const build = buildSystem({ tasks: graph.tasks, store });
  await build(foo);
  graph.log.length = 0;

  // Change baz's underlying value, then invalidate it.
  graph.values.baz = 10;
  store.invalidate(baz);
  assert.equal(await build(foo), 21, "10*2+1");
  assert.deepEqual(graph.log.sort(), ["bar", "baz", "foo"]);
});

test("Volatile tasks re-run every build but still allow downstream early-exit", async () => {
  const log = [];
  let counter = 0;
  const tasks = withObjectInterface({
    top: async function () {
      log.push("top");
      return (await this.vol()) + 100;
    },
    vol: async function () {
      log.push("vol");
      counter++;
      // Returns the same value each time despite being volatile.
      return Volatile(5);
    },
  });
  const store = inMemoryStore();
  const build = buildSystem({ tasks, store });
  const top = { method: "top", args: [] };

  assert.equal(await build(top), 105);
  log.length = 0;
  assert.equal(await build(top), 105);
  assert.ok(log.includes("vol"), "volatile task re-runs");
  assert.ok(!log.includes("top"), "stable downstream value -> top not re-run");
  assert.equal(counter, 2);
});

test("deduplicates concurrent requests for the same task", async () => {
  const log = [];
  const tasks = withObjectInterface({
    root: async function () {
      // Two branches both depend on shared; it must execute only once.
      const [a, b] = await Promise.all([this.shared(), this.shared()]);
      return a + b;
    },
    shared: async function () {
      log.push("shared");
      await new Promise((r) => setTimeout(r, 10));
      return 21;
    },
  });
  const build = buildSystem({ tasks, store: inMemoryStore() });
  assert.equal(await build({ method: "root", args: [] }), 42);
  assert.equal(log.filter((x) => x === "shared").length, 1);
});

test("onDiskStore persists the graph across runs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "borek-test-"));
  const cachePath = join(dir, "cache.json");
  try {
    const g1 = makeGraph();
    const build1 = buildSystem({
      tasks: g1.tasks,
      store: await onDiskStore(cachePath),
    });
    assert.equal(await build1(foo), 3);

    // Fresh store loaded from disk -> nothing should re-run.
    const g2 = makeGraph();
    const build2 = buildSystem({
      tasks: g2.tasks,
      store: await onDiskStore(cachePath),
    });
    assert.equal(await build2(foo), 3);
    assert.deepEqual(
      g2.log,
      [],
      "loaded-from-disk build should be fully cached",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("keys tasks by arguments", async () => {
  const log = [];
  const tasks = withObjectInterface({
    square: async function (n) {
      log.push(n);
      return n * n;
    },
  });
  const build = buildSystem({ tasks, store: inMemoryStore() });
  assert.equal(await build({ method: "square", args: [3] }), 9);
  assert.equal(await build({ method: "square", args: [4] }), 16);
  assert.equal(await build({ method: "square", args: [3] }), 9);
  assert.deepEqual(log, [3, 4], "distinct args computed once each, 3 cached");
});
