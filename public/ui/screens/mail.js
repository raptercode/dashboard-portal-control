// Mail: a mailbox reader (inbox, sent, compose) with domain, mailbox and server
// management beside it. First-time setup lives at /mail/setup.
import { h, link, icon, heading, panel, empty } from "../core/dom.js";
import {
  domainHealth,
  folderIcon,
  folderLabel,
  mailHref,
  mailLocation,
} from "./mail/model.js";
import { wizard } from "./mail/setup.js";
import { domainsView, mailboxesView, serverView } from "./mail/manage.js";
import { createComposer, inboxView } from "./mail/client.js";

export { mailStepAvailable } from "./mail/model.js";

const REFRESH_MS = 30_000;

export async function mount(ctx) {
  return ctx.route.id === "mail-setup" ? wizard(ctx) : workspace(ctx);
}

async function workspace(ctx) {
  const data = await ctx.api.get("/api/mail", { ttl: 0, force: true });
  if (!ctx.active()) return;
  if (data.mail.configure?.status !== "configured") {
    ctx.root.replaceChildren(
      heading(
        "Mail",
        "รับ–ส่งอีเมลของโดเมนคุณจาก host นี้ และเปิดอ่านได้จากหน้านี้",
        link("Configure mail", "/mail/setup", "btn primary"),
      ),
      panel(
        "Set up mail on your infrastructure.",
        "ตรวจ connectivity ตั้ง hostname และวิธีส่ง แล้วเปิดใช้งาน service ครั้งเดียว",
        empty(
          "Mail service is not configured.",
          "หลังตั้งค่าเสร็จ หน้านี้จะเป็นกล่องอีเมล: อ่าน Inbox ดู Sent เขียนและตอบอีเมล รวมถึงเพิ่มหรือลบโดเมนได้ทันที",
          link("Start mail setup →", "/mail/setup", "btn primary"),
        ),
      ),
    );
    return;
  }

  const side = h("aside", { class: "mail-side", "aria-label": "Mail" });
  const main = h("section", { class: "mail-main" });
  const ws = {
    ctx,
    data,
    main,
    folders: [],
    location: mailLocation(ctx.route.url),
    token: 0,
    tick: null,
    // A view checks this after every await: the reader may have moved on meanwhile.
    alive: (token) => ctx.active() && token === ws.token,
    mailbox: () => {
      const boxes = ws.data.mail.mailboxes;
      return boxes.find((box) => box.id === ws.location.box) || boxes[0] || null;
    },
    refresh: async () => {
      ws.data = await ctx.api.get("/api/mail", { ttl: 0, force: true });
      sidebar();
    },
    show: (patch = {}, { replace = false } = {}) => {
      const next = { ...ws.location, ...patch };
      // Changing folder or mailbox starts at its newest message again.
      if ("folder" in patch || "box" in patch || "view" in patch)
        Object.assign(next, { offset: patch.offset || 0, message: patch.message || "" });
      if (next.view !== "inbox") Object.assign(next, { message: "" });
      ws.location = next;
      ctx.locate(mailHref(next), { replace });
      render();
      window.scrollTo(0, 0);
    },
  };
  ws.sidebar = sidebar;
  ws.composer = createComposer(ws);

  const go = (patch) => (event) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    ws.show(patch);
  };
  const entry = (name, label, patch, { count, current, alert } = {}) => {
    const item = h(
      "a",
      { class: "mail-nav-item", href: mailHref({ ...ws.location, message: "", offset: 0, ...patch }), onclick: go(patch) },
      icon(name),
      h("span", {}, label),
      alert && h("i", { class: "mail-nav-alert", title: alert }),
      count > 0 && h("b", { class: "mail-nav-count" }, count > 999 ? "999+" : count),
    );
    if (current) item.setAttribute("aria-current", "page");
    return item;
  };

  let painted = "";
  function sidebar() {
    const mail = ws.data.mail;
    const { view, folder } = ws.location;
    const mailbox = ws.mailbox();
    const standard = ["INBOX", "Sent", "Drafts", "Junk", "Trash"];
    const known = new Map(ws.folders.map((item) => [item.id, item]));
    const folderIds = [...standard, ...ws.folders.map((item) => item.id).filter((id) => !standard.includes(id))];
    const unhealthy = mail.domains.filter((item) => domainHealth(item).id !== "ready").length;
    // Counts are refreshed in the background. Rebuilding identical links would
    // swallow a click that lands between a press and its release.
    const signature = JSON.stringify([view, folder, mailbox?.id, mail.mailboxes.map((box) => box.id), ws.folders, unhealthy]);
    if (signature === painted) return;
    painted = signature;
    side.replaceChildren(
      h(
        "button",
        { type: "button", class: "btn primary mail-compose-button", disabled: !mailbox, onclick: () => ws.composer.open() },
        icon("edit"),
        h("span", {}, "Compose"),
      ),
      mail.mailboxes.length > 1
        ? h(
            "select",
            {
              class: "mail-account",
              "aria-label": "Mailbox",
              onchange: (event) => ws.show({ view: "inbox", box: event.currentTarget.value, folder: "INBOX" }),
            },
            ...mail.mailboxes.map((box) =>
              h("option", { value: box.id, selected: box.id === mailbox?.id }, `${box.localPart}@${box.domain}`),
            ),
          )
        : mailbox && h("p", { class: "mail-account-name", title: "Mailbox" }, `${mailbox.localPart}@${mailbox.domain}`),
      h(
        "nav",
        { class: "mail-nav", "aria-label": "Folders" },
        ...folderIds.map((id) =>
          entry(folderIcon(id), folderLabel(id), { view: "inbox", folder: id }, {
            // Unread mail is what the reader acts on; Drafts shows how many are waiting.
            count: id === "Drafts" ? known.get(id)?.total : id === "Trash" ? 0 : known.get(id)?.unread,
            current: view === "inbox" && folder === id,
          }),
        ),
      ),
      h("span", { class: "mail-nav-label" }, "Manage"),
      h(
        "nav",
        { class: "mail-nav", "aria-label": "Mail management" },
        entry("globe", "Domains", { view: "domains" }, {
          current: view === "domains",
          alert: unhealthy ? `${unhealthy} โดเมนยังตั้ง DNS ไม่ครบ` : "",
        }),
        entry("users", "Mailboxes", { view: "mailboxes" }, { current: view === "mailboxes" }),
        entry("server", "Server", { view: "server" }, { current: view === "server" }),
      ),
    );
  }

  function render() {
    ws.token += 1;
    ws.tick = null;
    sidebar();
    const { view } = ws.location;
    if (view === "domains") domainsView(ws);
    else if (view === "mailboxes") mailboxesView(ws);
    else if (view === "server") serverView(ws);
    else void inboxView(ws);
  }

  ctx.root.replaceChildren(
    heading("Mail", "อ่านและส่งอีเมลของทุก mailbox พร้อมจัดการโดเมนจากที่เดียว"),
    h("div", { class: "mail-app" }, side, main),
  );
  render();
  // The unread count belongs in the sidebar on every view, not only on the inbox.
  if (ws.location.view !== "inbox" && ws.mailbox())
    void ctx.api
      .get(`/api/mail/mailboxes/${ws.mailbox().id}/folders`, { ttl: 0, force: true })
      .then((result) => {
        if (!ctx.active()) return;
        ws.folders = result.folders;
        sidebar();
      })
      .catch(() => {});
  ctx.poll(async () => {
    await ws.tick?.();
  }, REFRESH_MS);
}
