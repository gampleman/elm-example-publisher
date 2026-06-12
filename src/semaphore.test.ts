import { test } from "node:test";
import assert from "node:assert/strict";
import { createSemaphore } from "./semaphore.js";

test("semaphore never exceeds the concurrency limit", async () => {
  const limit = createSemaphore(3);
  let active = 0;
  let peak = 0;
  const task = () =>
    limit(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    });
  await Promise.all(Array.from({ length: 20 }, task));
  assert.ok(peak <= 3, `peak concurrency ${peak} should be <= 3`);
  assert.equal(active, 0);
});

test("semaphore returns results and propagates errors", async () => {
  const limit = createSemaphore(2);
  assert.equal(await limit(async () => 42), 42);
  await assert.rejects(
    limit(async () => {
      throw new Error("boom");
    }),
    /boom/,
  );
  // A rejected task must still release its slot — subsequent work proceeds.
  assert.equal(await limit(async () => "ok"), "ok");
});
