import test from "node:test";
import assert from "node:assert/strict";
import {
  isWorker,
  syncPayload,
  validateService,
} from "../public/ui/core/model.js";
test("worker sync strips serving state and HTTP settings while preserving runtime-specific fields", () => {
  const payload = syncPayload({
    serviceType: "worker",
    runtime: "python",
    pythonMode: "script",
    pythonEntry: "worker.py",
    port: 3000,
    healthCheckEnabled: true,
    healthCheckPath: "/health",
    deployment: { state: "active" },
    environment: { content: "secret" },
    domains: { hosts: ["example.com"] },
  });
  assert.equal(payload.port, null);
  assert.equal(payload.healthCheckEnabled, false);
  assert.equal(payload.healthCheckPath, "/");
  assert.equal(payload.pythonEntry, "worker.py");
  assert.ok(!("deployment" in payload));
  assert.ok(!("environment" in payload));
  assert.ok(!("domains" in payload));
});
test("worker runtime choices match the backend, including Python script restrictions", () => {
  assert.equal(isWorker({ serviceType: "worker" }), true);
  for (const runtime of ["node", "bun", "go"])
    assert.equal(validateService({ serviceType: "worker", runtime }), "");
  assert.equal(
    validateService({
      serviceType: "worker",
      runtime: "python",
      pythonMode: "script",
    }),
    "",
  );
  assert.match(
    validateService({
      serviceType: "worker",
      runtime: "python",
      pythonMode: "asgi",
    }),
    /script/,
  );
  for (const runtime of ["php", "docker-compose"])
    assert.ok(validateService({ serviceType: "worker", runtime }));
  assert.equal(validateService({ serviceType: "web", runtime: "php" }), "");
});
