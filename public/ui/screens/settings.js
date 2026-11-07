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
  when,
  copy,
} from "../core/dom.js";
import { secretReveal } from "../core/overlays.js";
export async function mount(ctx) {
  if (ctx.route.id === "updates") return updates(ctx);
  if (ctx.route.id === "monitor") return integrations(ctx);
  return account(ctx);
}
function preference(title, description, body) {
  return h(
    "section",
    { class: "panel" },
    h(
      "div",
      { class: "settings-layout" },
      h(
        "div",
        { class: "settings-copy" },
        h("h2", {}, title),
        h("p", {}, description),
      ),
      body,
    ),
  );
}
async function account(ctx) {
  ctx.root.replaceChildren(
    heading("Account & CLI", "บัญชีของคุณ สิทธิ์สำหรับ CLI และการเชื่อมต่อ AI"),
  );
  const sections = h("div", { class: "stack" });
  ctx.root.append(sections);
  const approval = ctx.route.url.searchParams.get("cli_code");
  if (approval) await deviceApproval(ctx, sections, approval);
  const [tokens, projectData] = await Promise.all([
    ctx.api.get("/api/cli/tokens", { ttl: 0 }),
    ctx.api.get("/api/projects"),
  ]);
  if (!ctx.active()) return;
  const scopeList = h("div", { class: "scope-list" });
  for (const scope of tokens.scopes || [])
    if (ctx.can(scope))
      scopeList.append(check(scope, "scope", scope !== "env.read", "", scope));
  const tokenList = h("div", { class: "compact-list" });
  const render = (items) => {
    tokenList.replaceChildren(
      ...items.map((t) =>
        h(
          "div",
          { class: "list-row" },
          h(
            "div",
            {},
            h("strong", {}, t.name),
            h(
              "small",
              {},
              `${t.projectSlug || "ทุกโปรเจค"} · ${t.scopes.join(", ")}`,
            ),
            h("small", {}, "หมดอายุ ", when(t.expiresAt)),
          ),
          h(
            "div",
            { class: "actions" },
            badge(
              t.revokedAt ? "Revoked" : "Active",
              t.revokedAt ? "neutral" : "success",
            ),
            !t.revokedAt &&
              button(
                "Revoke",
                async () => {
                  if (
                    !(await ctx.confirm(
                      "ถอนสิทธิ์ token?",
                      `${t.name} จะใช้งานต่อไม่ได้ทันที`,
                      "Revoke",
                    ))
                  )
                    return;
                  await ctx.api.delete(
                    "/api/cli/tokens/" + encodeURIComponent(t.id),
                  );
                  render(
                    (await ctx.api.get("/api/cli/tokens", { ttl: 0 })).tokens ||
                      [],
                  );
                },
                "danger small",
              ),
          ),
        ),
      ),
    );
    if (!items.length)
      tokenList.append(
        empty(
          "ยังไม่มี CLI token",
          "ใช้ skctl login หรือสร้าง token สำหรับ automation",
        ),
      );
  };
  render(tokens.tokens || []);
  const f = form(
    async (v, f) => {
      const scopes = new FormData(f).getAll("scope");
      if (!scopes.length) throw new Error("เลือกสิทธิ์อย่างน้อยหนึ่งรายการ");
      const result = await ctx.api.post("/api/cli/tokens", {
        name: v.name,
        projectSlug: v.projectSlug || null,
        expiresInDays: Number(v.days),
        scopes,
      });
      secretReveal("CLI token — แสดงครั้งเดียว", result.token);
      render((await ctx.api.get("/api/cli/tokens", { ttl: 0 })).tokens || []);
      f.elements.name.value = "";
    },
    field("Token name", "name", {
      required: true,
      maxLength: 80,
      placeholder: "Laptop / AI assistant / CI",
    }),
    h(
      "div",
      { class: "form-columns" },
      field("Project scope", "projectSlug", {
        choices: [
          ["", "ทุกโปรเจคที่บัญชีเข้าถึงได้"],
          ...(projectData.projects || []).map((p) => [p.slug, p.name]),
        ],
      }),
      field("อายุ (วัน)", "days", {
        type: "number",
        min: 1,
        max: 90,
        value: 30,
        required: true,
      }),
    ),
    h("fieldset", {}, h("legend", {}, "Allowed permissions"), scopeList),
    h("div", { class: "form-actions" }, submit("Create CLI token")),
  );
  const connection = h(
    "div",
    { class: "stack" },
    h(
      "div",
      { class: "notice" },
      "เชื่อมเครื่องผ่าน browser หรือคัดลอกลิงก์ด้วย --no-browser",
    ),
    h(
      "pre",
      { class: "code" },
      "npm install -g strckro\nskctl login --server " +
        location.origin +
        " --no-browser",
    ),
    button("คัดลอกคำสั่ง", () =>
      copy("skctl login --server " + location.origin + " --no-browser"),
    ),
    f,
  );
  const cli = preference(
    "CLI & AI access",
    "สร้าง token เฉพาะสิทธิ์ที่ต้องใช้ ใช้กับ --token หรือ STRCKRO_TOKEN ค่าจริงแสดงครั้งเดียวและไม่บันทึกใน browser storage",
    connection,
  );
  cli.id = "cli-access";
  sections.append(
    cli,
    panel(
      "Personal access tokens",
      "สิทธิ์ถูกตรวจร่วมกับบัญชีและองค์กรปัจจุบันทุกครั้ง",
      tokenList,
    ),
  );
  const current = field("Current password", "currentPassword", {
    type: "password",
    required: true,
    autocomplete: "current-password",
    maxLength: 128,
  });
  const next = field("New password", "newPassword", {
    type: "password",
    required: true,
    minLength: 12,
    maxLength: 128,
    autocomplete: "new-password",
    hint: "อย่างน้อย 12 ตัว มีตัวพิมพ์ใหญ่ ตัวพิมพ์เล็ก ตัวเลข และสัญลักษณ์",
  });
  const confirmation = field("Confirm new password", "confirm", {
    type: "password",
    required: true,
    minLength: 12,
    maxLength: 128,
    autocomplete: "new-password",
  });
  sections.append(
    preference(
      "Change password",
      "ยืนยันรหัสผ่านเดิมเพื่อเปลี่ยน Session อื่นจะถูกออกจากระบบ และ token ที่ผูกกับเวอร์ชันบัญชีเดิมจะถูกยกเลิก",
      form(
        async (v) => {
          if (v.newPassword !== v.confirm)
            throw new Error("รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน");
          await ctx.api.post("/api/settings/password", {
            currentPassword: v.currentPassword,
            newPassword: v.newPassword,
          });
          current.control.value =
            next.control.value =
            confirmation.control.value =
              "";
          ctx.toast("เปลี่ยนรหัสผ่านแล้ว");
          location.assign("/settings/account");
        },
        current,
        next,
        confirmation,
        submit("Change password"),
      ),
    ),
  );
}
async function deviceApproval(ctx, root, code) {
  const body = h("div", { class: "stack" });
  const box = preference(
    "CLI login request",
    "อนุมัติเฉพาะคำขอที่คุณเริ่มเอง ตรวจว่ารหัสตรงกับ terminal",
    body,
  );
  root.append(box);
  try {
    const d = await ctx.api.get(
      "/api/cli/devices/" + encodeURIComponent(code),
      { ttl: 0 },
    );
    const actions = h("div", { class: "actions" });
    body.append(
      h("code", { class: "code" }, d.userCode),
      h(
        "p",
        {},
        `${d.name} · ${d.projectSlug || "ทุกโปรเจค"} · ${d.expiresInDays} วัน`,
      ),
      h("p", { class: "muted" }, d.scopes.join(", ")),
      actions,
    );
    for (const [approve, label] of [
      [true, "อนุมัติ CLI"],
      [false, "ปฏิเสธ"],
    ])
      actions.append(
        button(
          label,
          async () => {
            const buttons = [...actions.querySelectorAll("button")];
            buttons.forEach((b) => (b.disabled = true));
            try {
              await ctx.api.post(
                "/api/cli/devices/" + encodeURIComponent(code),
                { approve },
              );
              body.replaceChildren(
                h(
                  "div",
                  { class: "notice" },
                  approve
                    ? "อนุมัติแล้ว กลับไปที่ terminal ได้เลย"
                    : "ปฏิเสธการเข้าสู่ระบบแล้ว",
                ),
              );
              const url = new URL(location.href);
              url.searchParams.delete("cli_code");
              history.replaceState(history.state, "", url);
            } catch (e) {
              buttons.forEach((b) => (b.disabled = false));
              throw e;
            }
          },
          approve ? "primary" : "secondary",
        ),
      );
  } catch (e) {
    body.replaceChildren(h("p", { class: "error" }, e.message));
  }
}
async function updates(ctx) {
  ctx.root.replaceChildren(
    heading("System updates", "ตรวจ release channel และอัปเดต Strckro บน host"),
  );
  const status = await ctx.api.get("/api/software-update", { ttl: 0 });
  if (!ctx.active()) return;
  const title =
    status.status === "available"
      ? "A new release is ready."
      : status.status === "current"
        ? "You’re up to date."
        : status.configured
          ? "Release channel"
          : "Update channel not configured";
  const command = "sudo dashboard-portal update";
  ctx.root.append(
    h(
      "div",
      { class: "stack" },
      preference(
        title,
        status.issue ||
          status.update?.notes ||
          "ตรวจลายเซ็นและ checksum ของ release ก่อนติดตั้ง",
        h(
          "div",
          { class: "stack" },
          h(
            "dl",
            { class: "key-values" },
            h("dt", {}, "Installed"),
            h("dd", {}, status.currentVersion || "—"),
            h("dt", {}, "Available"),
            h(
              "dd",
              {},
              status.update?.version || status.availableVersion || "—",
            ),
            h("dt", {}, "Channel"),
            h("dd", {}, status.channel || "stable"),
          ),
          h(
            "p",
            { class: "notice" },
            "SSH เข้า host แล้วรันคำสั่งด้านล่าง บริการจะรีสตาร์ตสั้น ๆ ระหว่างอัปเดต",
          ),
          h("pre", { class: "code" }, command),
          button("Copy update command", () => copy(command)),
        ),
      ),
      preference(
        "Operation mode",
        "โหมดของ backend ที่ workspace นี้เชื่อมต่ออยู่",
        h(
          "div",
          { class: "stack" },
          badge(
            ctx.state.session.mode === "host" ? "Host" : "Local sandbox",
            ctx.state.session.mode === "host" ? "success" : "pending",
          ),
          h(
            "p",
            { class: "muted" },
            ctx.state.session.mode === "host"
              ? "คำสั่ง deploy และการติดตั้งทำงานบน host จริง"
              : "โหมดจำลอง ไม่ควบคุม production host",
          ),
        ),
      ),
    ),
  );
}
async function integrations(ctx) {
  ctx.root.replaceChildren(
    heading(
      "Integrations",
      "เชื่อม observability และระบบภายนอกด้วย project-scoped tokens",
    ),
  );
  const [data, projects] = await Promise.all([
    ctx.api.get("/api/monitor-tokens", { ttl: 0 }),
    ctx.api.get("/api/projects"),
  ]);
  if (!ctx.active()) return;
  const list = h("div", { class: "compact-list" });
  const render = (items) => {
    list.replaceChildren(
      ...items.map((t) =>
        h(
          "div",
          { class: "list-row" },
          h("div", {}, h("strong", {}, t.name), h("small", {}, t.projectSlug)),
          t.revokedAt
            ? badge("Revoked")
            : button(
                "Revoke",
                async () => {
                  if (
                    !(await ctx.confirm(
                      "Revoke monitor token?",
                      t.name,
                      "Revoke",
                    ))
                  )
                    return;
                  await ctx.api.delete("/api/monitor-tokens/" + t.id);
                  render(
                    (await ctx.api.get("/api/monitor-tokens", { ttl: 0 }))
                      .tokens || [],
                  );
                },
                "danger small",
              ),
        ),
      ),
    );
    if (!items.length)
      list.append(
        empty(
          "ยังไม่มี monitor token",
          "สร้าง token เพื่ออ่านสถานะ deployments ของแต่ละแอป",
        ),
      );
  };
  render(data.tokens || []);
  const f = form(
    async (v) => {
      const result = await ctx.api.post("/api/monitor-tokens", v);
      secretReveal("Monitor token", result.token);
      render(
        (await ctx.api.get("/api/monitor-tokens", { ttl: 0 })).tokens || [],
      );
    },
    field("Token name", "name", {
      required: true,
      pattern: "[a-z][a-z0-9-]{0,79}",
      placeholder: "production-monitor",
    }),
    field("Application", "projectSlug", {
      choices: (projects.projects || []).map((p) => [p.slug, p.name]),
      required: true,
    }),
    h("div", { class: "form-actions" }, submit("Create monitor token")),
  );
  ctx.root.append(
    h(
      "div",
      { class: "stack" },
      preference(
        "Monitor access",
        "ใช้ token อ่านสถานะ deployments ของโปรเจคเดียว เหมาะกับ monitoring service",
        f,
      ),
      panel("Monitor tokens", "ค่า token แสดงเฉพาะตอนสร้าง", list),
      preference(
        "Deployment notifications",
        "Discord, Google Chat, Slack และ generic HTTPS hooks ตั้งค่าแยกตามแอป",
        link("เลือกแอปเพื่อตั้ง Notifications →", "/projects", "btn secondary"),
      ),
    ),
  );
}
