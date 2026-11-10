import { runtimeLabel } from "./runtimes.js";
import { bytes } from "./dom.js";
export const groups = {
  workspace: {
    label: "Workspace",
    icon: "grid",
    links: [
      ["Overview", "/", "master"],
      ["Applications", "/projects"],
      ["Deployments", "/deployments"],
      ["Activity", "/activity", "audit.read"],
    ],
  },
  infrastructure: {
    label: "Infrastructure",
    icon: "server",
    links: [
      ["Host & runtimes", "/setup", "master"],
      ["Databases", "/databases", "master"],
      ["Mail service", "/mail", "master"],
    ],
  },
  access: {
    label: "Access",
    icon: "key",
    links: [
      ["Team & organizations", "/members", "master"],
      ["Git credentials", "/credentials", "credentials"],
    ],
  },
  settings: {
    label: "Settings",
    icon: "settings",
    links: [
      ["Account & CLI", "/settings/account"],
      ["System updates", "/settings/updates", "master"],
      ["Integrations", "/settings/monitor", "master"],
    ],
  },
};
export function can(access, permission, project) {
  if (access?.user?.role === "master") return true;
  return (access?.organizations || []).some(
    (org) =>
      (!project || org.id === project.organizationId) &&
      org.permissions?.includes(permission),
  );
}
export function navigation(access) {
  return Object.entries(groups)
    .map(([id, group]) => ({
      ...group,
      id,
      links: group.links.filter(
        ([, path, permission]) =>
          !permission ||
          (permission === "master"
            ? access?.user?.role === "master"
            : permission === "credentials"
              ? [
                  "credentials.use",
                  "credentials.create",
                  "credentials.update",
                  "credentials.delete",
                ].some((p) => can(access, p))
              : can(access, permission)),
      ),
    }))
    .filter((g) => g.links.length);
}
export function routeFor(input) {
  const url = new URL(input, "http://local");
  const path = url.pathname;
  if (path === "/invite")
    return { id: "invite", module: "auth", group: "access", url };
  const flow = path.match(
    /^\/projects\/(?:new|([a-z][a-z0-9-]{0,62})\/edit)(?:\/(repository|review))?$/,
  );
  if (flow)
    return {
      id: "project-form",
      module: "project",
      group: "workspace",
      slug: flow[1] || "",
      step: flow[2] === "repository" ? 2 : flow[2] === "review" ? 3 : 1,
      url,
    };
  const logs = path.match(/^\/projects\/([a-z][a-z0-9-]{0,62})\/logs$/);
  if (logs)
    return {
      id: "logs",
      module: "project",
      group: "workspace",
      slug: logs[1],
      url,
    };
  const db = path.match(/^\/databases\/([a-f0-9-]{36})\/console$/i);
  if (db)
    return {
      id: "console",
      module: "infrastructure",
      group: "infrastructure",
      slug: db[1],
      url,
      master: true,
    };
  if (path === "/mail/setup")
    return {
      id: "mail-setup",
      module: "mail",
      group: "infrastructure",
      url,
      master: true,
    };
  const requestedSection = url.searchParams.get("section");
  const settings =
    path === "/settings"
      ? ["account", "updates", "monitor"].includes(requestedSection)
        ? requestedSection
        : "account"
      : path.match(/^\/settings\/(account|updates|monitor)$/)?.[1];
  if (settings && ["account", "updates", "monitor"].includes(settings))
    return {
      id: settings,
      module: "settings",
      group: "settings",
      url,
      master: settings !== "account",
    };
  const routes = {
    "/": ["overview", "workspace", "workspace", true],
    "/projects": ["projects", "workspace", "workspace"],
    "/deployments": ["deployments", "workspace", "workspace"],
    "/activity": ["activity", "workspace", "workspace"],
    "/setup": ["setup", "infrastructure", "infrastructure", true],
    "/databases": ["databases", "infrastructure", "infrastructure", true],
    "/mail": ["mail", "mail", "infrastructure", true],
    "/members": ["members", "access", "access", true],
    "/credentials": ["credentials", "access", "access"],
  };
  const r = routes[path];
  return r
    ? { id: r[0], module: r[1], group: r[2], master: !!r[3], url }
    : { id: "not-found", group: "workspace", url };
}
export function projectStatus(project) {
  const d = project.deployment || {},
    s = project.sync || {},
    release = d.releases?.[0];
  if (
    project.runtimeOperation?.status === "running" ||
    ["queued", "running"].includes(project.deploymentProgress?.status) ||
    ["deploying", "rolling_back", "awaiting_activation"].includes(d.state)
  )
    return {
      id: "building",
      label: "In progress",
      tone: "pending",
      phase: operationLabel(project),
    };
  const recovered = recoveredAfterFailure(project);
  if (
    project.runtimeStatus?.state === "down" ||
    ["failed", "needs_ssh_key"].includes(s.status) ||
    d.state === "failed" ||
    (release?.status === "failed" && !recovered)
  )
    return { id: "down", label: "Needs attention", tone: "danger" };
  if (d.state === "active" && d.activeReleaseId)
    return { id: "ready", label: "Live", tone: "success" };
  return { id: "pause", label: "Ready to release", tone: "neutral" };
}
const phaseLabels = {
  source_copy: "เตรียม source",
  dependencies: "ติดตั้ง dependencies",
  install: "ติดตั้ง dependencies",
  build: "กำลัง build",
  worker_preflight: "เตรียม Worker โดยยังไม่เริ่ม process",
  candidate_health: "ตรวจสุขภาพ candidate",
  docker_preflight: "ตรวจ Docker Compose",
  health_check: "ตรวจสุขภาพ",
  health: "ตรวจสุขภาพ",
  host_activation: "เปิดใช้งานบน host",
  activation: "เปิดใช้งาน release",
  start: "เริ่ม service",
};
const terminalLabels = {
  succeeded: "Deploy สำเร็จ",
  failed: "Deploy ล้มเหลว",
  cancelled: "ยกเลิก deploy",
  interrupted: "Deploy ถูกขัดจังหวะ",
};
// One line on where a deployment is: the phase it is in, or how it ended.
export function deployProgressLabel(progress = {}) {
  if (terminalLabels[progress.status]) return terminalLabels[progress.status];
  if (progress.status === "queued") return "รอคิว deploy";
  const label =
    phaseLabels[progress.phase] ||
    (progress.phase ? progress.phase.replaceAll("_", " ") : "เตรียม deploy");
  if (progress.phaseStatus === "skipped") return label + " · ข้ามขั้นตอน";
  return progress.phaseStatus === "passed" ? label + " · ผ่านแล้ว" : label;
}
// What the application shows about its latest deployment, or null if none.
// A rollback in progress, or a successful one after a failure, comes first.
export function progressSummary(project) {
  const progress = project.deploymentProgress;
  const rollingBack = project.deployment?.state === "rolling_back";
  if (!progress && !rollingBack) return null;
  const recovered = recoveredAfterFailure(project);
  const active =
    rollingBack || ["queued", "running"].includes(progress?.status);
  return {
    active,
    rollingBack,
    recovered,
    failed:
      !rollingBack &&
      !recovered &&
      ["failed", "interrupted"].includes(progress?.status),
    jobId: progress?.id || null,
    label: rollingBack
      ? "กำลังย้อนกลับ…"
      : recovered
        ? `ย้อนกลับสำเร็จ · release ${String(project.deployment.activeReleaseId).slice(0, 8)}`
        : deployProgressLabel(progress),
  };
}
// The phase to show next to "In progress".
export function operationLabel(project) {
  const operation = project.runtimeOperation;
  if (operation?.status === "running")
    return operation.kind === "restart" ? "กำลัง restart app" : "กำลังดำเนินการ";
  const summary = progressSummary(project);
  return summary?.active ? summary.label : "";
}
const releaseOf = (project, id) =>
  project.deployment?.releases?.find((release) => release.id === id);
const identity = (release) =>
  release
    ? `${release.id} (commit ${release.revision?.slice(0, 7) || "ไม่ทราบ"})`
    : "ไม่พบ release";
// Both releases are named by id and commit; when the commit is the same the
// confirmation says so, because the visible commit will not change.
export function rollbackConfirmation(project, targetId) {
  const active = releaseOf(project, project.deployment?.activeReleaseId);
  const target = releaseOf(project, targetId);
  const same =
    active?.revision && active.revision === target?.revision
      ? " ทั้งสอง release ใช้ commit เดียวกัน เลข commit จะไม่เปลี่ยน"
      : "";
  return `ย้อน ${project.name} จาก ${identity(active)} ไป ${identity(target)}?${same}`;
}
// Restart reuses the deployed release and its ENV; the text names the release.
export function restartConfirmation(project) {
  const active = releaseOf(project, project.deployment?.activeReleaseId);
  return `เริ่ม process ใหม่จาก release ${String(project.deployment?.activeReleaseId || "").slice(0, 8)}${active?.revision ? ` · commit ${active.revision.slice(0, 12)}` : ""} แอปจะหยุดชั่วครู่ ใช้ ENV ที่ deploy อยู่เดิม หากแก้ ENV ใหม่ให้ใช้ Deploy เพื่อรัน build ด้วย`;
}
// The three stations of a release: source → build → serving. Pure, so the
// list, the overview and the application sheet always agree with each other.
export function pipelineStages(project) {
  const d = project.deployment || {},
    s = project.sync || {},
    latest = d.releases?.[0],
    building = projectStatus(project).id === "building";
  const source =
    s.status === "synced"
      ? ["ok", "synced"]
      : ["failed", "needs_ssh_key"].includes(s.status)
        ? ["bad", s.status === "needs_ssh_key" ? "needs SSH key" : "sync failed"]
        : s.status === "syncing"
          ? ["busy", "syncing"]
          : ["idle", "not synced"];
  const build = building
    ? ["busy", "in progress"]
    : latest?.status === "failed" && !recoveredAfterFailure(project)
      ? ["bad", "failed"]
      : latest
        ? ["ok", "succeeded"]
        : ["idle", "no release yet"];
  const serving =
    project.runtimeStatus?.state === "down"
      ? ["bad", "down"]
      : d.state === "active" && d.activeReleaseId
        ? ["ok", "live"]
        : ["idle", "not live"];
  return [
    { key: "source", label: "Source", state: source[0], detail: source[1] },
    { key: "build", label: "Build", state: build[0], detail: build[1] },
    { key: "serving", label: "Serving", state: serving[0], detail: serving[1] },
  ];
}
export const runtimeName = (project) => runtimeLabel(project);
export const slugify = (value) => {
  const result = String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return (/^[a-z]/.test(result) ? result : result ? "app-" + result : "").slice(
    0,
    63,
  );
};
export const isWorker = (project) => project.serviceType === "worker";
// What the Storage tab says about an application's persistent storage, from
// GET /api/projects/:slug/storage. Pure, so the wording can be tested.
export function storageSummary(data) {
  if (!data?.configured) return { configured: false };
  const { state, usage } = data;
  const meaning =
    state === "active"
      ? "release ที่ใช้งานอยู่ link มาที่โฟลเดอร์นี้แล้ว ไฟล์ไม่หายเมื่อ deploy, rollback หรือ restart"
      : state === "pending"
        ? data.deployed
          ? "release ที่ใช้งานอยู่ยังไม่ได้ link มาที่โฟลเดอร์นี้ จะมีผลเมื่อ deploy ครั้งถัดไป"
          : "ยังไม่มี release โฟลเดอร์จะถูกสร้างตอน deploy ครั้งแรก"
        : data.notice || "อ่านสถานะจาก host ไม่สำเร็จ";
  return {
    configured: true,
    tone: state === "active" ? "success" : state === "pending" ? "pending" : "danger",
    label:
      state === "active"
        ? "ใช้งานอยู่"
        : state === "pending"
          ? "รอ deploy ถัดไป"
          : "อ่านสถานะไม่ได้",
    meaning,
    rows: [
      ["Mount path", data.path, true],
      ["โฟลเดอร์บนโฮสต์", data.directory, true],
      ["ขนาดที่ใช้", usage ? bytes(usage.bytes) : "—"],
      ["จำนวนรายการ", usage ? `${usage.items.toLocaleString("th-TH")} รายการ` : "—"],
      [
        "พื้นที่ดิสก์ที่เหลือ",
        usage ? `${bytes(usage.availableBytes)} จาก ${bytes(usage.totalBytes)}` : "—",
      ],
    ],
    // The folder is there but counting failed or timed out.
    uncounted: data.available !== false && data.exists === true && !usage,
    simulated: data.simulated === true,
  };
}
export function validateService(draft) {
  if (
    isWorker(draft) &&
    !["node", "bun", "go", "python"].includes(draft.runtime)
  )
    return "Worker รองรับ Node.js, Bun, Go และ Python script";
  if (
    isWorker(draft) &&
    draft.runtime === "python" &&
    (draft.pythonMode || "script") !== "script"
  )
    return "Python Worker ต้องใช้ script mode";
  return "";
}
export function syncPayload(project) {
  const result = { ...project };
  for (const key of [
    "sync",
    "deployment",
    "deploymentProgress",
    "runtimeStatus",
    "runtimeOperation",
    "environment",
    "domains",
    "autoSync",
    "createdAt",
    "updatedAt",
    "actionsHook",
    "githubWebhook",
  ])
    delete result[key];
  if (isWorker(result)) {
    result.port = null;
    result.healthCheckEnabled = false;
    result.healthCheckPath = "/";
  }
  return result;
}

export function sourceCredentials(access, credentials, organizationId) {
  if (!can(access, "credentials.use", { organizationId })) return [];
  return credentials.filter(
    (c) =>
      c.organizationId === organizationId ||
      (access?.user?.role === "master" && !c.organizationId),
  );
}
export function sourceIsLocked(access, project, credentials) {
  if (!project || access?.user?.role === "master") return false;
  if (project.sshKeyId) return true;
  if (!project.credentialId) return false;
  const credential = credentials.find((c) => c.id === project.credentialId);
  return (
    !can(access, "credentials.use", project) ||
    credential?.organizationId !== project.organizationId
  );
}
export function defaultSourceCredential(
  access,
  credentials,
  organizationId,
  repository,
  defaultId,
) {
  if (String(repository).startsWith("git@")) return null;
  let host;
  try {
    host = new URL(repository).hostname.toLowerCase();
  } catch {
    return null;
  }
  const items = sourceCredentials(access, credentials, organizationId).filter(
    (c) => c.host?.toLowerCase() === host,
  );
  return (
    items.find((c) => c.organizationId === organizationId && c.isDefault) ||
    items.find((c) => c.id === defaultId) ||
    null
  );
}
export function hasNewerSyncedRevision({
  syncStatus,
  syncRevision,
  deployedRevision,
}) {
  return (
    syncStatus === "synced" &&
    !!syncRevision &&
    syncRevision !== deployedRevision
  );
}
export function recoveredAfterFailure(project) {
  const d = project.deployment || {},
    latest = d.releases?.[0],
    active = d.releases?.find((r) => r.id === d.activeReleaseId);
  if (
    d.state !== "active" ||
    latest?.status !== "failed" ||
    active?.status !== "active"
  )
    return false;
  const failedAt = Math.max(
    ...[
      latest.createdAt,
      ...(latest.events || [])
        .filter((e) => e.status === "failed")
        .map((e) => e.at),
      project.deploymentProgress?.updatedAt,
    ]
      .map(Date.parse)
      .filter(Number.isFinite),
  );
  return Number.isFinite(failedAt) && Date.parse(active.activatedAt) > failedAt;
}
