import {
  h,
  svg,
  icon,
  link,
  button,
  badge,
  heading,
  panel,
  empty,
  table,
  track,
  gauge,
  short,
  when,
  bytes,
  runtimeMark as logoTile,
} from "../core/dom.js";
import { logoName } from "../core/runtimes.js";
import {
  projectStatus,
  pipelineStages,
  runtimeName,
  hasNewerSyncedRevision,
} from "../core/model.js";
const runtimeMark = (project) => logoTile(logoName(project));
const statusBadge = (p) => {
  const s = projectStatus(p);
  return badge(s.phase || s.label, s.tone);
};
// A table repainted by a poll must not drop the keyboard focus on its row.
const keepFocus = (root, rowSelector, dataKey, repaint) => {
  const row = document.activeElement?.closest?.(rowSelector);
  const id = row && root.contains(row) ? row.dataset[dataKey] : null;
  repaint();
  if (!id) return;
  [...root.querySelectorAll(rowSelector)]
    .find((candidate) => candidate.dataset[dataKey] === id)
    ?.querySelector(".app-name")
    ?.focus();
};
// A release row: tone drives the node on the timeline.
const releaseTone = (r) =>
  r.status === "failed"
    ? "bad"
    : r.status === "succeeded" || r.status === "active"
      ? "ok"
      : "busy";
const releaseBadge = (r) =>
  badge(
    r.current ? "Live" : r.status,
    r.status === "failed"
      ? "danger"
      : r.status === "succeeded" || r.current
        ? "success"
        : "pending",
  );
// The whole row is the target. The name stays the one real control, so the
// keyboard and screen readers still have a single stop per row, while a click
// anywhere else on the row does the same thing. Text selection is left alone.
function rowOpens(row, open) {
  row.classList.add("row-link");
  row.addEventListener("click", (event) => {
    if (event.target.closest("a, button, input, select, textarea, label")) return;
    if (window.getSelection()?.toString()) return;
    void open();
  });
}
const chevron = () =>
  h("span", { class: "row-chevron", "aria-hidden": "true" }, icon("chevron"));
async function projectWorkspace(ctx, p) {
  const feature = await import("./release.js");
  if (!ctx.active()) return;
  return feature.openProject(ctx, p);
}
export async function mount(ctx) {
  if (ctx.route.id === "projects") return applications(ctx);
  if (ctx.route.id === "deployments") return deployments(ctx);
  if (ctx.route.id === "activity") return activity(ctx);
  return overview(ctx);
}
const statusOptions = [
  ["", "All"],
  ["ready", "Live"],
  ["building", "In progress"],
  ["down", "Needs attention"],
  ["pause", "Ready to release"],
];
async function applications(ctx) {
  const root = ctx.root;
  root.replaceChildren(
    heading(
      "Applications",
      "แอปทั้งหมดของคุณ พร้อม source, สถานะ และการดำเนินการ",
    ),
  );
  const data = await ctx.api.get("/api/projects");
  if (!ctx.active()) return;
  let projects = data.projects || [];
  let statusFilter = ctx.route.url.searchParams.get("status") || "";
  const search = h("input", {
    type: "search",
    placeholder: "ค้นหาแอป repository หรือองค์กร…",
    "aria-label": "ค้นหาแอป",
    value: ctx.route.url.searchParams.get("search") || "",
  });
  const segmented = h("div", {
    class: "segmented",
    role: "group",
    "aria-label": "สถานะแอป",
  });
  const orgs = [
    ...new Map(
      projects.map((p) => [
        p.organizationId || p.organization,
        {
          id: p.organizationId || p.organization,
          name: p.organization || "Default",
        },
      ]),
    ).values(),
  ];
  const org = h(
    "select",
    { "aria-label": "องค์กร", hidden: orgs.length < 2 },
    h("option", { value: "" }, "ทุกองค์กร"),
    ...orgs.map((o) => h("option", { value: o.id }, o.name)),
  );
  const count = h("span", { class: "collection-count" });
  const collection = h("div", { class: "panel" });
  let signature = JSON.stringify(projects);
  const update = (next) => {
    const now = JSON.stringify(next);
    if (now === signature) return;
    signature = now;
    projects = next;
    if (ctx.active())
      keepFocus(collection, "tr[data-project]", "project", render);
  };
  const drawSegments = () =>
    segmented.replaceChildren(
      ...statusOptions.map(([value, label]) =>
        h(
          "button",
          {
            type: "button",
            "aria-pressed": String(statusFilter === value),
            onclick: () => {
              statusFilter = value;
              render();
            },
          },
          label,
          h(
            "span",
            { class: "count" },
            value
              ? projects.filter((p) => projectStatus(p).id === value).length
              : projects.length,
          ),
        ),
      ),
    );
  const render = () => {
    drawSegments();
    const query = search.value.trim().toLocaleLowerCase("th");
    const items = projects.filter(
      (p) =>
        (!org.value || (p.organizationId || p.organization) === org.value) &&
        (!statusFilter || projectStatus(p).id === statusFilter) &&
        [p.name, p.slug, p.organization, p.repository]
          .join(" ")
          .toLocaleLowerCase("th")
          .includes(query),
    );
    count.textContent = `${items.length} / ${projects.length} applications`;
    if (!items.length) {
      collection.replaceChildren(
        empty(
          "ไม่พบแอปที่ตรงกับรายการ",
          "ลองเปลี่ยนตัวกรอง หรือเชื่อม repository เพื่อเริ่มต้น",
          ctx.can("project.create") &&
            link("New application", "/projects/new", "btn primary"),
        ),
      );
      return;
    }
    const grid = table(
      ["Application", "Pipeline", "Status", "Active release", ""],
      items.map((p) => {
        const active = p.deployment?.releases?.find(
          (r) => r.id === p.deployment.activeReleaseId,
        );
        return [
          h(
            "div",
            { class: "app-identity" },
            runtimeMark(p),
            h(
              "div",
              {},
              h(
                "button",
                {
                  class: "text-button app-name",
                  type: "button",
                  onclick: () => projectWorkspace(ctx, p),
                },
                p.name,
              ),
              h("small", {}, p.organization || "Default", " · ", runtimeName(p)),
            ),
          ),
          h(
            "div",
            { class: "pipeline-cell" },
            track(pipelineStages(p)),
            h(
              "small",
              { class: "mono" },
              p.branch || "main",
              p.serviceType === "worker"
                ? " · worker"
                : ` · :${p.port || "auto"}`,
            ),
          ),
          h(
            "div",
            {},
            statusBadge(p),
            h("small", {}, p.domains?.hosts?.[0] || "ไม่มีโดเมน"),
          ),
          h(
            "div",
            {},
            h("code", { class: "sha" }, short(active?.revision || p.sync?.revision)),
            hasNewerSyncedRevision({
              syncStatus: p.sync?.status,
              syncRevision: p.sync?.revision,
              deployedRevision: active?.revision,
            }) && h("small", {}, badge("New commit", "pending")),
          ),
          chevron(),
        ];
      }),
      "Applications",
    );
    grid.classList.add("mobile-cards");
    grid.querySelectorAll("tbody tr").forEach((row, i) => {
      row.dataset.project = items[i].slug;
      row.id = items[i].slug;
      row.children[3].dataset.hideMobile = "true";
      row.children[4].dataset.hideMobile = "true";
      rowOpens(row, () => projectWorkspace(ctx, items[i]));
    });
    collection.replaceChildren(grid);
  };
  search.addEventListener("input", render);
  org.addEventListener("change", render);
  root.append(
    h(
      "div",
      { class: "collection-tools" },
      h("div", { class: "filters" }, search, segmented, org),
      count,
    ),
    collection,
  );
  render();
  const changed = async () => {
    try {
      update(
        (await ctx.api.get("/api/projects", { force: true })).projects || [],
      );
    } catch (e) {
      if (ctx.active()) ctx.toast(e.message, true);
    }
  };
  document.addEventListener("strckro:projects-changed", changed);
  ctx.onDispose(() =>
    document.removeEventListener("strckro:projects-changed", changed),
  );
  const slug = decodeURIComponent(ctx.route.url.hash.slice(1));
  if (slug) {
    const p = projects.find((p) => p.slug === slug);
    if (p) void projectWorkspace(ctx, p);
  }
  ctx.poll(
    async () => {
      update((await ctx.api.get("/api/projects", { force: true })).projects);
    },
    () =>
      projects.some((p) => projectStatus(p).id === "building") ? 4000 : 20000,
  );
}
async function deployments(ctx) {
  const root = ctx.root;
  root.replaceChildren(
    heading(
      "Deployments",
      "จาก source ถึง serving — ทุก release ในพื้นที่เดียว",
      link("เลือกแอปเพื่อ deploy", "/projects", "btn"),
    ),
  );
  let data = await ctx.api.get("/api/deployments");
  if (!ctx.active()) return;
  const stats = h("div", { class: "stat-strip" });
  const status = h(
    "select",
    { "aria-label": "สถานะ deployment" },
    ...["", "running", "succeeded", "failed"].map((v, i) =>
      h(
        "option",
        { value: v },
        ["ทุกสถานะ", "In progress", "Succeeded", "Failed"][i],
      ),
    ),
  );
  const project = h(
    "select",
    { "aria-label": "โปรเจค" },
    h("option", { value: "" }, "ทุกโปรเจค"),
    ...(data.projects || []).map((p) =>
      h("option", { value: p.slug }, p.name || p.slug),
    ),
  );
  const count = h("span", { class: "collection-count" });
  const list = h("div", { class: "panel" });
  let signature = JSON.stringify(data);
  const render = () => {
    stats.replaceChildren(
      ...[
        ["total", "All releases", "ink"],
        ["active", "In progress", "busy"],
        ["succeeded", "Succeeded", "ok"],
        ["failed", "Failed", "bad"],
      ].map(([key, title, tone]) =>
        h(
          "div",
          { class: "stat", "data-tone": tone },
          h("span", {}, title),
          h("strong", {}, data.summary[key] || 0),
          h(
            "small",
            {},
            key === "active" ? "คิวที่กำลังทำงาน" : "รายการที่คุณเข้าถึงได้",
          ),
        ),
      ),
    );
    const rows = (data.deployments || []).filter(
      (r) =>
        (!project.value || r.projectSlug === project.value) &&
        (!status.value ||
          (status.value === "running"
            ? ["queued", "running", "building", "deploying"].includes(r.status)
            : r.status === status.value)),
    );
    count.textContent = `${rows.length} releases · อัปเดต ${when(data.updatedAt)}`;
    if (!rows.length) {
      list.replaceChildren(
        empty(
          "ยังไม่มี release ในรายการนี้",
          "เชื่อม repository แล้วเริ่ม deploy หรือเปลี่ยนตัวกรอง",
          link("Applications", "/projects", "btn primary"),
        ),
      );
      return;
    }
    const grid = table(
      ["Application", "Commit / branch", "Status", "Created", ""],
      rows.map((r) => [
        h(
          "div",
          {},
          link(
            r.projectName || r.projectSlug,
            `/projects#${encodeURIComponent(r.projectSlug)}`,
            "app-name",
          ),
          h("small", {}, r.runtime || "application"),
        ),
        h(
          "div",
          {},
          h("code", { class: "sha" }, short(r.revision || r.releaseId || r.id)),
          h("small", { class: "mono" }, r.branch || "—"),
        ),
        releaseBadge(r),
        h("small", {}, when(r.createdAt)),
        chevron(),
      ]),
      "Deployment activity",
    );
    grid.classList.add("mobile-cards");
    grid.querySelectorAll("tbody tr").forEach((r, i) => {
      r.dataset.deployment = rows[i].id;
      r.children[3].dataset.hideMobile = "true";
      r.children[4].dataset.hideMobile = "true";
      rowOpens(r, () =>
        ctx.go(`/projects#${encodeURIComponent(rows[i].projectSlug)}`),
      );
    });
    list.replaceChildren(grid);
  };
  project.onchange = status.onchange = render;
  root.append(
    stats,
    h(
      "div",
      { class: "collection-tools" },
      h("div", { class: "filters" }, project, status),
      count,
    ),
    list,
  );
  render();
  ctx.poll(
    async () => {
      const next = await ctx.api.get("/api/deployments", { force: true });
      const now = JSON.stringify(next);
      if (now === signature) return;
      signature = now;
      data = next;
      if (ctx.active()) keepFocus(list, "tr[data-deployment]", "deployment", render);
    },
    () => (data.summary.active ? 4000 : 20000),
  );
}
async function activity(ctx) {
  const root = ctx.root;
  root.replaceChildren(
    heading("Activity", "บันทึกการดำเนินการ ระบุผู้ใช้ โปรเจค และผลลัพธ์"),
  );
  const data = await ctx.api.get("/api/audit");
  if (!ctx.active()) return;
  const search = h("input", {
    type: "search",
    placeholder: "ค้นหาเหตุการณ์ ผู้ใช้ หรือโปรเจค…",
    "aria-label": "ค้นหา Activity",
  });
  const count = h("span", { class: "collection-count" });
  const list = h("div", { class: "panel" });
  const render = () => {
    const q = search.value.trim().toLowerCase();
    const rows = (data.events || []).filter((e) =>
      [e.action, e.actor, e.target, e.detail]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
    count.textContent = `${rows.length} events`;
    list.replaceChildren(
      rows.length
        ? table(
            ["Event", "Details", "Actor", "Time"],
            rows.map((e) => [
              h(
                "div",
                {},
                h("strong", {}, e.action),
                h("small", {}, e.target || "System"),
              ),
              h(
                "div",
                {},
                badge(
                  e.outcome || "recorded",
                  e.outcome === "success"
                    ? "success"
                    : ["failed", "error"].includes(e.outcome)
                      ? "danger"
                      : "neutral",
                ),
                h("small", {}, e.detail),
              ),
              h("code", {}, e.actor || "system"),
              h("small", {}, when(e.at)),
            ]),
            "Audit activity",
          )
        : empty("ไม่พบเหตุการณ์", "ลองใช้คำค้นหาอื่น"),
    );
  };
  search.oninput = render;
  root.append(
    h(
      "div",
      { class: "collection-tools" },
      h("div", { class: "filters" }, search),
      count,
    ),
    list,
  );
  render();
}
async function overview(ctx) {
  const root = ctx.root;
  root.replaceChildren(
    heading(
      "System at a glance",
      "พื้นที่ทำงานสำหรับแอปและโครงสร้างพื้นฐานที่คุณควบคุมเอง",
    ),
  );
  const [projectData, doctor, feed] = await Promise.all([
    ctx.api.get("/api/projects"),
    ctx.api.get("/api/doctor"),
    ctx.api.get("/api/deployments"),
  ]);
  if (!ctx.active()) return;
  const projects = projectData.projects || [];
  const counts = { ready: 0, down: 0, pause: 0, building: 0 };
  projects.forEach((p) => counts[projectStatus(p).id]++);
  root.append(
    h(
      "div",
      { class: "stat-strip" },
      ...[
        ["Applications", projects.length, "/projects", "ink"],
        ["Live", counts.ready, "/projects?status=ready", "ok"],
        ["Needs attention", counts.down, "/projects?status=down", "bad"],
        ["In progress", counts.building, "/projects?status=building", "busy"],
      ].map(([title, n, url, tone]) =>
        link(
          [
            h("span", {}, title),
            h("strong", {}, n),
            h("small", {}, "ดูรายการ ", icon("arrow")),
          ],
          url,
          "stat",
          { "data-tone": tone },
        ),
      ),
    ),
  );
  const appPanel = panel(
    "Applications",
    "ดูสถานะที่สำคัญ แล้วเปิด workspace ของแอปเพื่อดำเนินการ",
  );
  if (projects.length) {
    const grid = table(
      ["Application", "Pipeline", "Status", ""],
      projects.slice(0, 7).map((p) => [
        h(
          "div",
          { class: "app-identity" },
          runtimeMark(p),
          h(
            "div",
            {},
            h(
              "button",
              {
                class: "text-button",
                type: "button",
                onclick: () => projectWorkspace(ctx, p),
              },
              p.name,
            ),
            h("small", {}, runtimeName(p)),
          ),
        ),
        track(pipelineStages(p)),
        statusBadge(p),
        chevron(),
      ]),
    );
    grid.classList.add("mobile-cards");
    grid.querySelectorAll("tbody tr").forEach((row, i) => {
      row.children[3].dataset.hideMobile = "true";
      rowOpens(row, () => projectWorkspace(ctx, projects[i]));
    });
    appPanel.append(grid);
  } else
    appPanel.append(
      empty(
        "เริ่มต้นด้วยแอปแรก",
        "เชื่อม repository แล้วสร้าง release",
        link("New application", "/projects/new", "btn primary"),
      ),
    );
  const host = doctor.host || {};
  const cpu = Number(host.cpuPercent) || 0;
  const meters = [
    ["CPU", `${cpu.toFixed(1)}%`, "", cpu],
    [
      "Memory",
      bytes(host.memoryUsedBytes),
      host.memoryBytes ? `/ ${bytes(host.memoryBytes)}` : "",
      host.memoryBytes ? (100 * host.memoryUsedBytes) / host.memoryBytes : 0,
    ],
    [
      "Disk",
      bytes(host.diskUsedBytes),
      host.diskTotalBytes ? `/ ${bytes(host.diskTotalBytes)}` : "",
      host.diskTotalBytes ? (100 * host.diskUsedBytes) / host.diskTotalBytes : 0,
    ],
  ];
  const hosted = ctx.state.session.mode === "host";
  const resources = h(
    "section",
    { class: "panel" },
    h(
      "header",
      { class: "panel-head" },
      h("div", {}, h("h2", {}, "Host health"), h("p", {}, "เครื่องที่คุณควบคุมอยู่")),
      badge(hosted ? "Host" : "Sandbox", hosted ? "success" : "neutral"),
    ),
    h(
      "div",
      { class: "host-title" },
      h("strong", {}, host.hostname || "Host"),
      h(
        "small",
        {},
        `${host.platform || "—"} · Node ${doctor.portalNodeVersion || "—"}`,
      ),
    ),
    h(
      "div",
      { class: "metric-list" },
      ...meters.map(([name, value, total, percent]) =>
        h(
          "div",
          { class: "metric" },
          h(
            "div",
            { class: "metric-head" },
            h("span", {}, name),
            h("strong", {}, value, total && h("small", {}, total)),
          ),
          gauge(percent, `${name} ${Math.round(percent)}%`),
        ),
      ),
    ),
    h(
      "div",
      { class: "host-foot" },
      h("small", {}, "ค่าจากเครื่องโดยตรง"),
      link("จัดการ host →", "/setup", "btn ghost small"),
    ),
  );
  const releases = panel(
    "Recent releases",
    "ประวัติล่าสุดจากแอปที่คุณเข้าถึงได้",
  );
  releases
    .querySelector("header")
    .append(link("ดูทั้งหมด →", "/deployments", "btn ghost small"));
  releases.append(
    (feed.deployments || []).length
      ? h(
          "ol",
          { class: "timeline" },
          ...(feed.deployments || []).slice(0, 5).map((r) =>
            h(
              "li",
              { class: `${releaseTone(r)}${r.current ? " live" : ""}` },
              link(
                [
                  h(
                    "div",
                    {},
                    h("strong", {}, r.projectName),
                    h(
                      "small",
                      { class: "mono" },
                      short(r.revision || r.id),
                      " · ",
                      r.branch,
                    ),
                  ),
                  h(
                    "div",
                    { class: "actions" },
                    releaseBadge(r),
                    h("small", {}, when(r.createdAt)),
                  ),
                ],
                "/projects#" + encodeURIComponent(r.projectSlug),
              ),
            ),
          ),
        )
      : empty(
          "Your first release starts here.",
          "ประวัติจะปรากฏเมื่อคุณเริ่ม deploy",
        ),
  );
  const history = panel("Resource history", "CPU และ memory ตามช่วงเวลา");
  const chart = h("div", { class: "panel-body chart" });
  const controls = h("div", { class: "actions" });
  history.querySelector("header").append(controls);
  history.append(chart);
  root.append(
    h(
      "div",
      { class: "stack" },
      h(
        "div",
        { class: "split" },
        h("div", { class: "stack" }, appPanel, releases),
        h(
          "div",
          { class: "stack" },
          resources,
          panel(
            "Workspace readiness",
            "เตรียมระบบก่อนปล่อย release",
            h(
              "div",
              { class: "compact-list" },
              ...[
                [
                  "Git identity",
                  doctor.git?.identity ? "Configured" : "ดูการตั้งค่า",
                  "/setup",
                ],
                [
                  "Host tools",
                  `${(doctor.tools || []).filter((t) => t.status === "Installed").length} installed`,
                  "/setup",
                ],
                ["CLI & AI", "Connect your tools", "/settings/account"],
              ].map(([name, detail, url]) =>
                link(
                  [
                    h("div", {}, h("strong", {}, name), h("small", {}, detail)),
                    icon("arrow"),
                  ],
                  url,
                  "list-row",
                ),
              ),
            ),
          ),
        ),
      ),
      history,
    ),
  );
  const loadHistory = async (days) => {
    controls
      .querySelectorAll("button")
      .forEach((b) =>
        b.classList.toggle("primary", Number(b.dataset.range) === days),
      );
    try {
      const data = await ctx.api.get("/api/metrics?range=" + days);
      if (!ctx.active()) return;
      chart.replaceChildren(resourceChart(data.samples || []));
    } catch (e) {
      chart.replaceChildren(h("p", { class: "muted" }, e.message));
    }
  };
  for (const days of [1, 7, 30]) {
    const b = button(days + "d", () => loadHistory(days), "small");
    b.dataset.range = days;
    controls.append(b);
  }
  void loadHistory(7);
}
function resourceChart(samples) {
  if (samples.length < 2)
    return empty(
      "กำลังสะสมข้อมูลทรัพยากร",
      "กราฟจะแสดงเมื่อมีข้อมูลตั้งแต่สองช่วงเวลา ค่าปัจจุบันดูได้ที่ Host health",
    );
  const left = 36,
    right = 996,
    top = 10,
    bottom = 178;
  const x = (i) => left + (i * (right - left)) / Math.max(1, samples.length - 1);
  const y = (v) =>
    bottom - (Math.min(100, Math.max(0, Number(v) || 0)) * (bottom - top)) / 100;
  const chart = svg("svg", {
    viewBox: "0 0 1000 200",
    role: "img",
    "aria-label": "CPU และ memory history",
    preserveAspectRatio: "none",
  });
  for (const tick of [0, 25, 50, 75, 100]) {
    chart.append(
      svg("line", { class: "grid", x1: left, x2: right, y1: y(tick), y2: y(tick) }),
      svg("text", { class: "axis", x: 0, y: y(tick) + 3 }, `${tick}%`),
    );
  }
  const defs = svg("defs");
  const fade = svg(
    "linearGradient",
    { id: "cpu-fade", x1: 0, y1: 0, x2: 0, y2: 1 },
    svg("stop", { offset: "0%", "stop-color": "var(--ok)", "stop-opacity": 0.28 }),
    svg("stop", { offset: "100%", "stop-color": "var(--ok)", "stop-opacity": 0 }),
  );
  defs.append(fade);
  chart.append(defs);
  const cpuPoints = samples.map((s, i) => `${x(i)},${y(s.cpuPercent)}`);
  chart.append(
    svg("polygon", {
      points: `${left},${bottom} ${cpuPoints.join(" ")} ${right},${bottom}`,
      fill: "url(#cpu-fade)",
    }),
  );
  for (const [key, tone] of [
    ["memoryPercent", "var(--busy)"],
    ["cpuPercent", "var(--ok)"],
  ]) {
    chart.append(
      svg("polyline", {
        fill: "none",
        stroke: tone,
        "stroke-width": 2,
        "stroke-linejoin": "round",
        "stroke-linecap": "round",
        "vector-effect": "non-scaling-stroke",
        points: samples.map((s, i) => `${x(i)},${y(s[key])}`).join(" "),
      }),
    );
  }
  const dot = (tone) => {
    const mark = h("i");
    mark.style.background = tone;
    return mark;
  };
  return h(
    "div",
    {},
    chart,
    h(
      "div",
      { class: "chart-legend" },
      h("span", {}, dot("var(--ok)"), "CPU"),
      h("span", {}, dot("var(--busy)"), "Memory"),
      h("span", {}, "เก็บตามข้อมูลจาก host"),
    ),
  );
}
