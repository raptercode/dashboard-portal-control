import { domainsPane } from "./domains.js";
import { createPoller } from "../core/polling.js";
import {
  h,
  icon,
  link,
  button,
  submit,
  field,
  form,
  check,
  badge,
  panel,
  empty,
  track,
  runtimeMark,
  short,
  when,
  skeleton,
} from "../core/dom.js";
import {
  projectStatus,
  pipelineStages,
  progressSummary,
  rollbackConfirmation,
  restartConfirmation,
  runtimeName,
  syncPayload,
  isWorker,
} from "../core/model.js";
import { secretReveal } from "../core/overlays.js";
import { logoName } from "../core/runtimes.js";
import {
  parseEnvironmentDocument,
  updateEnvironmentDocument,
  mergeEnvironmentDocument,
  ENVIRONMENT_MAX_BYTES,
} from "../environment-editor.js";
const pathFor = (p) => "/api/projects/" + encodeURIComponent(p.slug);
export async function openProject(ctx, initial, initialTab = "deploy") {
  const existing = document.querySelector(
    `dialog.sheet[data-project="${CSS.escape(initial.slug)}"][open]`,
  );
  if (existing) {
    existing.focus();
    return;
  }
  let project = initial,
    tabVersion = 0;
  const d = ctx.dialog(initial.name, { sheet: true });
  d.node.dataset.project = initial.slug;
  // The track and status stay in the header, whichever tab is open.
  const paintMeta = () => {
    const status = projectStatus(project);
    d.meta.replaceChildren(
      h(
        "div",
        { class: "track-block" },
        track(pipelineStages(project), { large: true }),
        h(
          "div",
          { class: "track-legend" },
          h("span", {}, "Source"),
          h("span", {}, "Build"),
          h("span", {}, "Serving"),
        ),
      ),
      h(
        "div",
        { class: "meta-id" },
        runtimeMark(logoName(project)),
        h(
          "div",
          { class: "meta-stack" },
          badge(status.phase || status.label, status.tone),
          h(
            "small",
            { class: "mono" },
            project.slug,
            " · ",
            runtimeName(project),
          ),
        ),
      ),
    );
  };
  paintMeta();
  const panes = h("div", { class: "dialog-pane", role: "tabpanel" });
  panes.id = `application-pane-${initial.slug}`;
  const tabs = h("nav", {
    class: "tabs",
    role: "tablist",
    "aria-label": "Application sections",
  });
  let dirty = false,
    secretCleanup = () => {};
  const validTabs = [
    ["deploy", "Deploy", ctx.can("project.view", project)],
    [
      "environment",
      "Environment",
      ctx.can("env.read", project) || ctx.can("env.write", project),
    ],
    [
      "domains",
      "Domains",
      ctx.can("domains.manage", project) && !isWorker(project),
    ],
    ["releases", "Releases", ctx.can("logs.read", project)],
    ["automation", "Automation", ctx.can("project.configure", project)],
    ["notifications", "Notifications", ctx.master()],
  ].filter((x) => x[2]);
  const reloadProject = async () => {
    const list = await ctx.api.get("/api/projects", { force: true });
    const latest = list.projects.find((p) => p.slug === project.slug);
    if (latest) project = latest;
    if (d.node.isConnected) paintMeta();
    listener?.(project);
    return project;
  };
  // While something runs for this application, keep reading it. The header,
  // the open tab and the lists follow; logs are only opened when asked for.
  let listener = null,
    watching = false,
    announce = false,
    watchTimer = 0;
  const running = () => projectStatus(project).id === "building";
  const watch = (announceEnd = false) => {
    announce ||= announceEnd;
    if (watching) return;
    watching = true;
    const tick = async () => {
      if (!d.node.open) {
        watching = false;
        return;
      }
      if (!document.hidden) await reloadProject().catch(() => {});
      if (d.node.open && running()) {
        watchTimer = setTimeout(tick, 2000);
        return;
      }
      watching = false;
      document.dispatchEvent(new CustomEvent("strckro:projects-changed"));
      if (announce && d.node.open) {
        announce = false;
        const summary = progressSummary(project);
        if (summary) ctx.toast(summary.label, summary.failed);
      }
    };
    watchTimer = setTimeout(tick, 1200);
  };
  const hooks = {
    watch,
    listen: (fn) => {
      listener = fn;
    },
  };
  const select = async (id, force = false) => {
    if (
      !force &&
      dirty &&
      !(await ctx.confirm(
        "ทิ้งการแก้ไข ENV?",
        "ค่าที่ยังไม่บันทึกจะหายไป",
        "ทิ้งการแก้ไข",
      ))
    )
      return;
    dirty = false;
    d.dirty(false);
    secretCleanup();
    secretCleanup = () => {};
    listener = null;
    const version = ++tabVersion;
    tabs.querySelectorAll("button").forEach((b) => {
      b.classList.toggle("active", b.dataset.tab === id);
      b.setAttribute("aria-selected", String(b.dataset.tab === id));
      b.tabIndex = b.dataset.tab === id ? 0 : -1;
    });
    panes.setAttribute(
      "aria-labelledby",
      `application-tab-${initial.slug}-${id}`,
    );
    skeleton(panes);
    try {
      const body = h("div", { class: "stack" });
      const active = () => d.node.open && version === tabVersion;
      if (id === "deploy")
        await deployPane(
          ctx,
          project,
          body,
          () => select("environment"),
          reloadProject,
          hooks,
        );
      if (id === "environment")
        secretCleanup = await environmentPane(ctx, project, body, (value) => {
          dirty = value;
          d.dirty(value);
        });
      if (id === "domains")
        await domainsPane(ctx, project, body, {
          reload: reloadProject,
          isOpen: active,
        });
      if (id === "releases")
        releasePane(ctx, project, body, {
          current: () => project,
          reload: reloadProject,
          refresh: () => select("releases", true),
          watch,
        });
      if (id === "automation")
        await automationPane(ctx, project, body, () =>
          select("automation", true),
        );
      if (id === "notifications")
        await hooksPane(ctx, project, body, () =>
          select("notifications", true),
        );
      if (active()) panes.replaceChildren(body);
    } catch (e) {
      if (d.node.open && version === tabVersion)
        panes.replaceChildren(
          h("p", { class: "error", role: "alert" }, e.message),
          button("ลองอีกครั้ง", () => select(id, true)),
        );
    }
  };
  for (const [id, label] of validTabs) {
    const b = button(label, () => select(id), "ghost");
    b.dataset.tab = id;
    b.id = `application-tab-${initial.slug}-${id}`;
    b.setAttribute("role", "tab");
    b.setAttribute("aria-controls", panes.id);
    tabs.append(b);
  }
  tabs.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const choices = [...tabs.querySelectorAll("button")];
    const current = choices.indexOf(document.activeElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? choices.length - 1
          : (current + (event.key === "ArrowRight" ? 1 : choices.length - 1)) %
            choices.length;
    choices[next]?.focus();
    choices[next]?.click();
  });
  d.body.append(tabs, panes);
  d.onClosed = () => {
    secretCleanup();
    clearTimeout(watchTimer);
    dirty = false;
  };
  d.actions.append(
    ctx.can("project.configure", project) &&
      link(
        "แก้ไขแอป",
        `/projects/${encodeURIComponent(project.slug)}/edit`,
        "btn secondary",
      ),
    ctx.can("logs.read", project) &&
      link(
        "Runtime logs",
        `/projects/${encodeURIComponent(project.slug)}/logs`,
        "btn secondary",
      ),
    ctx.master() &&
      button(
        "ลบแอป",
        async () => {
          if (
            !(await ctx.confirm(
              `ลบ ${project.name}?`,
              "หยุด service ลบ releases และ ENV ถอดโดเมนและ webhook การดำเนินการนี้ย้อนกลับไม่ได้",
              "ลบถาวร",
              project.name,
            ))
          )
            return;
          await ctx.api.delete(pathFor(project));
          await d.close(true);
          ctx.toast("ลบแอปแล้ว");
          await ctx.reload();
        },
        "danger",
      ),
  );
  void select(
    validTabs.some((x) => x[0] === initialTab) ? initialTab : validTabs[0]?.[0],
    true,
  );
  if (running()) watch();
  return d;
}
async function deployPane(ctx, p, root, environment, reloadProject, hooks) {
  const config = await ctx.api.get(pathFor(p) + "/deploy-configuration", {
    ttl: 0,
  });
  const cfg = config.configuration || {};
  const progress = h("div", { class: "progress-line", role: "status" });
  const actions = [];
  const busy = () => projectStatus(p).id === "building";
  const guard = () => {
    if (busy())
      throw new Error("มีงานของแอปนี้กำลังทำอยู่ รอให้เสร็จก่อน");
  };
  // After anything that changes the application: read it again, tell the lists,
  // and keep watching only when a deployment may have started.
  const settle = async (watch) => {
    await reloadProject().catch(() => {});
    document.dispatchEvent(new CustomEvent("strckro:projects-changed"));
    if (watch !== undefined) hooks.watch(watch);
  };
  const paint = (latest) => {
    Object.assign(p, latest);
    const summary = progressSummary(p);
    progress.hidden = !summary;
    progress.className =
      "progress-line" +
      (summary?.active ? " active" : "") +
      (summary?.failed ? " failed" : "");
    progress.replaceChildren(
      ...(summary
        ? [
            h("i", { class: "led" }),
            h("strong", {}, summary.label),
            summary.active && h("small", {}, "อัปเดตอัตโนมัติ"),
            ctx.can("logs.read", p) &&
              summary.jobId &&
              button(
                summary.recovered || summary.rollingBack
                  ? "ดูงาน deploy ที่ล้มเหลว"
                  : "ดูรายละเอียด",
                () => openJobLog(ctx, summary.jobId, p.name),
                "ghost small",
              ),
          ]
        : []),
    );
    // The button helper re-enables a button when its handler ends; this runs after.
    setTimeout(() => {
      for (const control of actions) {
        control.disabled = busy();
        control.title = busy() ? "มีงานกำลังทำอยู่" : "";
      }
    }, 0);
  };
  hooks.listen(paint);
  root.append(
    progress,
    h(
      "dl",
      { class: "key-values" },
      ...Object.entries({
        Source: p.repository,
        Branch: p.branch,
        Runtime: cfg.runtime,
        Dependencies: cfg.packageManager,
        Lockfile: cfg.lockfile?.name,
        Build: cfg.buildScript,
        Start: cfg.startScript,
        "Active release": short(p.deployment?.activeReleaseId),
      }).flatMap(([key, value]) => [
        h("dt", {}, key),
        h("dd", {}, value || "—"),
      ]),
    ),
  );
  const note = ctx.can("env.read", p)
    ? `${p.environment?.keys?.length || 0} environment keys ที่บันทึกไว้`
    : "ใช้ environment ที่บันทึกไว้บน server";
  root.append(
    h(
      "div",
      { class: "notice" },
      note,
      " · ENV ใหม่มีผลเมื่อ deploy ใหม่เท่านั้น",
    ),
    h(
      "div",
      { class: "actions" },
      (ctx.can("env.read", p) || ctx.can("env.write", p)) &&
        button("จัดการ Environment", environment),
    ),
  );
  if (ctx.can("deploy.start", p)) {
    const sync = button("Sync latest", async () => {
      guard();
      const result = await ctx.api.post("/api/projects/sync", {
        ...syncPayload(p),
        retryDeployment: true,
      });
      ctx.toast(
        result.sync?.detail ||
          result.project?.sync?.detail ||
          "Sync source แล้ว",
      );
      await settle(false);
    });
    const create = button(
      "Create release",
      async () => {
        guard();
        if (p.sync?.status !== "synced")
          throw new Error("Sync source ให้สำเร็จก่อน deploy");
        if (
          !isWorker(p) &&
          !p.environment?.keys?.length &&
          ctx.can("env.read", p)
        )
          throw new Error(
            "Web ต้องมี ENV อย่างน้อยหนึ่งค่า เปิด Environment แล้วบันทึกก่อน",
          );
        if (
          !(await ctx.confirm(
            "สร้าง release ใหม่?",
            `${p.name} · ${short(p.sync?.revision)} ระบบจะ build แยก ตรวจ health ก่อนเปลี่ยน release ที่กำลังทำงาน`,
            "Create release",
          ))
        )
          return;
        const result = await ctx.api.post(pathFor(p) + "/deploy");
        ctx.toast(
          result.activation === "queued" ? "จัดคิว deploy แล้ว" : "สร้าง release แล้ว",
        );
        await settle(true);
      },
      "primary",
    );
    const restart =
      p.runtime !== "docker-compose" &&
      p.deployment?.activeReleaseId &&
      button("Restart app", async () => {
        guard();
        if (
          !(await ctx.confirm(
            `Restart ${p.name}?`,
            restartConfirmation(p),
            "Restart app",
          ))
        )
          return;
        try {
          await ctx.api.post(pathFor(p) + "/restart", {
            confirm: true,
            releaseId: p.deployment.activeReleaseId,
          });
          ctx.toast("Restart สำเร็จ · ใช้ release และ ENV เดิม");
        } finally {
          // The application is read again even when the request failed.
          await settle();
        }
      });
    actions.push(sync, create);
    if (restart) actions.push(restart);
    root.append(
      h("div", { class: "form-actions" }, sync, create, restart),
    );
  }
  paint(p);
}
async function openJobLog(ctx, jobId, name) {
  const { job } = await ctx.api.get("/api/jobs/" + encodeURIComponent(jobId), {
    force: true,
  });
  trackJob(ctx, job, name);
}
async function environmentPane(ctx, p, root, setDirty) {
  const base = pathFor(p),
    mayRead = ctx.can("env.read", p),
    mayWrite = ctx.can("env.write", p);
  const meta = await ctx.api.get(base + "/environment/metadata", { ttl: 0 });
  let revision = meta.environment.revision;
  if (!mayRead) {
    const keys = meta.environment.keys || [];
    root.append(
      h(
        "div",
        { class: "notice" },
        "บัญชีนี้อ่านค่า ENV ไม่ได้ การบันทึกด้านล่างจะอัปเดตเฉพาะ key ที่ระบุ ค่าอื่นยังคงอยู่",
      ),
      h("small", {}, "Keys: ", keys.join(", ") || "ยังไม่มี ENV"),
    );
    const f = form(
      async (values) => {
        await ctx.api.patch(base + "/environment", {
          revision,
          set: { [values.key]: values.value },
          unset: [],
        });
        revision = (
          await ctx.api.get(base + "/environment/metadata", { ttl: 0 })
        ).environment.revision;
        setDirty(false);
        ctx.toast("บันทึก ENV แล้ว");
        f.reset();
      },
      field("ชื่อ key", "key", { required: true, pattern: "[A-Z_][A-Z0-9_]*" }),
      field("ค่า (เว้นว่างเพื่อบันทึกค่าว่าง)", "value", {
        type: "password",
        autocomplete: "new-password",
      }),
      mayWrite && submit("บันทึก key"),
    );
    if (mayWrite) root.append(f);
    return () => {
      f.querySelectorAll("input").forEach((i) => (i.value = ""));
    };
  }
  const data = await ctx.api.get(base + "/environment", { ttl: 0 });
  let saved = data.environment?.content || "",
    mode = "file",
    documentText = saved;
  const editor = field(".env document", "environment", {
    type: "textarea",
    rows: 13,
    value: saved,
    spellcheck: false,
    autocomplete: "off",
    readOnly: !mayWrite,
  });
  editor.control.classList.add("code");
  const rows = h("div", { class: "env-rows" });
  const filter = h("input", {
    type: "search",
    placeholder: "กรองชื่อ key…",
    "aria-label": "กรอง ENV key",
  });
  const section = h("div");
  const status = h(
    "small",
    { role: "status" },
    "ค่าที่บันทึกจะใช้กับ release ถัดไป",
  );
  const list = [];
  const head = h(
    "div",
    { class: "env-head", "aria-hidden": "true" },
    h("span", {}, "KEY"),
    h("span", {}, "VALUE"),
    h("span"),
  );
  const hint = h(
    "p",
    { class: "muted env-empty" },
    mayWrite
      ? "ยังไม่มี key กด “เพิ่ม key” เพื่อเริ่ม"
      : "ยังไม่มี ENV ที่บันทึกไว้",
  );
  // The column header, the empty hint and the filter follow how many rows exist.
  const sync = () => {
    head.hidden = !list.length;
    hint.hidden = !!list.length;
    filter.hidden = list.length <= 6;
    if (filter.hidden && filter.value) {
      filter.value = "";
      list.forEach((x) => (x.row.hidden = false));
    }
  };
  const collect = () => {
    if (mode === "file")
      return parseEnvironmentDocument(editor.control.value).content;
    const variables = list
      .map((row) => ({ key: row.key.value.trim(), value: row.value.value }))
      .filter((v) => v.key || v.value);
    return updateEnvironmentDocument(documentText, variables);
  };
  const changed = () => {
    setDirty(true);
    status.textContent = "มีการแก้ไขที่ยังไม่บันทึก";
  };
  editor.control.oninput = changed;
  const addRow = (variable = { key: "", value: "" }) => {
    const key = h("input", {
      "aria-label": "ENV key",
      value: variable.key,
      placeholder: "KEY",
      readOnly: !mayWrite,
      spellcheck: false,
    });
    const value = h("input", {
      "aria-label": "ENV value",
      value: variable.value,
      placeholder: "Value",
      readOnly: !mayWrite,
      autocomplete: "off",
      spellcheck: false,
    });
    const row = h("div", { class: "env-row" }, key, value);
    const entry = { key, value, row };
    key.oninput = value.oninput = changed;
    const remove = button(
      icon("close"),
      () => {
        list.splice(list.indexOf(entry), 1);
        row.remove();
        sync();
        changed();
      },
      "icon",
      { "aria-label": "ลบ ENV key" },
    );
    if (mayWrite) row.append(remove);
    list.push(entry);
    rows.append(row);
    sync();
  };
  const setMode = (next) => {
    documentText = collect();
    mode = next;
    if (mode === "file") {
      editor.control.value = documentText;
      section.replaceChildren(editor);
    } else {
      list.length = 0;
      rows.replaceChildren();
      parseEnvironmentDocument(documentText).variables.forEach(addRow);
      // With nothing saved yet, start with a blank KEY / VALUE pair so the
      // fields are visible. It is ignored on save until something is typed.
      if (mayWrite && !list.length) addRow();
      section.replaceChildren(
        filter,
        head,
        rows,
        hint,
        mayWrite &&
          button(
            [icon("plus"), "เพิ่ม key"],
            () => {
              addRow();
              changed();
              list.at(-1).key.focus();
            },
            "small",
          ),
      );
      sync();
    }
    fileBtn.setAttribute("aria-pressed", String(mode === "file"));
    rowBtn.setAttribute("aria-pressed", String(mode === "rows"));
  };
  filter.oninput = () =>
    list.forEach((x) => {
      x.row.hidden = !x.key.value
        .toLowerCase()
        .includes(filter.value.toLowerCase());
    });
  const modeButton = (label, target, pressed) =>
    h(
      "button",
      {
        type: "button",
        "aria-pressed": String(pressed),
        onclick: () => setMode(target),
      },
      label,
    );
  const fileBtn = modeButton("ทั้งไฟล์ .env", "file", true);
  const rowBtn = modeButton("ทีละ key", "rows", false);
  const upload = h("input", {
    type: "file",
    hidden: true,
    accept: ".env,text/plain",
    "aria-label": "นำเข้า ENV",
  });
  upload.onchange = async () => {
    try {
      const file = upload.files?.[0];
      if (!file) return;
      if (file.size > ENVIRONMENT_MAX_BYTES)
        throw new Error("ไฟล์ ENV ต้องไม่เกิน 128 KB");
      documentText = mergeEnvironmentDocument(collect(), await file.text());
      mode = "file";
      editor.control.value = documentText;
      section.replaceChildren(editor);
      fileBtn.setAttribute("aria-pressed", "true");
      rowBtn.setAttribute("aria-pressed", "false");
      changed();
    } catch (e) {
      ctx.toast(e.message, true);
    } finally {
      upload.value = "";
    }
  };
  const save = button(
    "บันทึก ENV",
    async () => {
      const content = collect();
      const latest = await ctx.api.get(base + "/environment/metadata", {
        ttl: 0,
      });
      if (latest.environment.revision !== revision)
        throw new Error(
          "ENV ถูกแก้จากที่อื่น กรุณาปิดแล้วเปิด Environment ใหม่เพื่อไม่เขียนทับข้อมูล",
        );
      const result = await ctx.api.post(base + "/environment", {
        mode: "replace",
        content,
      });
      Object.assign(p, result.project);
      saved = content;
      documentText = content;
      revision = (await ctx.api.get(base + "/environment/metadata", { ttl: 0 }))
        .environment.revision;
      setDirty(false);
      status.textContent = "บันทึกแล้ว · ใช้เมื่อ deploy ครั้งถัดไป";
      ctx.toast("บันทึก ENV แล้ว");
    },
    "primary",
  );
  root.append(
    h(
      "p",
      { class: "muted" },
      "จัดการค่าแบบไฟล์หรือทีละ key ค่าว่าง KEY= และการลบ key รองรับตามที่ระบุ",
    ),
    h(
      "div",
      { class: "actions spread" },
      h(
        "div",
        { class: "segmented", role: "group", "aria-label": "รูปแบบการแก้ไข ENV" },
        fileBtn,
        rowBtn,
      ),
      mayWrite &&
        h(
          "div",
          { class: "actions" },
          button("นำเข้า .env", () => upload.click(), "small"),
          save,
        ),
    ),
    upload,
    status,
    section,
  );
  section.append(editor);
  return () => {
    saved = "";
    documentText = "";
    editor.control.value = "";
    list.forEach((x) => (x.value.value = ""));
  };
}
function releasePane(ctx, p, root, { current, reload, refresh, watch }) {
  const releases = p.deployment?.releases || [];
  if (!releases.length) {
    root.append(empty("ยังไม่มี release", "เริ่ม deploy เพื่อสร้างประวัติ"));
    return;
  }
  const live = releases.find((r) => r.id === p.deployment.activeReleaseId);
  root.append(
    ...releases.map((r) => {
      // Two releases can carry the same commit; say so, since it will not change.
      const sameCommit =
        r.id !== live?.id && !!r.revision && r.revision === live?.revision;
      return panel(
        `Release ${short(r.id)}`,
        `${short(r.revision)} · ${when(r.createdAt)}`,
        h(
          "div",
          { class: "panel-body stack" },
          h(
            "div",
            { class: "actions" },
            badge(
              r.id === live?.id ? "Live" : r.status,
              r.status === "failed"
                ? "danger"
                : r.id === live?.id
                  ? "success"
                  : "neutral",
            ),
            sameCommit &&
              h("small", {}, "commit เดียวกับ release ที่ใช้งานอยู่"),
            button("ดู log", () => {
              const d = ctx.dialog("Release log", { wide: true });
              d.body.append(
                h(
                  "pre",
                  { class: "code" },
                  (r.events || [])
                    .map(
                      (e) =>
                        `${when(e.at)} ${e.phase || e.status}: ${e.message || ""}`,
                    )
                    .join("\n") + (r.failureLog ? "\n\n" + r.failureLog : ""),
                ),
              );
            }),
            ctx.can("deploy.rollback", p) &&
              r.id !== live?.id &&
              r.status === "superseded" &&
              button(
                "Rollback",
                async () => {
                  const latest = current();
                  if (projectStatus(latest).id === "building")
                    throw new Error("มีงานของแอปนี้กำลังทำอยู่ รอให้เสร็จก่อน");
                  if (
                    !(await ctx.confirm(
                      "ย้อนกลับ release",
                      rollbackConfirmation(latest, r.id),
                      "ย้อนกลับ",
                    ))
                  )
                    return;
                  const result = await ctx.api.post(
                    pathFor(latest) + "/rollback",
                    { releaseId: r.id },
                  );
                  ctx.toast(
                    result.activation === "queued" ||
                      result.activation === "pending"
                      ? "จัดคิว rollback แล้ว"
                      : `ย้อนกลับสำเร็จ · release ${short(r.id)}`,
                  );
                  await reload().catch(() => {});
                  document.dispatchEvent(
                    new CustomEvent("strckro:projects-changed"),
                  );
                  watch(true);
                  await refresh();
                },
                "secondary",
              ),
          ),
        ),
      );
    }),
  );
}
async function automationPane(ctx, p, root, refresh) {
  const auto = p.autoSync || {};
  root.append(
    h(
      "p",
      { class: "muted" },
      "ตรวจ source ทุก 5 นาที หรือใช้ GitHub / Actions hook หลัง CI สำเร็จ",
    ),
    h(
      "div",
      { class: "actions" },
      badge(
        auto.enabled ? "Auto deploy enabled" : "Manual deployments",
        auto.enabled ? "success" : "neutral",
      ),
      button(
        auto.enabled ? "ปิด Auto deploy" : "เปิด Auto deploy",
        async () => {
          if (
            !(await ctx.confirm(
              "เปลี่ยน Auto deploy?",
              auto.enabled
                ? "หยุดตรวจและ deploy อัตโนมัติ"
                : "ระบบอาจ deploy commit ใหม่หลัง sync Git",
              "ยืนยัน",
            ))
          )
            return;
          await ctx.api.post(pathFor(p) + "/auto-sync", {
            enabled: !auto.enabled,
          });
          Object.assign(
            p,
            (await ctx.api.get("/api/projects", { force: true })).projects.find(
              (x) => x.slug === p.slug,
            ),
          );
          await refresh();
        },
        "primary",
      ),
    ),
  );
  for (const [kind, label] of [
    ["github-webhook", "GitHub push webhook"],
    ["actions-hook", "GitHub Actions hook"],
  ])
    root.append(
      panel(
        label,
        "Token/secret แสดงเฉพาะตอนสร้าง เก็บใน secret manager",
        h(
          "div",
          { class: "panel-body actions" },
          button("สร้าง / หมุน secret", async () => {
            if (
              !(await ctx.confirm(
                "สร้าง secret ใหม่?",
                `secret เดิมของ ${label} จะใช้ไม่ได้`,
                "สร้างใหม่",
              ))
            )
              return;
            const r = await ctx.api.post(pathFor(p) + "/" + kind, {
              action: "rotate",
            });
            secretReveal(label, JSON.stringify(r, null, 2));
          }),
          button(
            "ปิด hook",
            async () => {
              if (
                await ctx.confirm(
                  "ปิด hook?",
                  `หยุดรับคำขอผ่าน ${label}`,
                  "ปิด",
                )
              ) {
                await ctx.api.post(pathFor(p) + "/" + kind, {
                  action: "disable",
                });
                ctx.toast("ปิด hook แล้ว");
              }
            },
            "danger",
          ),
        ),
      ),
    );
}
async function hooksPane(ctx, p, root, refresh) {
  const data = await ctx.api.get("/api/notification-hooks");
  const hooks = (data.hooks || []).filter((x) => x.projectSlug === p.slug);
  root.append(
    ...hooks.map((x) =>
      h(
        "div",
        { class: "list-row" },
        h("div", {}, h("strong", {}, x.name), h("small", {}, x.provider)),
        button(
          "ลบ",
          async () => {
            if (await ctx.confirm("ลบ notification hook?", x.name, "ลบ")) {
              await ctx.api.delete("/api/notification-hooks/" + x.id);
              await refresh();
            }
          },
          "danger",
        ),
      ),
    ),
  );
  if (!data.vaultReady) {
    root.append(h("p", { class: "notice" }, "Credential vault ยังไม่พร้อม"));
    return;
  }
  root.append(
    form(
      async (v) => {
        await ctx.api.post("/api/notification-hooks", {
          ...v,
          projectSlug: p.slug,
          events: ["deployment.succeeded", "deployment.failed"],
        });
        ctx.toast("บันทึก notification hook แล้ว");
        await refresh();
      },
      field("ชื่อ hook", "name", { required: true }),
      field("Provider", "provider", {
        choices: ["discord", "google-chat", "slack", "generic"],
      }),
      field("Webhook URL", "endpoint", {
        type: "url",
        required: true,
        autocomplete: "off",
      }),
      submit("เพิ่ม notification hook"),
    ),
  );
}
export function trackJob(ctx, initial, title, onComplete = () => {}) {
  const d = ctx.dialog(title + " · deployment", { wide: true });
  const status = h("div");
  const output = h("pre", {
    class: "code logs-output",
    tabIndex: 0,
    "aria-label": "Deployment log",
  });
  d.body.append(status, output);
  d.actions.append(
    link("Deployment history", "/deployments", "btn secondary"),
    button("ปิด", () => d.close(true)),
  );
  const paint = (job) => {
    status.replaceChildren(
      badge(
        job.status,
        job.status === "succeeded"
          ? "success"
          : job.status === "failed"
            ? "danger"
            : "pending",
      ),
    );
    output.textContent =
      (job.events || [])
        .map(
          (e) =>
            when(e.at) + " " + (e.phase || e.status) + ": " + (e.message || ""),
        )
        .join("\n") + (job.failureLog ? "\n" + job.failureLog : "");
  };
  const poller = createPoller({
    load: () =>
      ctx.api
        .get("/api/jobs/" + encodeURIComponent(initial.id), { force: true })
        .then((r) => r.job),
    render: (job) => {
      paint(job);
      if (!["queued", "running"].includes(job.status)) {
        ctx.api.invalidate("/api/projects");
        void Promise.resolve(onComplete(job)).catch((e) =>
          ctx.toast(e.message, true),
        );
        ctx.toast(
          job.status === "succeeded"
            ? "Deployment สำเร็จ"
            : "Deployment จบด้วยสถานะ " + job.status,
          job.status !== "succeeded",
        );
      }
    },
    terminal: (job) => !["queued", "running"].includes(job.status),
    visible: () => !document.hidden,
    interval: 2000,
    onError: (e) =>
      status.replaceChildren(
        h("p", { class: "error" }, e.message),
        button("ลองอีกครั้ง", () => poller.run()),
      ),
  });
  d.onClosed = () => poller.stop();
  ctx.onDispose(() => poller.stop());
  paint(initial);
  if (["queued", "running"].includes(initial.status)) poller.start();
  return d;
}
