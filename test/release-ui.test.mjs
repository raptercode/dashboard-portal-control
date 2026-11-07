import test from "node:test";
import assert from "node:assert/strict";
import {
  deployProgressLabel,
  operationLabel,
  progressSummary,
  projectStatus,
  restartConfirmation,
  rollbackConfirmation,
} from "../public/ui/core/model.js";

const releases = (liveRevision = "a".repeat(40), previousRevision = liveRevision) => [
  { id: "rel-live-0002", revision: liveRevision, status: "active", activatedAt: "2026-11-07T01:00:00Z" },
  { id: "rel-prev-0001", revision: previousRevision, status: "succeeded" },
];
const project = (extra = {}) => ({
  name: "Alpha",
  sync: { status: "synced" },
  runtimeStatus: { state: "up" },
  deployment: { state: "active", activeReleaseId: "rel-live-0002", previousReleaseId: "rel-prev-0001", releases: releases() },
  ...extra,
});

test("each deployment phase has a plain label, and how it ended is spelled out", () => {
  assert.equal(deployProgressLabel({ status: "queued" }), "รอคิว deploy");
  assert.equal(deployProgressLabel({ status: "running", phase: "build" }), "กำลัง build");
  assert.equal(deployProgressLabel({ status: "running", phase: "candidate_health", phaseStatus: "passed" }), "ตรวจสุขภาพ candidate · ผ่านแล้ว");
  assert.equal(deployProgressLabel({ status: "running", phase: "build", phaseStatus: "skipped" }), "กำลัง build · ข้ามขั้นตอน");
  assert.equal(deployProgressLabel({ status: "running", phase: "unknown_step" }), "unknown step");
  assert.equal(deployProgressLabel({ status: "running" }), "เตรียม deploy");
  assert.equal(deployProgressLabel({ status: "succeeded" }), "Deploy สำเร็จ");
  assert.equal(deployProgressLabel({ status: "failed" }), "Deploy ล้มเหลว");
  assert.equal(deployProgressLabel({ status: "cancelled" }), "ยกเลิก deploy");
  assert.equal(deployProgressLabel({ status: "interrupted" }), "Deploy ถูกขัดจังหวะ");
});

test("the summary names a rollback in progress, a recovery after failure, or the running phase", () => {
  assert.equal(progressSummary(project()), null);
  const running = project({ deploymentProgress: { id: "job1", status: "running", phase: "build" } });
  assert.deepEqual(
    { ...progressSummary(running), jobId: undefined },
    { active: true, rollingBack: false, recovered: false, failed: false, jobId: undefined, label: "กำลัง build" },
  );
  assert.equal(progressSummary(running).jobId, "job1");
  const rolling = project({ deploymentProgress: { id: "job2", status: "running", phase: "activation" } });
  rolling.deployment.state = "rolling_back";
  assert.equal(progressSummary(rolling).label, "กำลังย้อนกลับ…");
  assert.equal(progressSummary(rolling).active, true);
  const failed = project({ deploymentProgress: { id: "job3", status: "failed", updatedAt: "2026-11-07T02:00:00Z" } });
  assert.equal(progressSummary(failed).failed, true);
  assert.equal(progressSummary(failed).active, false);
  // A failed candidate that was rolled back successfully is a recovery, not a failure.
  const recovered = project({ deploymentProgress: { id: "job4", status: "failed", updatedAt: "2026-11-07T00:00:00Z" } });
  recovered.deployment.releases = [
    { id: "rel-failed-0003", status: "failed", createdAt: "2026-11-06T23:00:00Z", events: [{ status: "failed", at: "2026-11-07T00:00:00Z" }] },
    ...releases(),
  ];
  const summary = progressSummary(recovered);
  assert.equal(summary.recovered, true);
  assert.equal(summary.failed, false);
  assert.equal(summary.label, "ย้อนกลับสำเร็จ · release rel-live");
});

test("the phase shows next to In progress, and a restart says so", () => {
  const running = project({ deploymentProgress: { status: "running", phase: "dependencies" } });
  assert.equal(projectStatus(running).id, "building");
  assert.equal(projectStatus(running).phase, "ติดตั้ง dependencies");
  assert.equal(operationLabel(project()), "");
  assert.equal(operationLabel(project({ deploymentProgress: { status: "succeeded" } })), "");
  assert.equal(operationLabel(project({ runtimeOperation: { kind: "restart", status: "running" } })), "กำลัง restart app");
  assert.equal(operationLabel(project({ runtimeOperation: { kind: "other", status: "running" } })), "กำลังดำเนินการ");
});

test("rollback names both releases by id and commit, and warns when the commit is the same", () => {
  const different = project();
  different.deployment.releases = releases("1111111aaaaaaa", "2222222bbbbbbb");
  assert.equal(
    rollbackConfirmation(different, "rel-prev-0001"),
    "ย้อน Alpha จาก rel-live-0002 (commit 1111111) ไป rel-prev-0001 (commit 2222222)?",
  );
  assert.match(rollbackConfirmation(project(), "rel-prev-0001"), /ทั้งสอง release ใช้ commit เดียวกัน เลข commit จะไม่เปลี่ยน/);
  assert.match(rollbackConfirmation(project(), "missing"), /ไป ไม่พบ release\?/);
  assert.match(rollbackConfirmation(different, "rel-prev-0001"), /rel-live-0002 \(commit 1111111\)/);
});

test("restart names the deployed release and says it keeps the deployed ENV", () => {
  const text = restartConfirmation(project());
  assert.match(text, /release rel-live ·/);
  assert.match(text, /commit aaaaaaaaaaaa/);
  assert.match(text, /ใช้ ENV ที่ deploy อยู่เดิม/);
  assert.match(text, /ให้ใช้ Deploy/);
});
