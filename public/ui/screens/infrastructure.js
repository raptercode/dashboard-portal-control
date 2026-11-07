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
  table,
  badge,
  bytes,
  copy,
} from "../core/dom.js";
export async function mount(ctx) {
  if (ctx.route.id === "setup") return setup(ctx);
  if (ctx.route.id === "console") return consolePage(ctx);
  return databases(ctx);
}
async function setup(ctx) {
  ctx.root.replaceChildren(
    heading(
      "Host & runtimes",
      "เครื่องมือบนโฮสต์ Git identity และความพร้อมของ infrastructure",
    ),
  );
  const [doctor, git] = await Promise.all([
    ctx.api.get("/api/doctor"),
    ctx.api.get("/api/git-config"),
  ]);
  if (!ctx.active()) return;
  const tools = panel(
    "Runtime inventory",
    "ติดตั้งผ่าน helper ที่จำกัดสิทธิ์และบันทึก Activity",
  );
  tools.append(
    table(
      ["Tool", "Purpose", "Version", "Status", ""],
      (doctor.tools || []).map((t) => [
        h("strong", {}, t.label),
        h("small", {}, t.purpose),
        h("code", {}, t.version || "—"),
        badge(
          t.status === "Installed" ? "Ready" : "Not installed",
          t.status === "Installed" ? "success" : "neutral",
        ),
        t.status !== "Installed" && t.installable !== false
          ? t.id === "mail"
            ? link("Mail setup", "/mail/setup", "btn small")
            : button(
                "ติดตั้ง",
                async () => {
                  if (
                    !(await ctx.confirm(
                      "ติดตั้ง " + t.label + "?",
                      t.purpose + " ระบบจะเปลี่ยน package บน host",
                      "ติดตั้ง",
                    ))
                  )
                    return;
                  const result = await ctx.api.post(
                    "/api/tools/" + encodeURIComponent(t.id) + "/install",
                    { confirm: true },
                  );
                  ctx.toast(result.detail || "ติดตั้งแล้ว");
                  await ctx.reload();
                },
                "primary small",
              )
          : h("span"),
      ]),
      "Host runtimes",
    ),
  );
  const identity = panel(
    "Git identity",
    "ชื่อและอีเมล author ของ commit ที่ระบบทำแทนคุณ",
  );
  identity.append(
    form(
      async (v) => {
        await ctx.api.post("/api/git-config", v);
        ctx.toast("บันทึก Git identity แล้ว");
      },
      field("Name", "name", {
        value: git.identity?.name || "",
        required: true,
        maxLength: 100,
      }),
      field("Email", "email", {
        type: "email",
        value: git.identity?.email || "",
        required: true,
        maxLength: 254,
      }),
      submit("บันทึก Git identity"),
    ),
  );
  const ready = panel(
    "Mail connectivity",
    "ตรวจ SMTP ขาออกและ policy พอร์ตขาเข้าก่อนตั้ง mail service",
  );
  const report = h("div");
  ready.append(
    h(
      "div",
      { class: "panel-body stack" },
      button("ตรวจความพร้อม Mail", async () => {
        const result = await ctx.api.post("/api/mail/readiness-check");
        report.replaceChildren(
          h("pre", { class: "code" }, JSON.stringify(result, null, 2)),
        );
      }),
      report,
      link("ไปที่ Mail setup →", "/mail/setup", "btn ghost"),
    ),
  );
  ctx.root.append(
    h(
      "div",
      { class: "stack" },
      tools,
      h("div", { class: "split equal" }, identity, ready),
    ),
  );
}
async function databases(ctx) {
  ctx.root.replaceChildren(
    heading(
      "Databases",
      "จัดการ connection แล้วเปิด Console เพื่ออ่านหรือแก้ไขข้อมูล",
      button([icon("plus"), "Add connection"], () => editor(ctx), "primary"),
    ),
  );
  const data = await ctx.api.get("/api/databases");
  if (!ctx.active()) return;
  const connections = data.connections || [];
  if (!connections.length) {
    ctx.root.append(
      panel(
        "Connections",
        "PostgreSQL, MySQL, MongoDB และ Redis",
        empty(
          "ยังไม่มี database connection",
          "เพิ่มข้อมูลการเชื่อมต่อ รหัสผ่านจะเข้ารหัสก่อนบันทึก",
          button("Add connection", () => editor(ctx), "primary"),
        ),
      ),
    );
    return;
  }
  const grid = table(
    ["Connection", "Provider", "Endpoint", "Last check", ""],
    connections.map((c) => [
      h(
        "div",
        {},
        link(c.name, `/databases/${c.id}/console`, "app-name"),
        h("small", {}, c.database || "Default database"),
      ),
      h("code", {}, c.provider),
      h(
        "div",
        {},
        h("code", {}, c.host + ":" + c.port),
        h("small", {}, c.tls ? "TLS enabled" : "TLS disabled"),
      ),
      badge(
        c.lastCheck?.status || "Not checked",
        c.lastCheck?.status === "ok" ? "success" : "neutral",
      ),
      h(
        "div",
        { class: "actions" },
        link("Console", `/databases/${c.id}/console`, "btn primary small"),
        button(
          "Test",
          async () => {
            const r = await ctx.api.post("/api/databases/" + c.id + "/check");
            ctx.toast(
              r.check?.detail ||
                r.connection?.lastCheck?.detail ||
                r.detail ||
                "ตรวจ connection แล้ว",
            );
            await ctx.reload();
          },
          "small",
        ),
        button(
          "ลบ",
          async () => {
            if (
              await ctx.confirm(
                "ลบ connection?",
                `ลบเฉพาะข้อมูลการเชื่อมต่อ ${c.name} ไม่ลบ database`,
                "ลบ",
              )
            ) {
              await ctx.api.delete("/api/databases/" + c.id);
              await ctx.reload();
            }
          },
          "danger small",
        ),
      ),
    ]),
  );
  grid.classList.add("mobile-cards");
  ctx.root.append(h("div", { class: "panel" }, grid));
}
function editor(ctx) {
  const d = ctx.dialog("Add database connection");
  const provider = field("Provider", "provider", {
    choices: ["postgresql", "mysql", "mongodb", "redis"],
  });
  const port = field("Port", "port", {
    type: "number",
    min: 1,
    max: 65535,
    value: 5432,
    required: true,
  });
  provider.control.onchange = () => {
    port.control.value = {
      postgresql: 5432,
      mysql: 3306,
      mongodb: 27017,
      redis: 6379,
    }[provider.control.value];
  };
  const password = field("Password", "password", {
    type: "password",
    autocomplete: "new-password",
  });
  const f = form(
    async (v, f) => {
      await ctx.api.post("/api/databases", {
        ...v,
        port: Number(v.port),
        tls: f.elements.tls.checked,
      });
      password.control.value = "";
      await d.close(true);
      ctx.toast("บันทึก connection แล้ว");
      await ctx.reload();
    },
    field("Connection name", "name", {
      required: true,
      pattern: "[a-z][a-z0-9-]{0,79}",
      placeholder: "app-postgres",
    }),
    h("div", { class: "form-columns" }, provider, port),
    field("Host", "host", { value: "127.0.0.1", required: true }),
    h(
      "div",
      { class: "form-columns" },
      field("Database", "database"),
      field("Username", "username", { autocomplete: "off" }),
    ),
    password,
    check("เชื่อมต่อผ่าน TLS", "tls"),
    h("div", { class: "form-actions" }, submit("Save connection")),
  );
  d.body.append(f);
  d.onClosed = () => {
    password.control.value = "";
  };
}
async function consolePage(ctx) {
  const data = await ctx.api.get("/api/databases");
  const c = (data.connections || []).find((c) => c.id === ctx.route.slug);
  if (!c) {
    ctx.root.replaceChildren(
      empty(
        "ไม่พบ connection",
        "อาจถูกลบหรือไม่มีสิทธิ์",
        link("Databases", "/databases", "btn primary"),
      ),
    );
    return;
  }
  const resultRoot = panel("Query result", "ยังไม่มีคำสั่งที่รัน");
  const results = h(
    "div",
    { class: "panel-body" },
    empty("Ready when you are.", "ผลลัพธ์จะแสดงสูงสุด 200 แถว"),
  );
  resultRoot.append(results);
  const query = field("Statement", "statement", {
    type: "textarea",
    rows: 9,
    required: true,
    spellcheck: false,
    placeholder:
      c.provider === "redis"
        ? "GET example"
        : c.provider === "mongodb"
          ? '{"find":"collection","limit":20}'
          : "SELECT * FROM table_name LIMIT 20;",
  });
  query.control.classList.add("code");
  const write = check(
    "Allow write operations",
    "allowWrite",
    false,
    "เปิดเมื่อจะเปลี่ยนข้อมูล ระบบจะถามยืนยันก่อนรัน",
  );
  const driver = data.drivers?.[c.provider];
  const run = submit("Run query");
  run.disabled = !!driver && !driver.installed;
  const f = form(
    async (v, f) => {
      const allowWrite = f.elements.allowWrite.checked;
      if (
        allowWrite &&
        !(await ctx.confirm(
          "รันคำสั่งที่อาจเปลี่ยนข้อมูล?",
          `Connection: ${c.name} · ตรวจ statement ก่อนดำเนินการ`,
          "Run query",
        ))
      )
        return;
      const r = await ctx.api.post("/api/databases/" + c.id + "/query", {
        statement: v.statement.trim(),
        allowWrite,
      });
      const result = r.result;
      resultRoot.querySelector("header p").textContent =
        `${result.rowCount || 0} rows · ${result.durationMs || 0} ms${result.truncated ? " · แสดง 200 แถวแรก" : ""}`;
      const columns = result.columns || [];
      results.replaceChildren(
        result.rows?.length
          ? table(
              columns,
              result.rows.map((row) =>
                Array.isArray(row)
                  ? row.map((cell) =>
                      h(
                        "code",
                        {},
                        cell == null
                          ? "NULL"
                          : typeof cell === "object"
                            ? JSON.stringify(cell)
                            : String(cell),
                      ),
                    )
                  : columns.map((name) =>
                      h(
                        "code",
                        {},
                        row[name] == null ? "NULL" : String(row[name]),
                      ),
                    ),
              ),
            )
          : empty("คำสั่งสำเร็จ", result.notice || "ไม่มีแถวข้อมูลส่งกลับ"),
      );
    },
    query,
    write,
    h(
      "div",
      { class: "form-actions" },
      h("small", {}, "Ctrl / Cmd + Enter เพื่อรัน"),
      run,
    ),
  );
  query.control.onkeydown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      if (!run.disabled) f.requestSubmit(run);
    }
  };
  const queryPanel = panel(
    "Query workspace",
    `${c.provider} · ${c.host}:${c.port}`,
  );
  if (driver && !driver.installed)
    queryPanel.append(
      h(
        "div",
        { class: "notice warning" },
        `ยังไม่มี driver ${driver.package} ติดตั้งบน host แล้ว restart Strckro เพื่อเปิดใช้ Console`,
        h("code", {}, "npm install " + driver.package),
      ),
    );
  queryPanel.append(f);
  ctx.root.replaceChildren(
    heading(
      c.name + " / Console",
      "ค่าเริ่มต้นอนุญาตเฉพาะคำสั่งอ่านข้อมูล",
      link("← Databases", "/databases", "btn secondary"),
    ),
    h("div", { class: "stack" }, queryPanel, resultRoot),
  );
}
