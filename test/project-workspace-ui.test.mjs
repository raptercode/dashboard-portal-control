import test from "node:test";
import assert from "node:assert/strict";
import { createPoller } from "../public/ui/core/polling.js";
function harness(load, options = {}) {
  const timers = [],
    renders = [],
    errors = [];
  const poller = createPoller({
    load,
    render: (value) => renders.push(value),
    onError: (error) => errors.push(error.message),
    setTimer: (callback) => {
      timers.push(callback);
      return callback;
    },
    clearTimer: (timer) => {
      const index = timers.indexOf(timer);
      if (index >= 0) timers.splice(index, 1);
    },
    ...options,
  });
  return { poller, timers, renders, errors };
}
test("closed views ignore an in-flight response and never schedule another poll", async () => {
  let resolve;
  const x = harness(() => new Promise((r) => (resolve = r)));
  x.poller.start();
  const pending = x.poller.run();
  x.poller.stop();
  resolve("stale");
  await pending;
  assert.deepEqual(x.renders, []);
  assert.equal(x.timers.length, 0);
});
test("terminal jobs render once and stop polling", async () => {
  const x = harness(async () => ({ status: "succeeded" }), {
    terminal: (r) => r.status === "succeeded",
  });
  x.poller.start();
  x.timers.shift();
  await x.poller.run();
  assert.equal(x.renders.length, 1);
  assert.equal(x.poller.active, false);
  assert.equal(x.timers.length, 0);
});
test("hidden pages pause network traffic; transient failures remain retryable", async () => {
  let visible = false,
    calls = 0;
  const x = harness(
    async () => {
      calls++;
      if (calls === 1) throw new Error("temporary");
      return "ready";
    },
    { visible: () => visible },
  );
  x.poller.start();
  x.timers.shift();
  await x.poller.run();
  assert.equal(calls, 0);
  visible = true;
  x.timers.length = 0;
  await x.poller.run();
  assert.deepEqual(x.errors, ["temporary"]);
  x.timers.length = 0;
  await x.poller.run();
  assert.deepEqual(x.renders, ["ready"]);
  x.poller.stop();
});
