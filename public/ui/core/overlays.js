import { h, button, icon, field, submit } from "./dom.js";
const openDialogs = new Set();
export function toast(message, error = false) {
  const region = document.querySelector("#notifications");
  if (!region) return;
  const note = h(
    "div",
    {
      class: `toast ${error ? "error" : ""}`,
      role: error ? "alert" : "status",
    },
    icon(error ? "close" : "check"),
    message,
  );
  region.append(note);
  setTimeout(() => note.remove(), 4500);
}
export function dialog(title, options = {}) {
  const body = h("div", { class: "dialog-body" });
  const actions = h("footer", { class: "dialog-actions" });
  const meta = h("div", { class: "dialog-meta" });
  const node = h("dialog", {
    class: `dialog ${options.sheet ? "sheet" : ""} ${options.wide ? "wide" : ""}`,
    "aria-label": title,
  });
  let dirty = false,
    closing = false;
  const handle = {
    node,
    body,
    actions,
    meta,
    dirty: (value = true) => {
      dirty = value;
    },
    onClosed: null,
    close: async (force = false) => {
      if (closing) return false;
      closing = true;
      try {
        if (
          dirty &&
          !force &&
          !(await confirm(
            "ทิ้งการแก้ไขที่ยังไม่บันทึก?",
            "ค่าที่แก้ไว้ในหน้าต่างนี้จะหายไป",
            "ทิ้งการแก้ไข",
          ))
        )
          return false;
        node.close();
        return true;
      } finally {
        closing = false;
      }
    },
  };
  node.append(
    h(
      "header",
      { class: "dialog-head" },
      h(
        "div",
        {},
        h(
          "span",
          { class: "overline" },
          options.sheet ? "APPLICATION WORKSPACE" : "STRCKRO",
        ),
        h("h2", {}, title),
        meta,
      ),
      button(icon("close"), () => handle.close(), "icon", {
        "aria-label": "ปิด",
      }),
    ),
    body,
    actions,
  );
  node.addEventListener("cancel", (e) => {
    e.preventDefault();
    void handle.close();
  });
  node.addEventListener("click", (e) => {
    if (e.target === node) {
      const b = node.getBoundingClientRect();
      if (
        e.clientX < b.left ||
        e.clientX > b.right ||
        e.clientY < b.top ||
        e.clientY > b.bottom
      )
        void handle.close();
    }
  });
  node.addEventListener("close", () => {
    openDialogs.delete(handle);
    handle.onClosed?.();
    node.remove();
  });
  openDialogs.add(handle);
  document.body.append(node);
  node.showModal();
  // Start on the dialog itself: the first control keeps its keyboard order
  // without opening with a focus ring on the close button.
  node.tabIndex = -1;
  node.focus({ preventScroll: true });
  return handle;
}
export async function closeDialogs() {
  for (const handle of [...openDialogs].reverse())
    if (!(await handle.close())) return false;
  return true;
}
export function confirm(title, description, accept = "ยืนยัน", exact) {
  return new Promise((resolve) => {
    const d = dialog(title);
    d.body.append(h("p", { class: "muted" }, description));
    const ok = button(
      accept,
      () => {
        resolve(true);
        void d.close(true);
      },
      exact ? "danger" : "primary",
    );
    if (exact) {
      const f = field(`พิมพ์ ${exact} เพื่อยืนยัน`, "confirmation", {
        autocomplete: "off",
      });
      ok.disabled = true;
      f.control.oninput = () => {
        ok.disabled = f.control.value !== exact;
      };
      d.body.append(f);
    }
    d.actions.append(
      button("ยกเลิก", () => d.close(true)),
      ok,
    );
    d.onClosed = () => resolve(false);
  });
}
export function secretReveal(title, value) {
  const d = dialog(title);
  const text = field("แสดงครั้งเดียว คัดลอกไปเก็บใน secret manager", "secret", {
    type: "textarea",
    value,
    readOnly: true,
    rows: 4,
    autocomplete: "off",
  });
  d.body.append(
    h("p", { class: "notice" }, "ระบบจะไม่แสดงค่านี้อีกหลังปิดหน้าต่าง"),
    text,
  );
  d.actions.append(
    button("คัดลอก", async () => {
      await navigator.clipboard.writeText(value);
      toast("คัดลอกแล้ว");
    }),
    button("ซ่อนและปิด", () => d.close(true), "primary"),
  );
  d.onClosed = () => {
    text.control.value = "";
    value = "";
  };
}
export function installFeedback() {
  document.addEventListener("app-error", (e) =>
    toast(e.detail?.message || "ดำเนินการไม่สำเร็จ", true),
  );
  document.addEventListener("app-toast", (e) => toast(e.detail));
}
