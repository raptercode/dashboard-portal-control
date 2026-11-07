import {
  h,
  icon,
  link,
  button,
  submit,
  field,
  form,
  badge,
  empty,
  table,
  copy,
  when,
} from "../core/dom.js";
import {
  MAX_DOMAINS,
  domainDnsRecords,
  domainDnsStatus,
  domainProxyStatus,
  domainReadiness,
  domainDetail,
  domainTls,
  domainError,
  needsCleanup,
} from "../core/domains.js";
const tones = { ready: "success", needs: "danger", muted: "neutral" };
// The domains of one application. Statuses are read when the pane opens and
// again after every change; while one operation runs, every control waits.
export async function domainsPane(ctx, initial, root, { reload, isOpen }) {
  const base = "/api/projects/" + encodeURIComponent(initial.slug);
  const s = {
    project: initial,
    hosts: [...(initial.domains?.hosts || [])],
    checks: { ...initial.domains?.verification },
    edges: {},
    expanded: new Map(),
    busy: false,
    target: "",
    refreshing: false,
    notice: "",
  };
  const alive = () => isOpen();
  const working = () => Boolean(s.busy || s.refreshing);
  const count = h("span", { class: "collection-count" });
  const refreshButton = button(
    [icon("refresh"), "Refresh"],
    () => refreshStatuses(),
    "small",
  );
  const verifyAll = button(
    "Verify all",
    () => mutate("domains/verify", {}, { action: "verify" }),
    "small",
  );
  const notice = h("p", { class: "notice", hidden: true });
  const retry = button(
    "ลองถอดโดเมนที่ค้างอีกครั้ง",
    () =>
      mutate("domains", { domains: s.hosts }, { action: "remove", hostname: "" }),
    "small",
  );
  const hostname = field("Domain", "hostname", {
    required: true,
    placeholder: "app.example.com",
    autocomplete: "off",
  });
  const addForm = form(
    async (values) => {
      const name = values.hostname.trim().toLowerCase().replace(/\.$/, "");
      if (!name) throw new Error("กรุณากรอกโดเมน");
      if (s.hosts.includes(name))
        throw new Error("โดเมนนี้อยู่ในโปรเจคแล้ว กด Verify ที่โดเมนนั้นได้เลย");
      if (s.hosts.length >= MAX_DOMAINS)
        throw new Error(`เพิ่มได้ไม่เกิน ${MAX_DOMAINS} โดเมน`);
      await mutate(
        "domains",
        { domains: [...s.hosts, name], sync: false },
        { action: "add", hostname: name },
      );
      hostname.control.value = "";
    },
    h("div", { class: "inline-form" }, hostname, submit("เพิ่มโดเมน")),
  );
  const list = h("div", { class: "stack" });
  root.append(
    h(
      "p",
      { class: "muted" },
      "เพิ่มโดเมน ตั้ง DNS ที่ provider แล้ว Verify เพื่อเปิด Nginx/TLS บน host · Refresh ตรวจสถานะเท่านั้น ไม่เปลี่ยนค่าใดๆ",
    ),
    h(
      "div",
      { class: "actions spread" },
      count,
      h("div", { class: "actions" }, refreshButton, verifyAll),
    ),
    notice,
    addForm,
    list,
  );
  function paint() {
    const locked = working();
    for (const control of [refreshButton, verifyAll, retry])
      control.disabled = locked;
    verifyAll.disabled ||= !s.hosts.length;
    hostname.control.disabled = locked || s.hosts.length >= MAX_DOMAINS;
    const add = addForm.querySelector("button[type=submit]");
    add.disabled = locked || s.hosts.length >= MAX_DOMAINS;
    addForm.setAttribute("aria-busy", String(locked));
    count.textContent = `${s.hosts.length}/${MAX_DOMAINS} โดเมน`;
    const failed = s.project.domains?.syncError;
    notice.hidden = !(failed || s.notice);
    notice.className = failed ? "notice danger" : "notice";
    notice.setAttribute("role", failed ? "alert" : "status");
    notice.replaceChildren(
      failed || s.notice,
      needsCleanup(s.project.domains) && h("div", { class: "actions" }, retry),
    );
    list.replaceChildren(
      ...(s.hosts.length
        ? s.hosts.map(card)
        : [
            empty(
              "ยังไม่มีโดเมน",
              "Web app deploy ผ่านพอร์ตได้ก่อน แล้วเพิ่มโดเมนภายหลัง",
            ),
          ]),
    );
  }
  function card(host) {
    const dns = s.checks[host];
    const edge = s.edges[host];
    const readiness = domainReadiness(dns, edge);
    const syncError = s.project.domains?.syncError;
    if (syncError && !edge?.passed && ["ok", "proxied"].includes(dns?.status)) {
      readiness.label = "Configuration Error";
      readiness.variant = "needs";
    }
    const verifying = s.busy === "verify" && (!s.target || s.target === host);
    const tls = domainTls(edge);
    const records = domainDnsRecords(host, dns);
    const disclosure = h("details", { class: "disclosure" });
    disclosure.open = s.expanded.has(host)
      ? s.expanded.get(host)
      : readiness.variant !== "ready";
    // Remember only what the user opened or closed, not what a repaint set.
    const summary = h("summary", {}, "DNS configuration และรายละเอียด");
    summary.addEventListener("click", () =>
      s.expanded.set(host, !disclosure.open),
    );
    disclosure.append(
      summary,
      h(
        "div",
        { class: "disclosure-body" },
        h("p", { class: "muted" }, domainDetail(dns)),
        records.length
          ? table(
              ["Type", "Name", "Value", ""],
              records.map((record) => [
                h("code", {}, record.type + (record.optional ? " (ทางเลือก)" : "")),
                h("code", {}, record.name),
                h("code", {}, record.value),
                button(
                  "คัดลอก",
                  () => copy(record.value),
                  "small",
                  { "aria-label": `คัดลอก ${record.type} ${record.value}` },
                ),
              ]),
              `DNS records ${host}`,
            )
          : h(
              "p",
              { class: "muted" },
              dns?.status === "checking" || !dns
                ? "กำลังอ่าน IP ของ host…"
                : "ยังอ่าน IP สาธารณะของ host ไม่ได้ ตรวจการตั้งค่า IP ของเครื่องแล้วกด Refresh",
            ),
        records.length > 0 &&
          h(
            "small",
            {},
            "ตั้ง A ตาม IP ของ host · AAAA เป็นทางเลือกเมื่อ origin รับ IPv6 ได้ · ใส่ Name เป็น hostname เต็ม หรือชื่อย่อยตามรูปแบบของผู้ให้บริการ DNS",
          ),
        dns?.resolved?.length > 0 &&
          h("small", { class: "mono" }, `DNS ที่พบ: ${dns.resolved.join(", ")}`),
        h(
          "small",
          {},
          "สถานะ Cloudflare Proxy อนุมานจาก DNS สาธารณะ ส่วน TLS ตรวจ certificate ของ origin แยกจาก certificate ที่ CDN แสดงให้ผู้เข้าชม",
        ),
        edge?.checks?.length > 0 &&
          h(
            "ul",
            { class: "edge-checks", "aria-label": `Nginx / TLS ${host}` },
            ...edge.checks.map((item) =>
              h(
                "li",
                { class: item.ok ? "ok" : "fail" },
                h("b", {}, item.ok ? "ผ่าน" : "ไม่ผ่าน"),
                h("span", {}, item.detail),
              ),
            ),
          ),
      ),
    );
    return h(
      "article",
      { class: "panel domain-card" },
      h(
        "header",
        { class: "panel-head" },
        h(
          "div",
          {},
          h(
            "h2",
            {},
            link(host, `https://${host}`, "", {
              target: "_blank",
              rel: "noopener noreferrer",
            }),
          ),
          edge?.tls?.expiresAt &&
            h(
              "p",
              {},
              `Origin certificate หมดอายุ ${new Date(edge.tls.expiresAt).toLocaleDateString("th-TH")}`,
            ),
        ),
        h(
          "div",
          { class: "actions" },
          badge(
            verifying ? "Verifying…" : readiness.label,
            verifying ? "pending" : tones[readiness.variant],
          ),
          button(
            "Verify",
            () => mutate("domains/verify", { hostname: host }, { action: "verify", hostname: host }),
            "small",
            { disabled: working() },
          ),
          button("ลบ", () => remove(host), "danger small", {
            disabled: working(),
          }),
        ),
      ),
      h(
        "div",
        { class: "panel-body chips" },
        badge(
          domainDnsStatus(dns),
          ["ok", "proxied"].includes(dns?.status) ? "success" : "neutral",
        ),
        badge(domainProxyStatus(dns), "neutral"),
        badge(tls.text, tls.ready ? "success" : "neutral"),
      ),
      disclosure,
    );
  }
  async function refreshStatuses(hosts = s.hosts) {
    if (working() || !hosts.length) return;
    s.refreshing = true;
    for (const name of hosts) {
      s.checks[name] = { status: "checking" };
      s.edges[name] = { status: "checking" };
    }
    paint();
    try {
      await Promise.all(
        hosts.map(async (name) => {
          const [dns, edge] = await Promise.all([
            ctx.api
              .post(`${base}/domains/check`, { hostname: name })
              .catch((error) => ({ status: "error", detail: error.message })),
            ctx.api.post(`${base}/edge/check`, { hostname: name }).catch((error) => ({
              status: "error",
              checks: [{ id: "host", ok: false, detail: error.message }],
            })),
          ]);
          if (!alive()) return;
          s.checks[name] = dns;
          s.edges[name] = edge;
          paint();
        }),
      );
    } finally {
      s.refreshing = false;
      if (alive()) paint();
    }
  }
  async function mutate(operation, body, { action, hostname: target } = {}) {
    if (working()) return;
    s.busy = action;
    s.target = target;
    s.notice = "";
    paint();
    try {
      const result = await ctx.api.post(`${base}/${operation}`, body);
      if (!alive()) return;
      if (result.project) {
        s.project = result.project;
        s.hosts = [...result.project.domains.hosts];
      }
      s.notice = result.domainSync?.detail || "";
      if (action === "add") s.expanded.set(target, true);
      if (result.checks) Object.assign(s.checks, result.checks);
      ctx.toast(
        result.domainSync?.detail || "บันทึกโดเมนแล้ว",
        result.domainSync?.status === "failed",
      );
    } catch (error) {
      throw domainError(error);
    } finally {
      s.busy = false;
      if (alive()) paint();
    }
    if (!alive()) return;
    document.dispatchEvent(new CustomEvent("strckro:projects-changed"));
    await refreshStatuses();
    try {
      s.project = (await reload()) || s.project;
    } catch {
      ctx.toast("โหลดรายการโปรเจคใหม่ไม่สำเร็จ กด Refresh เพื่อตรวจรายการ", true);
    }
    if (alive()) paint();
  }
  async function remove(name) {
    if (working()) return;
    if (
      !(await ctx.confirm(
        "ลบโดเมน",
        `ลบ ${name} ออกจากโปรเจคและ Nginx หรือไม่? แอปยังทำงานที่พอร์ตเดิม`,
        "ลบ",
      ))
    )
      return;
    if (!alive()) return;
    await mutate(
      "domains",
      { domains: s.hosts.filter((host) => host !== name) },
      { action: "remove", hostname: name },
    );
  }
  paint();
  void refreshStatuses();
}
