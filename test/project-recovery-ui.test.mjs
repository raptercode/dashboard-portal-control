import test from "node:test";
import assert from "node:assert/strict";
import {
  projectStatus,
  recoveredAfterFailure,
} from "../public/ui/core/model.js";
const fixture = () => ({
  sync: { status: "synced" },
  runtimeStatus: { state: "up" },
  deploymentProgress: { status: "failed", updatedAt: "2026-10-19T20:00:00Z" },
  deployment: {
    state: "active",
    activeReleaseId: "active",
    releases: [
      {
        id: "failed",
        status: "failed",
        createdAt: "2026-10-19T19:00:00Z",
        events: [{ status: "failed", at: "2026-10-19T20:00:00Z" }],
      },
      { id: "active", status: "active", activatedAt: "2026-10-19T21:00:00Z" },
    ],
  },
});
test("a successful rollback keeps the active release live without removing the failed candidate history", () => {
  const p = fixture();
  assert.equal(recoveredAfterFailure(p), true);
  assert.equal(projectStatus(p).id, "ready");
  assert.equal(p.deployment.releases[0].status, "failed");
});
test("rollback progress takes precedence and a more recent failure or down runtime remains visible", () => {
  const p = fixture();
  p.deployment.state = "rolling_back";
  assert.equal(projectStatus(p).id, "building");
  p.deployment.state = "active";
  p.deploymentProgress.updatedAt = "2026-10-19T22:00:00Z";
  assert.equal(projectStatus(p).id, "down");
  p.deploymentProgress.updatedAt = "2026-10-19T20:00:00Z";
  p.runtimeStatus.state = "down";
  assert.equal(projectStatus(p).id, "down");
});
