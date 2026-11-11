// Mail management views: domains, mailboxes and the server itself.
import {
  h,
  link,
  icon,
  button,
  submit,
  field,
  form,
  panel,
  empty,
  badge,
  copy,
  when,
} from "../../core/dom.js";
import {
  DNS_KINDS,
  dnsCheckDue,
  dnsStatus,
  domainHealth,
  generatePassword,
} from "./model.js";
import { dnsRecords, portReadout, deliveryLabel } from "./parts.js";

const DNS_RECHECK_MS = 90_000;

/**
 * Domains. Adding one is a single step: the Portal stores it, tells a running
 * mail service about it, and then keeps checking its DNS records by itself.
 * Nothing here waits for a manual check or for the service to be activated again.
 */
export function domainsView(ws) {
  const { ctx } = ws;
  const token = ws.token;
  const open = new Set();
  const checking = new Set();
  const list = h("div", { class: "domain-list" });
  const count = h("small", { class: "collection-count" });

  const check = async (domain, background = true) => {
    if (checking.has(domain)) return;
    checking.add(domain);
    paint();
    try {
      const data = await ctx.api.post(
        `/api/mail/domains/${encodeURIComponent(domain)}/dns-check`,
        { record: "all", background },
      );
      if (ws.alive(token)) ws.data = data;
    } finally {
      checking.delete(domain);
      if (ws.alive(token)) {
        ws.sidebar();
        paint();
      }
    }
  };
  // One domain at a time, quietly: a resolver that is slow or down is not the owner's problem to dismiss.
  const checkDue = async (stale) => {
    for (const entry of [...ws.data.mail.domains]) {
      if (!ws.alive(token)) return;
      if (!ws.data.mail.hostname || !dnsCheckDue(entry, Date.now(), stale)) continue;
      await check(entry.domain).catch(() => {});
    }
  };

  const remove = async (entry) => {
    const boxes = entry.mailboxCount || 0;
    const accepted = await ctx.confirm(
      `ลบโดเมน ${entry.domain}?`,
      boxes
        ? `mailbox ${boxes} กล่องของโดเมนนี้จะถูกลบออกจากระบบด้วย และจะรับ–ส่งอีเมลไม่ได้อีก ไฟล์อีเมลเดิมยังอยู่บน host`
        : "host จะหยุดรับอีเมลของโดเมนนี้ทันที ไม่ต้องตั้งค่า service ใหม่",
      "ลบโดเมน",
      boxes ? entry.domain : undefined,
    );
    if (!accepted) return;
    ws.data = await ctx.api.delete(
      `/api/mail/domains/${encodeURIComponent(entry.domain)}${boxes ? "?force=true" : ""}`,
    );
    open.delete(entry.domain);
    ws.sidebar();
    paint();
    ctx.toast(`ลบ ${entry.domain} แล้ว`);
  };

  function item(entry) {
    const health = domainHealth(entry);
    const busy = checking.has(entry.domain);
    const lastChecked = DNS_KINDS.map((kind) => entry.dns?.[kind]?.checkedAt)
      .filter(Boolean)
      .sort()
      .pop();
    const details = h(
      "details",
      {
        class: "domain-item",
        "data-domain": entry.domain,
        open: open.has(entry.domain),
        ontoggle: (event) => {
          if (event.currentTarget.open) open.add(entry.domain);
          else open.delete(entry.domain);
        },
      },
      h(
        "summary",
        {},
        h(
          "span",
          { class: "domain-name" },
          h("strong", {}, entry.domain),
          h(
            "small",
            {},
            `${entry.mailboxCount || 0} mailbox · เพิ่มเมื่อ `,
            when(entry.createdAt),
          ),
        ),
        h(
          "span",
          { class: "domain-dns" },
          ...DNS_KINDS.map((kind) => {
            const status = dnsStatus(entry.dns?.[kind]);
            return h(
              "span",
              { class: `dns-pill ${status.tone}`, title: `${kind.toUpperCase()}: ${status.label}` },
              kind.toUpperCase(),
            );
          }),
        ),
        busy ? badge("กำลังตรวจ DNS", "pending") : badge(health.label, health.tone),
      ),
      h(
        "div",
        { class: "domain-body" },
        h(
          "p",
          { class: health.id === "ready" ? "notice" : "notice warning" },
          health.id === "ready"
            ? "DNS ครบทุก record โดเมนนี้รับและส่งอีเมลได้เต็มที่"
            : "โดเมนนี้ใช้งานบน host ได้แล้ว เพิ่ม records ด้านล่างที่ผู้ให้บริการ DNS เพื่อให้อีเมลเข้า–ออกได้จริงและไม่ตกสแปม ระบบจะตรวจซ้ำให้เองโดยไม่ต้องกดอะไร",
        ),
        dnsRecords(entry),
        h(
          "div",
          { class: "actions spread" },
          h(
            "small",
            {},
            lastChecked ? ["ตรวจ DNS ล่าสุด ", when(lastChecked)] : "ยังไม่เคยตรวจ DNS",
          ),
          h(
            "div",
            { class: "actions" },
            button("ตรวจ DNS ตอนนี้", () => check(entry.domain, false), "small", {
              disabled: busy || !ws.data.mail.hostname,
            }),
            button("ลบโดเมน", () => remove(entry), "danger small"),
          ),
        ),
      ),
    );
    return details;
  }

  let painted = "";
  function paint() {
    const domains = ws.data.mail.domains;
    // DNS is re-checked in the background: rebuild the rows only when something changed.
    const signature = JSON.stringify([domains, [...checking], ws.data.mail.hostname]);
    if (signature === painted) return;
    painted = signature;
    count.textContent = `${domains.length} / ${ws.data.maxDomains} domains`;
    list.replaceChildren(
      ...(domains.length
        ? domains.map(item)
        : [
            empty(
              "ยังไม่มีโดเมน",
              "เพิ่มโดเมนแรกจากช่องด้านบน ที่อยู่อีเมลของโดเมนนั้นจะสร้างได้ทันที",
            ),
          ]),
    );
  }

  const full = () => ws.data.mail.domains.length >= ws.data.maxDomains;
  const addButton = submit("Add domain");
  const addForm = form(
    async (values, el) => {
      const domain = values.domain.trim().toLowerCase();
      ws.data = await ctx.api.post("/api/mail/domains", { domain });
      el.reset();
      open.add(domain);
      addButton.disabled = full();
      ws.sidebar();
      paint();
      ctx.toast(`เพิ่ม ${domain} แล้ว ใช้งานบน host ได้ทันที`);
      void check(domain).catch(() => {});
    },
    h(
      "div",
      { class: "inline-form" },
      field("Domain", "domain", {
        required: true,
        placeholder: ws.data.suggestions?.domains?.[0] || "example.com",
        autocomplete: "off",
        spellcheck: false,
        inputMode: "url",
      }),
      addButton,
    ),
    h(
      "small",
      {},
      "เพิ่มแล้วใช้ได้เลย ไม่ต้องรอตรวจ DNS และไม่ต้อง activate mail service ใหม่",
    ),
  );
  addButton.disabled = full();

  ws.main.replaceChildren(
    h(
      "section",
      { class: "panel" },
      h(
        "header",
        { class: "panel-head" },
        h(
          "div",
          {},
          h("h2", {}, "Mail domains"),
          h("p", {}, "โดเมนที่ host นี้รับ–ส่งอีเมลให้ แต่ละโดเมนมี DNS records ของตัวเอง"),
        ),
        count,
      ),
      addForm,
      list,
    ),
  );
  paint();
  void checkDue(6 * 60 * 60 * 1000);
  let last = Date.now();
  ws.tick = () => {
    // Only records that are not verified yet are worth asking again this often.
    if (Date.now() - last < DNS_RECHECK_MS) return;
    last = Date.now();
    return checkDue(Number.POSITIVE_INFINITY);
  };
}

export function mailboxesView(ws) {
  const { ctx } = ws;
  const mail = ws.data.mail;
  const rows = h("div", { class: "mailbox-list" });

  const remove = async (mailbox) => {
    const address = `${mailbox.localPart}@${mailbox.domain}`;
    if (
      !(await ctx.confirm(
        "ลบ mailbox?",
        `${address} จะรับ–ส่งและเข้าใช้งานไม่ได้อีก ไฟล์อีเมลเดิมยังอยู่บน host`,
        "ลบ mailbox",
        address,
      ))
    )
      return;
    await ctx.api.delete(`/api/mail/mailboxes/${mailbox.id}`);
    await ws.refresh();
    mailboxesView(ws);
    ctx.toast(`ลบ ${address} แล้ว`);
  };

  rows.append(
    ...(mail.mailboxes.length
      ? mail.mailboxes.map((mailbox) => {
          const address = `${mailbox.localPart}@${mailbox.domain}`;
          return h(
            "div",
            { class: "list-row" },
            h(
              "div",
              {},
              h("strong", {}, address),
              h("small", {}, mailbox.displayName || "ไม่มีชื่อที่แสดง", " · สร้างเมื่อ ", when(mailbox.createdAt)),
            ),
            h(
              "div",
              { class: "actions" },
              button("Open inbox", () => ws.show({ view: "inbox", box: mailbox.id, folder: "INBOX", offset: 0, message: "" }), "small"),
              button(icon("copy"), () => copy(address), "icon", { "aria-label": `คัดลอก ${address}`, title: "คัดลอกที่อยู่" }),
              button(icon("trash"), () => remove(mailbox), "icon", { "aria-label": `ลบ ${address}`, title: "ลบ mailbox" }),
            ),
          );
        })
      : [empty("ยังไม่มี mailbox", "สร้าง mailbox แรกจากแบบฟอร์มด้านข้าง")]),
  );

  const password = field("Password", "password", {
    type: "password",
    required: true,
    minLength: 12,
    autocomplete: "new-password",
    hint: "อย่างน้อย 12 ตัวอักษร ใช้เข้า IMAP / SMTP จากโปรแกรมอีเมล ระบบไม่เก็บและไม่แสดงค่านี้อีก",
  });
  const create = mail.domains.length
    ? form(
        async (values, el) => {
          const result = await ctx.api.post("/api/mail/mailboxes", {
            localPart: values.localPart.trim(),
            domain: values.domain,
            displayName: values.displayName.trim(),
            password: values.password,
          });
          el.reset();
          password.control.type = "password";
          await ws.refresh();
          mailboxesView(ws);
          ctx.toast(`สร้าง ${result.mailbox.localPart}@${result.mailbox.domain} แล้ว`);
        },
        h(
          "div",
          { class: "address-field" },
          field("Address", "localPart", {
            required: true,
            placeholder: "hello",
            autocomplete: "off",
            spellcheck: false,
          }),
          h("span", { "aria-hidden": "true" }, "@"),
          field("Domain", "domain", {
            choices: mail.domains.map((entry) => entry.domain),
            required: true,
          }),
        ),
        field("Display name", "displayName", {
          placeholder: "ชื่อที่ผู้รับเห็น เช่น Support Team",
          maxLength: 100,
        }),
        password,
        h(
          "div",
          { class: "actions spread" },
          button(
            "Generate & copy",
            async () => {
              password.control.type = "text";
              password.control.value = generatePassword();
              await copy(password.control.value);
            },
            "small",
          ),
          submit("Create mailbox"),
        ),
      )
    : empty(
        "เพิ่มโดเมนก่อน",
        "mailbox ต้องอยู่ใต้โดเมนที่ host นี้ดูแล",
        button("ไปที่ Domains", () => ws.show({ view: "domains" }), "primary"),
      );

  ws.tick = null;
  ws.main.replaceChildren(
    h(
      "div",
      { class: "split" },
      panel(
        "Mailboxes",
        "ที่อยู่อีเมลบน host นี้ เปิดอ่านได้จากหน้านี้หรือจากโปรแกรมอีเมลผ่าน IMAP",
        rows,
      ),
      panel("New mailbox", "สร้างแล้วรับ–ส่งได้ทันที", create),
    ),
  );
}

const CHECK_TONE = { ok: "success", verified: "success", pending: "neutral" };

export function serverView(ws) {
  const { ctx } = ws;
  const mail = ws.data.mail;
  const allowed = (port) =>
    mail.readiness?.inbound?.ports?.some(
      (item) => Number(item.port) === port && item.status === "allowed",
    );
  const clientSettings = [
    allowed(993) && ["IMAP (อ่านเมล)", `${mail.hostname} · พอร์ต 993 · SSL/TLS`],
    allowed(587) && ["SMTP (ส่งเมล)", `${mail.hostname} · พอร์ต 587 · STARTTLS`],
  ].filter(Boolean);
  const apply = async () => {
    if (
      !(await ctx.confirm(
        "ตั้งค่า mail service อีกครั้ง?",
        "ใช้เมื่อเปลี่ยน hostname, วิธีส่ง หรือ policy ของพอร์ต ระบบจะเขียน configuration ใหม่และ restart Postfix / Dovecot / OpenDKIM การเพิ่มหรือลบโดเมนไม่ต้องทำขั้นนี้",
        "Apply",
      ))
    )
      return;
    ws.data = await ctx.api.post("/api/mail/configure", { confirm: true });
    serverView(ws);
    ctx.toast("ตั้งค่า Mail service แล้ว");
  };
  const recheck = async () => {
    await ctx.api.post("/api/mail/readiness-check");
    await ws.refresh();
    serverView(ws);
    ctx.toast("ตรวจ connectivity แล้ว");
  };
  const state = (record) =>
    badge(record?.status || "pending", CHECK_TONE[record?.status] || "warn");

  ws.tick = null;
  ws.main.replaceChildren(
    h(
      "div",
      { class: "stack" },
      panel(
        "Mail server",
        "ตัวตนของ SMTP server และวิธีส่งอีเมลออก",
        h(
          "dl",
          { class: "panel-body key-values" },
          h("dt", {}, "Mail hostname"),
          h("dd", {}, h("code", {}, mail.hostname), " ", state(mail.hostnameCheck)),
          h("dt", {}, "Delivery"),
          h("dd", {}, deliveryLabel(mail.outboundMode)),
          mail.outboundMode === "direct" && h("dt", {}, "PTR / rDNS"),
          mail.outboundMode === "direct" &&
            h("dd", {}, state(mail.ptr), mail.ptr?.detail && h("small", {}, " ", mail.ptr.detail)),
          mail.relay && h("dt", {}, "Relay"),
          mail.relay && h("dd", {}, h("code", {}, `${mail.relay.host}:${mail.relay.port}`)),
          h("dt", {}, "Configured"),
          h(
            "dd",
            {},
            when(mail.configure?.at),
            mail.configure?.detail && h("small", {}, " · ", mail.configure.detail),
          ),
        ),
        h(
          "div",
          { class: "panel-body actions" },
          link("Open setup steps", "/mail/setup", "btn"),
          button("Apply configuration again", apply),
        ),
      ),
      panel(
        "Mail client settings",
        "ใช้ที่อยู่อีเมลเต็มเป็น username และรหัสผ่านของ mailbox นั้น",
        clientSettings.length
          ? h(
              "dl",
              { class: "panel-body key-values" },
              ...clientSettings.flatMap(([name, value]) => [
                h("dt", {}, name),
                h("dd", {}, h("code", {}, value)),
              ]),
            )
          : h(
              "p",
              { class: "panel-body muted" },
              "ยังไม่มีพอร์ตขาเข้าที่ firewall ของ host อนุญาต จึงเปิดอ่านได้จากหน้านี้เท่านั้น อนุญาตพอร์ต 993 / 587 ใน UFW แล้วตั้งค่า service อีกครั้งเพื่อใช้โปรแกรมอีเมล",
            ),
      ),
      panel(
        "Connectivity",
        "ผลตรวจพอร์ตล่าสุดที่ใช้ตัดสินว่าจะเปิด service ใดบ้าง",
        h("div", { class: "panel-body stack" }, portReadout(mail.readiness), button("Check again", recheck)),
      ),
    ),
  );
}
