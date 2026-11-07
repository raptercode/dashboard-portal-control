import {
  h,
  link,
  icon,
  button,
  submit,
  field,
  form,
  check,
  heading,
  panel,
  empty,
  badge,
  runtimeMark,
  short,
  when,
} from "../core/dom.js";
import { picker } from "../core/picker.js";
import {
  runtimes,
  frameworkLabel,
  frameworkAllowed,
  frameworksFor,
  frameworkPatch,
  detectionPatch,
  logoName,
} from "../core/runtimes.js";
import {
  slugify,
  syncPayload,
  validateService,
  isWorker,
  runtimeName,
  sourceCredentials,
  sourceIsLocked,
  defaultSourceCredential,
} from "../core/model.js";
export async function mount(ctx) {
  return ctx.route.id === "logs" ? logs(ctx) : projectForm(ctx);
}
const defaults = {
  name: "",
  slug: "",
  repository: "",
  branch: "main",
  directory: "/",
  runtime: "node",
  nodeMajor: 24,
  nodePackageManager: "auto",
  buildScript: "build",
  startScript: "start",
  serviceType: "web",
  autoPort: true,
  healthCheckEnabled: true,
  healthCheckPath: "/",
  pythonMode: "script",
  pythonEntry: "main.py",
  pythonInstall: "requirements",
  pythonRequirements: "requirements.txt",
  phpMode: "server",
  phpDocroot: "public",
  phpRouter: "",
  phpInstall: "composer",
  goPackage: ".",
  composeFile: "compose.yaml",
  composeService: "",
};
async function projectForm(ctx) {
  const editing = !!ctx.route.slug;
  const key = "strckro.projectDraft." + (ctx.route.slug || "new");
  let stored;
  try {
    stored = JSON.parse(sessionStorage.getItem(key) || "null");
  } catch {}
  let project = null;
  if (editing) {
    project = (await ctx.api.get("/api/projects")).projects.find(
      (p) => p.slug === ctx.route.slug,
    );
    if (!project) {
      ctx.root.replaceChildren(
        empty("ไม่พบแอป", "แอปอาจถูกลบ หรือบัญชีนี้ไม่มีสิทธิ์"),
      );
      return;
    }
    if (!ctx.can("project.configure", project)) {
      ctx.root.replaceChildren(
        empty("ไม่มีสิทธิ์แก้ไขแอป", "ติดต่อผู้ดูแลองค์กร"),
      );
      return;
    }
  }
  const orgs = (ctx.state.access?.organizations || []).filter(
    (o) =>
      ctx.master() ||
      o.permissions.includes(editing ? "project.configure" : "project.create"),
  );
  if (!editing && !orgs.length) {
    ctx.root.replaceChildren(
      empty("ไม่มีสิทธิ์สร้างแอป", "ติดต่อผู้ดูแลองค์กร"),
    );
    return;
  }
  let draft = {
    ...defaults,
    ...(project ? syncPayload(project) : {}),
    ...(stored || {}),
  };
  if (editing) {
    draft.slug = project.slug;
    draft.serviceType = project.serviceType || "web";
    if (project.serviceType === "worker" && project.deployment?.activeReleaseId)
      draft.runtime = project.runtime;
  }
  if (!draft.organizationId) {
    draft.organizationId = orgs[0]?.id;
    draft.organization = orgs[0]?.name;
  }
  const sourceLocked =
    editing &&
    !ctx.master() &&
    !!(project.credentialId || project.sshKeyId) &&
    !ctx.can("credentials.use", project);
  const runtimeLocked =
    editing && isWorker(project) && !!project.deployment?.activeReleaseId;
  const save = (patch) => {
    draft = { ...draft, ...patch };
    sessionStorage.setItem(key, JSON.stringify(draft));
  };
  const route = (step) =>
    editing
      ? `/projects/${encodeURIComponent(ctx.route.slug)}/edit${step === 1 ? "" : step === 2 ? "/repository" : "/review"}`
      : "/projects/new" +
        (step === 1 ? "" : step === 2 ? "/repository" : "/review");
  const steps = h(
    "nav",
    { class: "steps", "aria-label": "ขั้นตอนสร้างแอป" },
    ...["Identity", "Source & runtime", "Review"].map((label, index) =>
      link(
        [h("span", { class: "step-number" }, index + 1), label],
        route(index + 1),
        `step-link ${ctx.route.step === index + 1 ? "active" : ""}`,
      ),
    ),
    h(
      "p",
      { class: "step-note" },
      "ข้อมูลจะบันทึกบน host เมื่อยืนยันในขั้น Review เท่านั้น ระหว่างนี้เก็บ draft ในแท็บนี้",
    ),
  );
  const body = h("section", { class: "panel" });
  ctx.root.replaceChildren(
    heading(
      editing ? `Edit ${project.name}` : "New application",
      editing
        ? "แก้ไข configuration แล้ว sync source ใหม่"
        : "เชื่อม repository และกำหนดวิธีรันแอป",
      link("ยกเลิก", "/projects", "btn secondary"),
    ),
    h("div", { class: "form-layout" }, steps, body),
  );
  if (ctx.route.step === 1) {
    const name = field("Application name", "name", {
      value: draft.name,
      required: true,
      maxLength: 80,
      placeholder: "Storefront",
    });
    const slug = field("Slug", "slug", {
      value: draft.slug,
      required: true,
      pattern: "[a-z][a-z0-9-]{0,62}",
      maxLength: 63,
      readOnly: editing,
      hint: "ใช้เป็นชื่อ service และ release directory ล็อกหลังสร้าง",
    });
    let manual = !!draft.slug;
    slug.control.oninput = () => {
      manual = true;
    };
    name.control.oninput = () => {
      if (!manual && !editing) slug.control.value = slugify(name.control.value);
    };
    const org = field("Organization", "organizationId", {
      choices: orgs.map((o) => [o.id, o.name]),
      value: draft.organizationId,
      required: true,
      disabled: editing && !ctx.master(),
    });
    const type = field("Service type", "serviceType", {
      choices: [
        ["web", "Web / API — HTTP endpoint"],
        ["worker", "Worker — background process"],
      ],
      value: draft.serviceType,
      disabled: editing,
      hint: "Web รับ HTTP ผ่านพอร์ต ส่วน Worker ไม่มีโดเมนหรือ health endpoint",
    });
    const f = form(
      async (v) => {
        const organizationId = org.control.value;
        save({
          ...v,
          slug: editing ? project.slug : v.slug,
          organizationId,
          organization: orgs.find((o) => o.id === organizationId)?.name,
          serviceType: editing ? project.serviceType || "web" : v.serviceType,
        });
        ctx.dirty(false);
        await ctx.go(route(2));
      },
      h(
        "div",
        { class: "form-heading" },
        h("h2", {}, "Application identity"),
        h("p", {}, "ตั้งชื่อ เลือกองค์กร และประเภทของ service"),
      ),
      name,
      slug,
      org,
      type,
      h("div", { class: "form-actions" }, submit("Continue to source →")),
    );
    f.addEventListener("input", () => ctx.dirty(true));
    body.append(f);
    return;
  }
  if (ctx.route.step === 2) {
    if (!draft.name || !draft.slug) {
      await ctx.go(route(1), { replace: true, force: true });
      return;
    }
    const credentialData = ctx.can("credentials.use", {
      organizationId: draft.organizationId,
    })
      ? await ctx.api.get(
          "/api/credentials?organizationId=" +
            encodeURIComponent(draft.organizationId),
        )
      : { credentials: [] };
    const credentials = credentialData.credentials || [];
    const boundLocked =
      sourceLocked || sourceIsLocked(ctx.state.access, project, credentials);
    const source = h("div", { class: "stack" });
    const runtimeArea = h("div", { class: "stack" });
    const repo = field("Repository URL", "repository", {
      value: draft.repository,
      required: true,
      maxLength: 500,
      placeholder: "https://github.com/org/app.git",
      readOnly: boundLocked,
      hint: "รองรับ HTTPS และ git@ URL เลือก protocol จาก URL ให้อัตโนมัติ",
    });
    const branch = field("Branch", "branch", {
      value: draft.branch,
      required: true,
    });
    const directory = field("App directory", "directory", {
      value: draft.directory,
      required: true,
      placeholder: "/apps/web",
      readOnly: boundLocked,
    });
    const credential = field("Git credential", "credentialId", {
      choices: [
        ["", "Public repository / ไม่ใช้ token"],
        ...sourceCredentials(
          ctx.state.access,
          credentials,
          draft.organizationId,
        ).map((c) => [c.id, `${c.name} · ${c.host}`]),
      ],
      value: draft.credentialId || "",
      disabled: boundLocked,
    });
    const chooseDefault = () => {
      if (boundLocked) return;
      const defaultCredential = defaultSourceCredential(
        ctx.state.access,
        credentials,
        draft.organizationId,
        repo.control.value,
        credentialData.defaultCredentialId,
      );
      const current = credentials.find(
        (c) => c.id === credential.control.value,
      );
      let host;
      try {
        host = new URL(repo.control.value).hostname;
      } catch {}
      if (current && current.host !== host) credential.control.value = "";
      if (!credential.control.value && defaultCredential)
        credential.control.value = defaultCredential.id;
      credential.control.disabled = repo.control.value
        .trim()
        .startsWith("git@");
    };
    repo.control.addEventListener("change", chooseDefault);
    chooseDefault();
    const protocol = () =>
      repo.control.value.trim().startsWith("git@") ? "ssh" : "https";
    const requestSpec = () => ({
      organizationId: draft.organizationId,
      repository: repo.control.value.trim(),
      protocol: protocol(),
      credentialId: sourceLocked
        ? project.credentialId || ""
        : credential.control.value,
      branch: branch.control.value,
      directory: directory.control.value,
    });
    const settings = h("div", { class: "stack" });
    const note = h("small", { role: "status", class: "detect-note" });
    const found = h("div", { class: "detected", hidden: true });
    const branchList = h("datalist", { id: "repository-branches" });
    let detection = null;
    let missing = new Set(); // optional runtimes the host does not have
    let picks = 0; // the user's own choices: detection must never undo one
    const fresh = (spec) =>
      ctx.active() && JSON.stringify(requestSpec()) === JSON.stringify(spec);
    const setNote = (state, text) => {
      note.dataset.state = state;
      note.textContent = text;
    };
    const keepRuntime = () => {
      for (const input of settings.querySelectorAll("[name]"))
        if (input.type === "checkbox") draft[input.name] = input.checked;
        else draft[input.name] = input.value;
    };
    const runtimeOptions = () =>
      Object.entries(runtimes).map(([value, spec]) => {
        const unavailable = missing.has(value);
        const seen = detection?.candidates?.some((c) => c.runtime === value);
        return {
          value,
          label: spec.label,
          detail: spec.detail,
          mark: () => runtimeMark(spec.logo),
          disabled: unavailable,
          title: unavailable ? "ยังไม่ได้ติดตั้งบน host" : undefined,
          tag: unavailable ? "ยังไม่ติดตั้ง" : seen ? "ตรวจพบ" : undefined,
        };
      });
    const frameworkOptions = (selectedRuntime) => {
      const seen = (detection?.candidates || [])
        .filter((c) => c.runtime === selectedRuntime && c.framework)
        .map((c) => c.framework);
      return [
        {
          value: "",
          label: "ไม่มี framework",
          detail: "ใช้ runtime อย่างเดียว",
          mark: () => runtimeMark(runtimes[selectedRuntime]?.logo),
        },
        ...frameworksFor(selectedRuntime).map(({ name, label }) => ({
          value: name,
          label,
          detail: seen.includes(name) ? "ตรวจพบจาก repository" : "เลือกเอง",
          mark: () => runtimeMark(name),
          tag: seen.includes(name) ? "ตรวจพบ" : undefined,
        })),
      ];
    };
    const runtimePicker = picker({
      label: "Runtime",
      name: "runtime",
      value: draft.runtime,
      options: runtimeOptions(),
      disabled: runtimeLocked,
      onChange: (value) => {
        picks++;
        keepRuntime();
        draft.runtime = value;
        applyCandidate(value);
        paintRuntime();
        ctx.dirty(true);
      },
    });
    const frameworkPicker = picker({
      label: "Framework (optional)",
      name: "framework",
      value: draft.framework || "",
      options: frameworkOptions(draft.runtime),
      disabled: runtimeLocked,
      hint: "เลือกเอง หรือให้ระบบตรวจจาก repository",
      onChange: (value) => {
        picks++;
        keepRuntime();
        draft.framework = value;
        Object.assign(draft, frameworkPatch(value, draft));
        paintRuntime();
        ctx.dirty(true);
      },
    });
    const paintPickers = () => {
      const selectedRuntime = runtimePicker.value;
      runtimePicker.setOptions(runtimeOptions());
      if (!frameworkAllowed(frameworkPicker.value, selectedRuntime))
        frameworkPicker.value = "";
      draft.framework = frameworkPicker.value;
      frameworkPicker.setOptions(frameworkOptions(selectedRuntime));
      frameworkPicker.hidden = !frameworksFor(selectedRuntime).length;
    };
    // Switching runtime applies what detection found for that runtime, if anything.
    const applyCandidate = (selectedRuntime) => {
      const candidate = detection?.candidates?.find(
        (c) => c.runtime === selectedRuntime,
      );
      if (candidate) {
        Object.assign(draft, detectionPatch(candidate, selectedRuntime), {
          framework: candidate.framework || "",
        });
        frameworkPicker.value = draft.framework;
      }
      paintPickers();
    };
    const renderDetected = () => {
      const name = detection?.recommendedRuntime;
      found.hidden = !name;
      if (!name) return;
      const framework = detection.recommendedFramework;
      const paths = (detection.evidence || []).map((item) => item.path);
      found.replaceChildren(
        runtimeMark(framework || runtimes[name]?.logo),
        h(
          "div",
          {},
          h(
            "strong",
            {},
            "ตรวจพบ ",
            framework ? frameworkLabel(framework) : runtimes[name]?.label,
            " · ",
            runtimes[name]?.label,
          ),
          h(
            "small",
            {},
            [detection.notice, paths.join(" · ")].filter(Boolean).join(" · "),
          ),
        ),
      );
    };
    const paintRuntime = () => {
      settings.replaceChildren();
      const selected = runtimePicker.value;
      draft.runtime = selected;
      if (["node", "bun"].includes(selected)) {
        if (selected === "node")
          settings.append(
            h(
              "div",
              { class: "form-columns" },
              field("Node major", "nodeMajor", {
                choices: [20, 22, 24, 26],
                value: draft.nodeMajor,
              }),
              field("Package manager", "nodePackageManager", {
                choices: [
                  ["auto", "Auto (from lockfile)"],
                  ["npm", "npm"],
                  ["pnpm", "pnpm"],
                ],
                value: draft.nodePackageManager,
              }),
            ),
          );
        settings.append(
          h(
            "div",
            { class: "form-columns" },
            field("Build script", "buildScript", {
              value: draft.buildScript ?? "",
              hint: "ชื่อ package script เว้นว่างเพื่อข้าม build",
            }),
            field("Start script", "startScript", {
              value: draft.startScript || "start",
              required: true,
            }),
          ),
        );
      }
      if (selected === "go")
        settings.append(
          field("Go package", "goPackage", {
            value: draft.goPackage || ".",
            required: true,
            hint: "โฟลเดอร์ที่มี main package เช่น . หรือ ./cmd/server",
          }),
        );
      if (selected === "python")
        settings.append(
          h(
            "div",
            { class: "form-columns" },
            field("Run type", "pythonMode", {
              choices: isWorker(draft)
                ? ["script"]
                : ["script", "asgi", "wsgi"],
              value: isWorker(draft) ? "script" : draft.pythonMode,
            }),
            field("Entry file / module", "pythonEntry", {
              value: draft.pythonEntry || "main.py",
              required: true,
            }),
          ),
          field("Dependencies", "pythonInstall", {
            choices: ["requirements", "project", "none"],
            value: draft.pythonInstall,
          }),
          field("Requirements path", "pythonRequirements", {
            value: draft.pythonRequirements || "requirements.txt",
          }),
        );
      if (selected === "php")
        settings.append(
          field("Run mode", "phpMode", {
            choices: [
              ["server", "PHP built-in server"],
              ["artisan", "Laravel / artisan"],
              ["spark", "CodeIgniter / spark"],
            ],
            value: draft.phpMode,
          }),
          field("Document root", "phpDocroot", {
            value: draft.phpDocroot || "public",
          }),
          field("Router file (optional)", "phpRouter", {
            value: draft.phpRouter || "",
          }),
          field("Dependencies", "phpInstall", {
            choices: ["composer", "none"],
            value: draft.phpInstall,
          }),
        );
      if (selected === "docker-compose")
        settings.append(
          field("Compose file", "composeFile", {
            value: draft.composeFile || "compose.yaml",
            required: true,
          }),
          field("Compose service", "composeService", {
            value: draft.composeService || "web",
            required: true,
          }),
          h(
            "p",
            { class: "notice warning" },
            "Compose repository ต้องเป็น source ที่คุณเชื่อถือ และผ่าน policy ของ host ก่อน activate",
          ),
        );
    };
    // Detection fills the form, unless the user chose something in the meantime.
    const applyDetection = (result, startedAt, quiet) => {
      detection = result;
      const name = result.recommendedRuntime;
      if (name && !runtimeLocked && startedAt === picks) {
        keepRuntime();
        const candidate =
          result.candidates?.find((c) => c.runtime === name) || result;
        Object.assign(draft, detectionPatch(candidate, name), {
          runtime: name,
          framework: result.recommendedFramework || "",
        });
        runtimePicker.value = draft.runtime;
        frameworkPicker.value = draft.framework;
        paintRuntime();
        ctx.dirty(true);
        if (!quiet)
          ctx.toast(
            `เลือก ${frameworkLabel(draft.framework) || runtimes[name]?.label} ให้แล้ว`,
          );
      }
      paintPickers();
      renderDetected();
      setNote(
        "",
        name
          ? startedAt === picks
            ? ""
            : "ตรวจพบ runtime แล้ว แต่คงค่าที่คุณเลือกไว้ · เปลี่ยน runtime เพื่อใช้ค่าที่ตรวจพบ"
          : result.notice || "ยังตรวจ runtime ไม่ได้ เลือกเองได้",
      );
    };
    const detectNow = async ({ quiet, startedAt = picks }) => {
      const spec = requestSpec();
      setNote("busy", "กำลังอ่าน metadata ของ repository…");
      try {
        const result = await ctx.api.post("/api/projects/runtime-detect", spec);
        if (!fresh(spec)) return false;
        applyDetection(result.detection || {}, startedAt, quiet);
        return true;
      } catch (error) {
        if (fresh(spec))
          setNote("error", `ตรวจอัตโนมัติไม่สำเร็จ: ${error.message}`);
        throw error;
      }
    };
    // Branches first (so the right branch is scanned), then the runtime.
    const inspect = async ({ quiet }) => {
      const spec = requestSpec();
      const startedAt = picks;
      setNote("busy", "กำลังดึง branch และตรวจ App อัตโนมัติ…");
      let names;
      try {
        const result = await ctx.api.post("/api/git/branches", spec);
        names = (result.branches || []).map((b) =>
          typeof b === "string" ? b : b.name,
        );
        if (!names.length) throw new Error("ไม่พบ branch ที่เลือกได้ใน repository นี้");
      } catch (error) {
        if (ctx.active() && JSON.stringify(requestSpec()) === JSON.stringify(spec))
          setNote("error", `อ่าน repository ไม่สำเร็จ: ${error.message}`);
        if (!quiet) throw error;
        return false;
      }
      if (!ctx.active()) return false;
      branchList.replaceChildren(...names.map((n) => h("option", { value: n })));
      branch.control.setAttribute("list", branchList.id);
      const wanted = names.includes(branch.control.value)
        ? branch.control.value
        : names.includes("main")
          ? "main"
          : names[0];
      branch.control.value = wanted;
      if (!quiet) ctx.toast(`พบ ${names.length} branches แล้ว`);
      if (runtimeLocked) {
        setNote("", "");
        return true;
      }
      try {
        return await detectNow({ quiet, startedAt });
      } catch (error) {
        if (!quiet) throw error;
        return false;
      }
    };
    // Typing or pasting an HTTPS repository URL inspects it on its own.
    const autoInspect = { timer: 0, key: "", running: false, pending: false };
    const specKey = () =>
      JSON.stringify([
        draft.organizationId,
        repo.control.value.trim(),
        protocol(),
        credential.control.value,
      ]);
    const schedule = (delay = 450) => {
      if (boundLocked) return;
      clearTimeout(autoInspect.timer);
      autoInspect.timer = setTimeout(async () => {
        const value = repo.control.value.trim();
        if (!/^https:\/\/[^\s]+\.git(?:$|[?#])/.test(value)) return;
        if (!repo.control.checkValidity()) return;
        if (autoInspect.running) {
          autoInspect.pending = true;
          return;
        }
        const key = specKey();
        if (autoInspect.key === key) return;
        autoInspect.running = true;
        autoInspect.key = key;
        try {
          if (!(await inspect({ quiet: true }))) autoInspect.key = "";
        } finally {
          autoInspect.running = false;
          if (autoInspect.pending) {
            autoInspect.pending = false;
            schedule(0);
          }
        }
      }, delay);
    };
    ctx.onDispose(() => clearTimeout(autoInspect.timer));
    repo.control.addEventListener("input", () => schedule());
    repo.control.addEventListener("paste", () => schedule(60));
    credential.control.addEventListener("change", () => {
      autoInspect.key = "";
      schedule(60);
    });
    paintRuntime();
    paintPickers();
    // Optional runtimes the host lacks are shown, but cannot be chosen.
    void ctx.api
      .get("/api/doctor")
      .then((report) => {
        missing = new Set(
          (report.tools || [])
            .filter(
              (tool) =>
                ["go", "python", "php"].includes(tool.id) &&
                tool.status === "Missing",
            )
            .map((tool) => tool.id),
        );
        if (ctx.active()) paintPickers();
      })
      .catch(() => {});
    const detect = button(
      "ตรวจ App อัตโนมัติ",
      async () => {
        if (repo.control.reportValidity()) await detectNow({ quiet: false });
      },
      "secondary",
      { disabled: boundLocked || runtimeLocked },
    );
    const branches = button(
      "Fetch branches",
      async () => {
        if (repo.control.reportValidity()) await inspect({ quiet: false });
      },
      "secondary",
      { disabled: boundLocked },
    );
    source.append(
      h(
        "div",
        { class: "form-heading" },
        h("h2", {}, "Source"),
        h("p", {}, draft.name, " · ", draft.organization),
      ),
      boundLocked &&
        h(
          "p",
          { class: "notice" },
          "Credential ถูกผูกกับ source เดิม บัญชีนี้แก้ repository และ credential ไม่ได้",
        ),
      repo,
      credential,
      branch,
      directory,
      h("div", { class: "actions" }, branches, detect),
      note,
      branchList,
    );
    runtimeArea.append(
      h(
        "div",
        { class: "form-heading" },
        h("h2", {}, "Runtime configuration"),
        h(
          "p",
          {},
          isWorker(draft)
            ? "Worker ไม่ใช้ HTTP port หรือ domain"
            : "กำหนดวิธี install, build และเริ่ม service",
        ),
      ),
      found,
      runtimePicker,
      frameworkPicker,
      settings,
    );
    let port, auto, health, healthPath;
    if (!isWorker(draft)) {
      port = field("Internal port", "port", {
        type: "number",
        min: 1024,
        max: 65535,
        value: draft.port || "",
        readOnly: draft.autoPort !== false,
      });
      auto = check(
        "เลือกพอร์ตว่างอัตโนมัติ",
        "autoPort",
        draft.autoPort !== false,
      );
      auto.querySelector("input").onchange = (e) => {
        port.control.readOnly = e.target.checked;
      };
      health = check(
        "ตรวจ HTTP ก่อน activate",
        "healthCheckEnabled",
        draft.healthCheckEnabled !== false,
        "รับสถานะ 2xx หรือ 3xx จาก loopback",
      );
      healthPath = field("Health path", "healthCheckPath", {
        value: draft.healthCheckPath || "/",
      });
      runtimeArea.append(
        h(
          "fieldset",
          {},
          h("legend", {}, "HTTP service"),
          h("div", { class: "stack" }, auto, port, health, healthPath),
        ),
      );
    }
    const f = form(
      async (v, f) => {
        const values = {
          ...draft,
          ...v,
          ...requestSpec(),
          runtime: runtimePicker.value,
          framework: frameworkPicker.value,
          serviceType: draft.serviceType,
          autoPort: isWorker(draft) ? false : !!f.elements.autoPort?.checked,
          healthCheckEnabled: isWorker(draft)
            ? false
            : !!f.elements.healthCheckEnabled?.checked,
          nodeMajor: Number(v.nodeMajor || draft.nodeMajor || 24),
        };
        if (boundLocked) {
          values.repository = project.repository;
          values.directory = project.directory;
          values.credentialId = project.credentialId || "";
          values.sshKeyId = project.sshKeyId || "";
        }
        values.port =
          isWorker(draft) || values.autoPort
            ? null
            : Number(v.port || draft.port) || null;
        const error = validateService(values);
        if (error) throw new Error(error);
        save(values);
        ctx.dirty(false);
        await ctx.go(route(3));
      },
      h("div", { class: "split equal" }, source, runtimeArea),
      h(
        "div",
        { class: "form-actions" },
        link("← Identity", route(1), "btn secondary"),
        submit("Review configuration →"),
      ),
    );
    f.addEventListener("input", () => ctx.dirty(true));
    body.append(f);
    return;
  }
  if (!draft.repository) {
    await ctx.go(route(2), { replace: true, force: true });
    return;
  }
  const payload = {
    ...syncPayload(draft),
    nodeMajor: Number(draft.nodeMajor),
    port: draft.autoPort ? null : draft.port ? Number(draft.port) : null,
    buildScript: draft.buildScript ?? "",
    healthCheckEnabled: isWorker(draft)
      ? false
      : draft.healthCheckEnabled !== false,
  };
  delete payload.autoPort;
  delete payload.skipBuild;
  body.append(
    h(
      "div",
      { class: "panel-body stack" },
      h(
        "div",
        { class: "form-heading with-mark" },
        runtimeMark(logoName(draft)),
        h(
          "div",
          {},
          h("h2", {}, "Review your application"),
          h(
            "p",
            {},
            "ยืนยันค่าแล้ว sync source — ขั้นนี้ยังไม่สร้าง release หรือเริ่ม service",
          ),
        ),
      ),
      h(
        "dl",
        { class: "key-values" },
        ...Object.entries({
          Name: draft.name,
          Slug: draft.slug,
          Organization: draft.organization,
          Service: draft.serviceType,
          Repository: draft.repository,
          Directory: draft.directory,
          Branch: draft.branch,
          Runtime: runtimeName(draft),
          Build: draft.buildScript || "Skip build",
          Start: draft.startScript,
          Port: isWorker(draft)
            ? "No HTTP endpoint"
            : draft.autoPort
              ? "Auto"
              : draft.port,
          Health: isWorker(draft)
            ? "Not applicable"
            : draft.healthCheckEnabled
              ? draft.healthCheckPath
              : "Disabled",
        }).flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v || "—")]),
      ),
      h(
        "p",
        { class: "notice" },
        "หลัง sync ให้เปิด workspace ของแอปเพื่อตั้ง ENV และ Create release",
      ),
      form(
        async () => {
          const error = validateService(payload);
          if (error) throw new Error(error);
          const result = await ctx.api.post("/api/projects/sync", payload);
          sessionStorage.removeItem(key);
          ctx.dirty(false);
          ctx.toast(
            result.project?.sync?.status === "synced"
              ? "บันทึกและ sync source แล้ว"
              : result.project?.sync?.detail || "บันทึกแอปแล้ว",
          );
          await ctx.go("/projects");
        },
        h(
          "div",
          { class: "form-actions" },
          link("← Source & runtime", route(2), "btn secondary"),
          submit("บันทึกและ sync source"),
        ),
      ),
    ),
  );
}
async function logs(ctx) {
  const p = (await ctx.api.get("/api/projects")).projects.find(
    (p) => p.slug === ctx.route.slug,
  );
  if (!p) {
    ctx.root.replaceChildren(
      empty("ไม่พบแอป", "ตรวจ slug หรือสิทธิ์การเข้าถึง"),
    );
    return;
  }
  const output = h(
    "pre",
    { class: "code logs-output", tabIndex: 0, "aria-label": "Runtime logs" },
    "กำลังอ่าน log…",
  );
  const unit = h("small", { class: "mono" });
  const notice = h("div", { class: "notice", hidden: true });
  const auto = check(
    "Auto refresh",
    "auto",
    true,
    "อัปเดตทุก 5 วินาที เฉพาะตอนแท็บกำลังเปิด",
  );
  const runtime = panel(
    "Runtime log",
    "บรรทัดล่าสุดจาก systemd unit ของ release ที่ทำงานอยู่",
  );
  const load = async () => {
    const result = await ctx.api.get(
      "/api/projects/" + encodeURIComponent(p.slug) + "/logs",
      { force: true, ttl: 0 },
    );
    if (!ctx.active()) return;
    unit.textContent = result.unit || "";
    notice.hidden = !result.simulated && result.available !== false;
    notice.textContent = result.simulated
      ? "Local sandbox — ไม่ใช่ log จริงของ host"
      : result.notice || "ยังอ่าน log ไม่ได้";
    const bottom =
      output.scrollTop + output.clientHeight >= output.scrollHeight - 4;
    output.textContent = result.lines?.join("\n") || "ยังไม่มี log";
    if (bottom) output.scrollTop = output.scrollHeight;
  };
  runtime
    .querySelector("header")
    .append(
      button(icon("refresh"), load, "icon", { "aria-label": "รีเฟรช log" }),
    );
  runtime.append(
    h(
      "div",
      { class: "panel-body stack" },
      h("div", { class: "actions spread" }, unit, auto),
      notice,
      output,
    ),
  );
  const history = panel(
    "Release history",
    "เลือก release เพื่อดูเหตุการณ์และ build output",
  );
  history.append(
    ...(p.deployment?.releases || []).map((r) =>
      h(
        "div",
        { class: "list-row" },
        h(
          "div",
          {},
          h("strong", {}, short(r.id)),
          h("small", {}, short(r.revision), " · ", when(r.createdAt)),
        ),
        h(
          "div",
          { class: "actions" },
          badge(r.status, r.status === "failed" ? "danger" : "neutral"),
          button(
            "Log",
            () => {
              const d = ctx.dialog("Release " + short(r.id), { wide: true });
              d.body.append(
                h(
                  "pre",
                  { class: "code" },
                  (r.events || [])
                    .map(
                      (e) =>
                        `${when(e.at)} ${e.phase || e.status}: ${e.message || ""}`,
                    )
                    .join("\n") +
                    "\n" +
                    (r.failureLog || ""),
                ),
              );
            },
            "small",
          ),
        ),
      ),
    ),
  );
  if (!p.deployment?.releases?.length)
    history.append(empty("ยังไม่มี release", "ประวัติจะปรากฏเมื่อ deploy"));
  ctx.root.replaceChildren(
    heading(
      p.name + " / Logs",
      p.slug + " · " + p.branch,
      link("Applications", "/projects", "btn secondary"),
    ),
    h("div", { class: "split" }, runtime, history),
  );
  await load();
  ctx.poll(async () => {
    if (auto.querySelector("input").checked) await load();
  }, 5000);
}
