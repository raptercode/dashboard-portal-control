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
  when,
  copy,
} from "../core/dom.js";
export async function mount(ctx) {
  return ctx.route.id === "mail-setup" ? wizard(ctx) : service(ctx);
}
async function service(ctx) {
  ctx.root.replaceChildren(
    heading(
      "Mail service",
      "ดูแล SMTP / IMAP, โดเมน และ mailboxes ของโฮสต์นี้",
      link("Configure mail", "/mail/setup", "btn primary"),
    ),
  );
  const data = await ctx.api.get("/api/mail");
  if (!ctx.active()) return;
  const mail = data.mail;
  const configured = mail.configure?.status === "configured";
  ctx.root.append(
    h(
      "div",
      { class: "stat-strip" },
      ...[
        [mail.hostname || "Not configured", "Mail hostname"],
        [mail.domains.length, "Domains"],
        [mail.mailboxes.length, "Mailboxes"],
        [mail.outboundMode || "Not selected", "Delivery mode"],
      ].map(([value, title]) =>
        h(
          "div",
          { class: "stat" },
          h("span", {}, title),
          h(
            "strong",
            { style: "font-size:22px;overflow-wrap:anywhere" },
            value,
          ),
          h(
            "small",
            {},
            configured ? "Mail service configured" : "Setup required",
          ),
        ),
      ),
    ),
  );
  if (!configured) {
    ctx.root.append(
      panel(
        "Set up mail on your infrastructure.",
        "ตรวจ connectivity ตั้ง hostname และ DNS แล้วเปิดใช้งาน service",
        empty(
          "Mail service is not configured.",
          "เริ่ม setup เพื่อเชื่อม mailbox จริงของคุณ หน้านี้ใช้จัดการ service ไม่ใช่โปรแกรมอ่าน inbox",
          link("Start mail setup →", "/mail/setup", "btn primary"),
        ),
      ),
    );
    return;
  }
  const mailboxes = panel(
    "Mailboxes",
    "เชื่อมโปรแกรมรับส่งอีเมลผ่าน IMAP / SMTP ของ hostname นี้",
  );
  mailboxes.append(
    mail.mailboxes.length
      ? table(
          ["Mailbox", "Display name", "Created"],
          mail.mailboxes.map((m) => [
            h("strong", {}, m.localPart + "@" + m.domain),
            h("span", {}, m.displayName || "—"),
            h("small", {}, when(m.createdAt)),
          ]),
        )
      : empty(
          "ยังไม่มี mailbox",
          "สร้าง mailbox จาก Mail setup",
          link("Add mailbox", "/mail/setup?step=6", "btn primary"),
        ),
  );
  const domains = panel(
    "Domain health",
    "ตรวจ DNS และรายละเอียด records จาก Mail setup",
  );
  domains.append(
    ...mail.domains.map((d) =>
      h(
        "div",
        { class: "list-row" },
        h(
          "div",
          {},
          h("strong", {}, d.domain),
          h(
            "small",
            {},
            Object.entries(d.dns || {})
              .map(([k, v]) => `${k.toUpperCase()}: ${v.status || "pending"}`)
              .join(" · "),
          ),
        ),
        link("DNS records", "/mail/setup?step=3", "btn small"),
      ),
    ),
  );
  ctx.root.append(h("div", { class: "split" }, mailboxes, domains));
}
const stages = [
  "Connectivity",
  "Identity",
  "DNS records",
  "Delivery",
  "Activate",
  "Mailboxes",
  "Test",
];
export function mailStepAvailable(step, mail) {
  if (step <= 2) return true;
  if (step <= 4) return !!mail.hostname && !!mail.domains?.length;
  if (step === 5)
    return !!mail.hostname && !!mail.domains?.length && !!mail.outboundMode;
  if (step === 6) return mail.configure?.status === "configured";
  return mail.configure?.status === "configured" && !!mail.mailboxes?.length;
}
async function wizard(ctx) {
  let data = await ctx.api.get("/api/mail", { ttl: 0 }),
    step = Math.max(
      1,
      Math.min(7, Number(ctx.route.url.searchParams.get("step")) || 1),
    ),
    dirty = false;
  const steps = h("nav", { class: "steps", "aria-label": "Mail setup steps" });
  const body = h("section", { class: "panel" });
  ctx.root.replaceChildren(
    heading(
      "Configure mail",
      "ตั้งแต่ตรวจพอร์ตจนถึง mailbox แรก ทุกขั้นที่บันทึกแล้วกลับมาทำต่อได้",
      link("Mail service", "/mail", "btn secondary"),
    ),
    h("div", { class: "form-layout" }, steps, body),
  );
  const mark = () => {
    dirty = true;
    ctx.dirty(true);
  };
  const saved = () => {
    dirty = false;
    ctx.dirty(false);
  };
  const reload = async () => {
    data = await ctx.api.get("/api/mail", { force: true, ttl: 0 });
    saved();
  };
  const navigate = async (next) => {
    if (
      dirty &&
      !(await ctx.confirm(
        "ทิ้งข้อมูลที่ยังไม่บันทึก?",
        "ข้อมูลในขั้นปัจจุบันจะหายไป",
        "ทิ้งการแก้ไข",
      ))
    )
      return;
    saved();
    step = next;
    const url = new URL(location.href);
    url.searchParams.set("step", String(step));
    history.replaceState(history.state, "", url);
    paint();
  };
  const act = async (path, payload = {}, method = "post") => {
    const result = await ctx.api[method](path, payload);
    await reload();
    paint();
    return result;
  };
  const paint = () => {
    const mail = data.mail;
    if (!mailStepAvailable(step, mail)) step = 1;
    steps.replaceChildren(
      ...stages.map((name, i) => {
        const b = button(
          [h("span", { class: "step-number" }, i + 1), name],
          () => navigate(i + 1),
          "step-link" + (i + 1 === step ? " active" : ""),
          { disabled: !mailStepAvailable(i + 1, mail) },
        );
        b.setAttribute("aria-current", i + 1 === step ? "step" : "false");
        return b;
      }),
      h(
        "p",
        { class: "step-note" },
        "ขั้น activate เปลี่ยนแปลง host จริง การตรวจ DNS ไม่ได้ทำให้ provider เปลี่ยน records ให้อัตโนมัติ",
      ),
    );
    const pane = h("div", { class: "panel-body stack" });
    body.replaceChildren(
      h(
        "header",
        { class: "panel-head" },
        h(
          "div",
          {},
          h(
            "span",
            { class: "overline" },
            `MAIL SETUP / ${String(step).padStart(2, "0")}`,
          ),
          h("h2", {}, stages[step - 1]),
        ),
      ),
      pane,
    );
    const report = mail.readiness;
    const next = () =>
      h(
        "div",
        { class: "form-actions" },
        step > 1 && button("← Back", () => navigate(step - 1)),
        step < 7 &&
          mailStepAvailable(step + 1, mail) &&
          button("Continue →", () => navigate(step + 1), "primary"),
      );
    if (step === 1) {
      pane.append(
        h(
          "p",
          { class: "muted" },
          "ตรวจ outbound SMTP 25/587/2525 และ inbound policy ก่อนเลือกวิธีส่งเมล",
        ),
        report?.checkedAt &&
          h("small", {}, "ตรวจล่าสุด ", when(report.checkedAt)),
        report?.outbound &&
          h(
            "pre",
            { class: "code" },
            JSON.stringify(
              { outbound: report.outbound, inbound: report.inbound },
              null,
              2,
            ),
          ),
        button(
          "Check mail connectivity",
          async () => {
            await act("/api/mail/readiness-check");
            ctx.toast("ตรวจ connectivity แล้ว");
          },
          "primary",
        ),
      );
    }
    if (step === 2) {
      const domainSubmit = submit("Add domain");
      domainSubmit.disabled = !mail.hostname;
      const hostnameForm = form(
        async (v) => {
          await ctx.api.post("/api/mail/hostname", {
            hostname: v.hostname.trim(),
          });
          await reload();
          domainSubmit.disabled = false;
          ctx.toast("บันทึก hostname แล้ว");
        },
        field("Mail hostname", "hostname", {
          value: mail.hostname || data.suggestions?.hostname || "",
          required: true,
          placeholder: "mail.example.com",
          hint: "ใช้ A/AAAA record ชี้มายัง IP ของ host ไม่ใช้ CNAME ที่ถูก proxy",
        }),
        submit("Save hostname"),
      );
      hostnameForm.addEventListener("input", mark);
      pane.append(
        hostnameForm,
        h("hr", { class: "divider" }),
        h("h3", {}, "Mail domains"),
        h(
          "small",
          {},
          mail.domains.length + " / " + data.maxDomains + " domains",
        ),
      );
      for (const entry of mail.domains)
        pane.append(
          h(
            "div",
            { class: "list-row" },
            h("strong", {}, entry.domain),
            button(
              "Remove",
              async () => {
                if (
                  await ctx.confirm("ลบ mail domain?", entry.domain, "Remove")
                )
                  await act(
                    "/api/mail/domains/" + encodeURIComponent(entry.domain),
                    {},
                    "delete",
                  );
              },
              "danger small",
            ),
          ),
        );
      const domainForm = form(
        async (v) => {
          await act("/api/mail/domains", { domain: v.domain.trim() });
          ctx.toast("เพิ่ม mail domain แล้ว");
        },
        field("Domain", "domain", {
          required: true,
          placeholder: data.suggestions?.domains?.[0] || "example.com",
        }),
        !mail.hostname &&
          h("small", {}, "บันทึก mail hostname ก่อนเพิ่ม domain"),
        domainSubmit,
      );
      domainForm.addEventListener("input", mark);
      pane.append(domainForm);
    }
    if (step === 3) {
      pane.append(
        h(
          "p",
          { class: "notice" },
          "คัดลอก records ไปที่ DNS provider แล้วตรวจ DNS อาจใช้เวลา propagate สามารถไปขั้นถัดไปแล้วกลับมาได้",
        ),
      );
      for (const entry of mail.domains) {
        const rows = Object.entries(entry.records || {}).map(
          ([kind, record]) => {
            const text =
              typeof record === "object"
                ? JSON.stringify(record)
                : String(record);
            return [
              h("strong", {}, kind.toUpperCase()),
              h("code", {}, text),
              h(
                "div",
                { class: "actions" },
                button("Copy", () => copy(text), "small"),
                badge(
                  entry.dns?.[kind]?.status || "pending",
                  entry.dns?.[kind]?.status === "ok" ? "success" : "neutral",
                ),
              ),
            ];
          },
        );
        pane.append(
          panel(
            entry.domain,
            "ตั้ง TTL = Auto แล้วตรวจ records ให้ครบ",
            table(["Record", "Value", ""], rows),
            h(
              "div",
              { class: "panel-body actions" },
              button("Check all DNS", async () => {
                await act(
                  "/api/mail/domains/" +
                    encodeURIComponent(entry.domain) +
                    "/dns-check",
                  { record: "all" },
                );
              }),
            ),
          ),
        );
      }
      pane.append(
        h(
          "div",
          { class: "actions" },
          badge(mail.ptr?.status || "PTR pending"),
          button("Check PTR / rDNS", async () => act("/api/mail/ptr-check")),
        ),
      );
    }
    if (step === 4) {
      const mode = field("Delivery mode", "mode", {
        choices: [
          ["direct", "Direct MX — outbound port 25"],
          ["relay-587", "SMTP relay — port 587"],
          ["relay-2525", "SMTP relay — port 2525"],
        ],
        value:
          mail.outboundMode ||
          report?.outbound?.recommendation?.mode ||
          "relay-587",
      });
      const host = field("Relay host", "host", {
        value: mail.relay?.host || "",
        placeholder: "smtp.provider.com",
      });
      const port = field("Port", "port", {
        type: "number",
        min: 1,
        max: 65535,
        value: mail.relay?.port || 587,
      });
      const username = field("Relay username", "username", {
        value: mail.relay?.username || "",
        autocomplete: "off",
      });
      const password = field("Relay password", "password", {
        type: "password",
        autocomplete: "new-password",
        hint: mail.relay?.hasPassword
          ? "เว้นว่างเพื่อใช้รหัสผ่านเดิม"
          : "กรอก SMTP credential จาก provider",
      });
      const relay = h(
        "div",
        { class: "stack" },
        host,
        h("div", { class: "form-columns" }, port, username),
        password,
      );
      const visibility = () => {
        relay.hidden = mode.control.value === "direct";
        for (const input of relay.querySelectorAll("input"))
          input.disabled = relay.hidden;
      };
      mode.control.onchange = () => {
        if (!mail.relay?.port)
          port.control.value = mode.control.value === "relay-2525" ? 2525 : 587;
        visibility();
      };
      visibility();
      const f = form(
        async (v) => {
          const payload = { mode: v.mode };
          if (v.mode !== "direct")
            payload.relay = {
              host: v.host,
              port: Number(v.port),
              username: v.username,
              password: v.password,
            };
          await act("/api/mail/outbound-mode", payload);
          password.control.value = "";
          ctx.toast("บันทึกโหมดส่งแล้ว");
        },
        mode,
        relay,
        h(
          "p",
          { class: "notice" },
          "ถ้า SMTP ทุกพอร์ตถูกบล็อค ใช้ HTTPS email API ภายนอกแทนการตั้ง mail relay บน host นี้",
        ),
        submit("Save delivery mode"),
      );
      f.addEventListener("input", mark);
      pane.append(f);
    }
    if (step === 5) {
      pane.append(
        h(
          "p",
          { class: "notice warning" },
          "ขั้นนี้ติดตั้ง package เขียน configuration และเปิดพอร์ตบน host จริง ตรวจ hostname, domain และ delivery mode ก่อนยืนยัน",
        ),
        h(
          "dl",
          { class: "key-values" },
          h("dt", {}, "Hostname"),
          h("dd", {}, mail.hostname),
          h("dt", {}, "Domains"),
          h("dd", {}, mail.domains.map((x) => x.domain).join(", ")),
          h("dt", {}, "Delivery"),
          h("dd", {}, mail.outboundMode),
        ),
        h(
          "div",
          { class: "actions" },
          badge(
            data.tool?.status === "Installed"
              ? "Packages ready"
              : "Packages required",
            data.tool?.status === "Installed" ? "success" : "neutral",
          ),
          data.tool?.status !== "Installed" &&
            button(
              "Install mail packages",
              async () => {
                if (
                  await ctx.confirm(
                    "ติดตั้ง Mail packages?",
                    "ติดตั้ง Postfix, Dovecot และ OpenDKIM บนโฮสต์นี้",
                    "Install",
                  )
                )
                  await act("/api/tools/mail/install", { confirm: true });
              },
              "primary",
            ),
          button("Verify installed packages", async () =>
            act("/api/tools/mail/manual-verify", { confirm: true }),
          ),
        ),
        button(
          "Activate mail service",
          async () => {
            if (
              await ctx.confirm(
                "Activate mail service?",
                `ใช้ ${mail.hostname} และ ${mail.domains.length} domains ระบบจะเขียน config และเปิด service บน host`,
                "Activate",
              )
            ) {
              await act("/api/mail/configure", { confirm: true });
              ctx.toast("ตั้งค่า Mail service แล้ว");
            }
          },
          "primary",
        ),
        mail.configure &&
          h("pre", { class: "code" }, JSON.stringify(mail.configure, null, 2)),
      );
    }
    if (step === 6) {
      pane.append(
        h(
          "p",
          { class: "muted" },
          "สร้าง mailbox สำหรับ IMAP/SMTP รหัสผ่านจะไม่แสดงค่าเดิมอีก",
        ),
      );
      for (const m of mail.mailboxes)
        pane.append(
          h(
            "div",
            { class: "list-row" },
            h(
              "div",
              {},
              h("strong", {}, `${m.localPart}@${m.domain}`),
              h("small", {}, m.displayName || ""),
            ),
            button(
              "Delete",
              async () => {
                if (
                  await ctx.confirm(
                    "ลบ mailbox?",
                    `${m.localPart}@${m.domain} จะใช้งานไม่ได้`,
                    "Delete",
                  )
                )
                  await act("/api/mail/mailboxes/" + m.id, {}, "delete");
              },
              "danger small",
            ),
          ),
        );
      const pass = field("Mailbox password", "password", {
        type: "password",
        required: true,
        minLength: 12,
        autocomplete: "new-password",
      });
      const f = form(
        async (v) => {
          await act("/api/mail/mailboxes", v);
          pass.control.value = "";
          ctx.toast("สร้าง mailbox แล้ว");
        },
        h(
          "div",
          { class: "form-columns" },
          field("Local part", "localPart", {
            required: true,
            placeholder: "hello",
          }),
          field("Domain", "domain", {
            choices: mail.domains.map((x) => x.domain),
            required: true,
          }),
        ),
        field("Display name", "displayName"),
        pass,
        submit("Create mailbox"),
      );
      f.addEventListener("input", mark);
      pane.append(f);
    }
    if (step === 7) {
      pane.append(
        h(
          "p",
          { class: "notice" },
          "การทดสอบนี้ส่งอีเมลจริงไปยังผู้รับที่ระบุ ใช้อีเมลของคุณเองเพื่อตรวจการรับส่ง",
        ),
        form(
          async (v) => {
            if (
              !(await ctx.confirm(
                "ส่งอีเมลทดสอบ?",
                `ส่งจาก mailbox ที่เลือกถึง ${v.to}`,
                "ส่งอีเมลทดสอบ",
              ))
            )
              return;
            const result = await ctx.api.post("/api/mail/test/send", v);
            await reload();
            paint();
            ctx.toast(result.test?.detail || "ส่งคำขอทดสอบแล้ว");
          },
          field("Send from", "mailboxId", {
            choices: mail.mailboxes.map((m) => [
              m.id,
              m.localPart + "@" + m.domain,
            ]),
            required: true,
          }),
          field("Send to", "to", {
            type: "email",
            required: true,
            placeholder: "you@example.com",
          }),
          submit("Send test email"),
        ),
        mail.lastTest &&
          h("pre", { class: "code" }, JSON.stringify(mail.lastTest, null, 2)),
      );
    }
    pane.append(next());
  };
  paint();
}
