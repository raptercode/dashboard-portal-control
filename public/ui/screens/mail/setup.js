// First-time mail setup: connectivity → identity → DNS → delivery → activate → mailbox → test.
import {
  h,
  link,
  button,
  submit,
  field,
  form,
  heading,
  panel,
  badge,
  when,
} from "../../core/dom.js";
import { domainHealth, mailStepAvailable } from "./model.js";
import { dnsRecords, portReadout, deliveryLabel } from "./parts.js";

const stages = [
  "Connectivity",
  "Identity",
  "DNS records",
  "Delivery",
  "Activate",
  "Mailboxes",
  "Test",
];
const TEST_TONE = { passed: "success", simulated: "neutral", failed: "danger" };

export async function wizard(ctx) {
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
      link("Mail", "/mail", "btn secondary"),
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
    const configured = mail.configure?.status === "configured";
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
        "ขั้น activate เปลี่ยนแปลง host จริง ส่วน DNS records เป็นหน้าที่ของผู้ให้บริการ DNS ระบบตรวจให้แต่ไม่แก้ให้",
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
        portReadout(report),
        report?.outbound?.recommendation &&
          h("p", { class: "notice" }, report.outbound.recommendation.summary),
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
          configured && " · หลัง activate แล้ว เพิ่มหรือลบโดเมนได้จากหน้า Mail → Domains โดยไม่ต้องทำขั้นตอนนี้ซ้ำ",
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
                const boxes = entry.mailboxCount || 0;
                if (
                  await ctx.confirm(
                    "ลบ mail domain?",
                    boxes
                      ? `${entry.domain} และ mailbox ${boxes} กล่องของโดเมนนี้จะถูกลบออกจากระบบ`
                      : entry.domain,
                    "Remove",
                  )
                )
                  await act(
                    "/api/mail/domains/" +
                      encodeURIComponent(entry.domain) +
                      (boxes ? "?force=true" : ""),
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
          "คัดลอก records ไปที่ผู้ให้บริการ DNS โดยตั้ง TTL = Auto การ propagate อาจใช้เวลา ขั้นนี้ไม่บล็อกขั้นถัดไป: ไปต่อได้เลยแล้วระบบจะแสดงผลตรวจล่าสุดให้ในหน้า Mail → Domains",
        ),
      );
      for (const entry of mail.domains) {
        const health = domainHealth(entry);
        pane.append(
          h(
            "section",
            { class: "panel" },
            h(
              "header",
              { class: "panel-head" },
              h("div", {}, h("h2", {}, entry.domain)),
              badge(health.label, health.tone),
            ),
            h(
              "div",
              { class: "panel-body stack" },
              dnsRecords(entry),
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
          badge(
            "PTR " + (mail.ptr?.status || "pending"),
            mail.ptr?.status === "verified" ? "success" : "neutral",
          ),
          button("Check PTR / rDNS", async () => act("/api/mail/ptr-check")),
          h(
            "small",
            {},
            "PTR ตั้งที่ผู้ให้บริการ server ไม่ใช่ที่ DNS ของโดเมน จำเป็นเฉพาะการส่งแบบ Direct MX",
          ),
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
          "ขั้นนี้ติดตั้ง package เขียน configuration และเปิดพอร์ตบน host จริง ทำครั้งเดียว: หลังจากนี้การเพิ่มหรือลบโดเมนและ mailbox ไม่ต้อง activate ซ้ำ",
        ),
        h(
          "dl",
          { class: "key-values" },
          h("dt", {}, "Hostname"),
          h("dd", {}, mail.hostname),
          h("dt", {}, "Domains"),
          h("dd", {}, mail.domains.map((x) => x.domain).join(", ")),
          h("dt", {}, "Delivery"),
          h("dd", {}, deliveryLabel(mail.outboundMode)),
          mail.configure && h("dt", {}, "Status"),
          mail.configure &&
            h(
              "dd",
              {},
              badge("Configured", "success"),
              " ",
              when(mail.configure.at),
              mail.configure.detail && h("small", {}, " · ", mail.configure.detail),
            ),
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
          configured ? "Apply configuration again" : "Activate mail service",
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
      const lastTest = h("div");
      const showLastTest = (last) => {
        mail.lastTest = last;
        lastTest.hidden = !last;
        lastTest.replaceChildren();
        if (!last) return;
        lastTest.append(
          panel(
            "Last test",
            `${last.from} → ${last.to}`,
            h(
              "div",
              { class: "panel-body actions" },
              badge(last.status, TEST_TONE[last.status] || "neutral"),
              h("small", {}, when(last.at), " · ", last.detail),
            ),
          ),
        );
      };
      showLastTest(mail.lastTest);
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
            let result;
            try {
              result = await ctx.api.post("/api/mail/test/send", v);
            } catch (error) {
              if (error.status === 422) {
                await ctx.api
                  .get("/api/mail", { force: true, ttl: 0 })
                  .then((latest) => showLastTest(latest.mail.lastTest))
                  .catch(() => {});
              }
              throw error;
            }
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
        lastTest,
        link("Open the mailbox →", "/mail", "btn"),
      );
    }
    pane.append(next());
  };
  paint();
}
