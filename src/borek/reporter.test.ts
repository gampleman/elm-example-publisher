import { test } from "node:test";
import assert from "node:assert/strict";
import { Borek, inMemoryStore, type BuildEvent } from "./index.js";

const methods = (events: BuildEvent[], type: BuildEvent["type"]) =>
  events.filter((e) => e.type === type).map((e) => e.key.method);

test("reporter sees real tasks, not cache hits or built-ins", async () => {
  const events: BuildEvent[] = [];
  class Site extends Borek<{ n: number }> {
    async main() {
      return (await this.double()) + (await this.input("n"));
    }
    async double() {
      return (await this.input("n")) * 2;
    }
  }
  const store = inMemoryStore();
  const site = new Site({ n: 5 }, { store, reporter: (e) => events.push(e) });

  await site.main();
  // First run: main + double execute; input() is a built-in and filtered out.
  assert.deepEqual(methods(events, "start").sort(), ["double", "main"]);
  assert.deepEqual(methods(events, "finish").sort(), ["double", "main"]);
  assert.ok(!methods(events, "start").includes("input"), "built-ins filtered");

  // Second run: everything cached -> no events.
  events.length = 0;
  await site.main();
  assert.deepEqual(events, []);
});

test("reporter emits an error event when a task throws", async () => {
  const events: BuildEvent[] = [];
  class Failing extends Borek {
    async main() {
      return this.boom();
    }
    async boom(): Promise<never> {
      throw new Error("kaboom");
    }
  }
  const site = new Failing(
    {},
    { store: inMemoryStore(), reporter: (e) => events.push(e) },
  );
  await assert.rejects(site.main(), /kaboom/);
  const errored = events
    .filter((e) => e.type === "error")
    .map((e) => e.key.method);
  assert.ok(errored.includes("boom"), "boom reported as error");
});

test("finish events carry a non-negative duration", async () => {
  const events: BuildEvent[] = [];
  class Slow extends Borek {
    async main() {
      await new Promise((r) => setTimeout(r, 10));
      return 1;
    }
  }
  await new Slow(
    {},
    { store: inMemoryStore(), reporter: (e) => events.push(e) },
  ).main();
  const finish = events.find((e) => e.type === "finish");
  assert.ok(finish && finish.type === "finish" && finish.durationMs >= 0);
});
