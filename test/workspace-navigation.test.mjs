import test from "node:test";
import assert from "node:assert/strict";
import { createApi } from "../public/ui/core/api.js";
import { pipelineStages } from "../public/ui/core/model.js";
const response = (body, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});
test("API cache deduplicates simultaneous reads but never persists ENV values or caches mutations", async () => {
  let calls = 0;
  const api = createApi({
    fetcher: async () => {
      calls++;
      return response({ value: calls });
    },
  });
  await Promise.all([api.get("/api/projects"), api.get("/api/projects")]);
  assert.equal(calls, 1);
  await api.get("/api/projects/app/environment", { ttl: 0 });
  await api.get("/api/projects/app/environment", { ttl: 0 });
  assert.equal(calls, 3);
  await api.post("/api/projects/app/deploy");
  await api.get("/api/projects");
  assert.equal(calls, 5);
});
test("failed reads are retryable and mutation requests send the current CSRF token", async () => {
  let fail = true,
    last;
  const api = createApi({
    fetcher: async (path, options) => {
      last = options;
      if (path === "/api/session")
        return response({ csrfToken: "csrf-fixture" });
      if (fail) {
        fail = false;
        return response({ error: "Unavailable" }, 503);
      }
      return response({ ok: true });
    },
  });
  await api.get("/api/session");
  await assert.rejects(api.get("/api/projects"), /Unavailable/);
  await api.get("/api/projects");
  await api.post("/api/git-config", { name: "Test" });
  assert.equal(last.headers["x-csrf-token"], "csrf-fixture");
  assert.equal(last.credentials, "same-origin");
});
const states = (project) => pipelineStages(project).map((stage) => stage.state);
test("pipeline stages describe source, build and serving from one project record", () => {
  const live = {
    sync: { status: "synced" },
    deployment: {
      state: "active",
      activeReleaseId: "r1",
      releases: [{ id: "r1", status: "active", createdAt: "2026-01-01T00:00:00Z", activatedAt: "2026-01-01T00:01:00Z" }],
    },
  };
  assert.deepEqual(states(live), ["ok", "ok", "ok"]);
  assert.deepEqual(
    pipelineStages(live).map((stage) => stage.key),
    ["source", "build", "serving"],
  );
  assert.deepEqual(states({ sync: { status: "synced" }, deployment: {} }), ["ok", "idle", "idle"]);
  assert.deepEqual(states({ sync: { status: "needs_ssh_key" }, deployment: {} }), ["bad", "idle", "idle"]);
  assert.deepEqual(
    states({
      sync: { status: "synced" },
      deployment: { state: "failed", releases: [{ id: "r2", status: "failed", createdAt: "2026-01-02T00:00:00Z" }] },
    }),
    ["ok", "bad", "idle"],
  );
  // A running deployment keeps serving the previous release while the new one builds.
  const building = states({
    sync: { status: "synced" },
    deploymentProgress: { status: "running" },
    deployment: { state: "active", activeReleaseId: "r1", releases: [{ id: "r1", status: "active" }] },
  });
  assert.deepEqual(building, ["ok", "busy", "ok"]);
  assert.equal(states({ sync: { status: "synced" }, runtimeStatus: { state: "down" }, deployment: { state: "active", activeReleaseId: "r1", releases: [{ id: "r1", status: "active" }] } })[2], "bad");
  assert.ok(pipelineStages(live).every((stage) => typeof stage.detail === "string" && stage.detail));
});
