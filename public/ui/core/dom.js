import { logoUrl } from "./runtimes.js";
// Screens compose DOM with `condition && node`. h() already skips those empty
// values, but native append() would print "null" and "false" as text. Treat the
// whole tree the same way, so a missing optional never reaches the page.
if (typeof Element !== "undefined") {
  for (const method of ["append", "prepend", "replaceChildren"]) {
    const native = Element.prototype[method];
    Element.prototype[method] = function (...nodes) {
      return native.apply(
        this,
        nodes.flat(Infinity).filter((node) => node != null && node !== false),
      );
    };
  }
}
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key.startsWith("on"))
      el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "dataset") Object.assign(el.dataset, value);
    else if (key in el && !key.startsWith("aria")) el[key] = value;
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat(Infinity))
    if (child != null && child !== false)
      el.append(
        child instanceof Node ? child : document.createTextNode(String(child)),
      );
  return el;
}
const paths = {
  plus: "M12 5v14M5 12h14",
  arrow: "M5 12h14m-6-6 6 6-6 6",
  chevron: "m9 5 7 7-7 7",
  close: "m6 6 12 12M6 18 18 6",
  search: "m20 20-5-5M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14",
  grid: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  activity: "m2 12 5 0 3-8 4 16 3-8h5",
  server: "M4 3h16v7H4zM4 14h16v7H4zM7 7h.01M7 18h.01",
  layers: "m3 7 9-4 9 4-9 4-9-4zm0 5 9 4 9-4M3 17l9 4 9-4",
  terminal: "m4 6 6 6-6 6m9 0h7",
  settings:
    "M12 3v3m0 12v3M3 12h3m12 0h3M6 6l2 2m8 8 2 2M6 18l2-2M16 8l2-2M16 12a4 4 0 1 0-8 0 4 4 0 0 0 8 0",
  check: "m5 12 4 4L19 6",
  menu: "M4 6h16M4 12h16M4 18h16",
  refresh: "M20 8a8 8 0 1 0 0 8m0-13v5h-5",
  mail: "M3 5h18v14H3zM3 5l9 8 9-8",
  key: "M14 9a5 5 0 1 0-5 5l9-9 3 3-3 3-2-2",
  users:
    "M4 21v-3a5 5 0 0 1 10 0v3m2-17a4 4 0 0 1 0 8m4 9v-3a5 5 0 0 0-3-4M13 7a4 4 0 1 0-8 0 4 4 0 0 0 8 0",
  moon: "M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10",
  logout: "M9 3H4v18h5m5-15 6 6-6 6m-6-6h12",
  copy: "M9 9h12v12H9zM15 9V3H3v12h6",
  database:
    "M20 6c0 2-4 3-8 3S4 8 4 6s4-3 8-3 8 1 8 3zm0 0v12c0 2-4 3-8 3s-8-1-8-3V6m0 6c0 2 4 3 8 3s8-1 8-3",
  deploy: "M12 16V4m0 0L7 9m5-5 5 5M4 20h16",
  plug: "M9 3v5m6-5v5M6 8h12v3a6 6 0 0 1-12 0V8zm6 9v4",
  sun: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8m-8 9a8 8 0 0 1 16 0",
  dots: "M5 12h.01M12 12h.01M19 12h.01",
  external: "M14 4h6v6m0-6-9 9M18 14v5H5V6h5",
};
export function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [k, v] of Object.entries({
    viewBox: "0 0 24 24",
    class: "i",
    "aria-hidden": "true",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.6",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  }))
    svg.setAttribute(k, v);
  const path = document.createElementNS(svg.namespaceURI, "path");
  path.setAttribute("d", paths[name] || paths.grid);
  svg.append(path);
  return svg;
}
export const link = (text, href, cls = "", attributes = {}) =>
  h("a", { href, class: cls, ...attributes }, text);
export const badge = (text, tone = "neutral") =>
  h("span", { class: `badge ${tone}` }, h("i"), text);
const SVG_NS = "http://www.w3.org/2000/svg";
export function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs))
    if (value != null) el.setAttribute(key, String(value));
  el.append(...children);
  return el;
}
// A quiet track with two stations: the product's own mark, used for empty states.
export function glyph() {
  return svg(
    "svg",
    { viewBox: "0 0 96 56", class: "glyph", "aria-hidden": "true", fill: "none" },
    svg("path", {
      d: "M10 14H36L50 28H70L84 42",
      stroke: "currentColor",
      "stroke-width": 2,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      opacity: 0.55,
    }),
    svg("circle", {
      cx: 10,
      cy: 14,
      r: 4.5,
      fill: "var(--card)",
      stroke: "currentColor",
      "stroke-width": 2,
    }),
    svg("circle", { cx: 43, cy: 21, r: 2.4, fill: "currentColor" }),
    svg("circle", {
      cx: 84,
      cy: 42,
      r: 4.5,
      fill: "var(--signal)",
      stroke: "var(--signal-edge)",
      "stroke-width": 2,
    }),
  );
}
// A tile with the logo of a framework or runtime; `name` is a key of runtimes.js.
export const runtimeMark = (name) =>
  h(
    "span",
    { class: "runtime-mark" },
    h("img", {
      src: logoUrl(name),
      alt: "",
      loading: "lazy",
      onerror: (e) => e.currentTarget.remove(),
    }),
  );
export const empty = (title, copy = "", action) =>
  h(
    "div",
    { class: "empty" },
    glyph(),
    h("h3", {}, title),
    copy && h("p", {}, copy),
    action,
  );
// The track: source → build → serving. `stages` come from pipelineStages().
export function track(stages, { large = false } = {}) {
  const label = stages.map((s) => `${s.label}: ${s.detail}`).join(" · ");
  const el = h("span", {
    class: large ? "track large" : "track",
    role: "img",
    "aria-label": label,
    title: label,
  });
  stages.forEach((stage, index) => {
    if (index) el.append(h("b", { "data-state": stage.state }));
    el.append(h("i", { "data-state": stage.state }));
  });
  return el;
}
// Segmented tick gauge. 0–100; turns amber at 75 and red at 90.
export function gauge(percent, label) {
  const value = Math.min(100, Math.max(0, Number(percent) || 0));
  const el = h(
    "span",
    {
      class: "gauge",
      role: "meter",
      "aria-label": label,
      "aria-valuemin": 0,
      "aria-valuemax": 100,
      "aria-valuenow": Math.round(value),
      "data-level": value >= 90 ? "bad" : value >= 75 ? "warn" : "ok",
    },
    h("i"),
  );
  el.style.setProperty("--v", value.toFixed(1));
  return el;
}
export const page = { kicker: "Workspace" };
export const panel = (title, copy, ...body) =>
  h(
    "section",
    { class: "panel" },
    h(
      "header",
      { class: "panel-head" },
      h("div", {}, h("h2", {}, title), copy && h("p", {}, copy)),
    ),
    ...body,
  );
export function heading(title, copy, ...actions) {
  return h(
    "header",
    { class: "page-head" },
    h(
      "div",
      {},
      h("span", { class: "overline" }, page.kicker),
      h("h1", {}, title),
      copy && h("p", {}, copy),
    ),
    h("div", { class: "actions" }, ...actions),
  );
}
export function field(title, name, options = {}) {
  const { type = "text", value = "", choices, hint, ...props } = options;
  const input = choices
    ? h(
        "select",
        { name, ...props },
        ...choices.map((choice) => {
          const [v, t] = Array.isArray(choice) ? choice : [choice, choice];
          return h(
            "option",
            { value: v, selected: String(v) === String(value) },
            t,
          );
        }),
      )
    : h(type === "textarea" ? "textarea" : "input", {
        name,
        type: type === "textarea" ? undefined : type,
        value,
        ...props,
      });
  const wrap = h(
    "label",
    { class: "field" },
    h("span", {}, title),
    input,
    hint && h("small", {}, hint),
  );
  return wrap;
}
export const check = (title, name, checked = false, hint = "", value = "on") =>
  h(
    "label",
    { class: "check" },
    h("input", { type: "checkbox", name, checked, value }),
    h("span", {}, title, hint && h("small", {}, hint)),
  );
export function form(work, ...children) {
  const error = h("p", { class: "error", role: "alert", hidden: true });
  const el = h(
    "form",
    {
      class: "form",
      onsubmit: async (event) => {
        event.preventDefault();
        if (el.dataset.busy) return;
        const button = event.submitter;
        el.dataset.busy = "true";
        if (button) button.disabled = true;
        error.hidden = true;
        try {
          await work(Object.fromEntries(new FormData(el)), el, event);
        } catch (e) {
          error.textContent = e.message;
          error.hidden = false;
        } finally {
          delete el.dataset.busy;
          if (button) button.disabled = false;
        }
      },
    },
    ...children,
    error,
  );
  return el;
}
export function button(text, handler, style = "secondary", attrs = {}) {
  return h(
    "button",
    {
      type: "button",
      class: `btn ${style}`,
      ...attrs,
      onclick: async (event) => {
        const el = event.currentTarget;
        if (el.disabled) return;
        el.disabled = true;
        el.setAttribute("aria-busy", "true");
        try {
          await handler?.(el, event);
        } catch (error) {
          el.dispatchEvent(
            new CustomEvent("app-error", { bubbles: true, detail: error }),
          );
        } finally {
          el.disabled = false;
          el.removeAttribute("aria-busy");
        }
      },
    },
    text,
  );
}
export const submit = (text = "บันทึก", style = "primary") =>
  h("button", { type: "submit", class: `btn ${style}` }, text);
export function skeleton(root, label = "กำลังอ่านข้อมูล…") {
  root.replaceChildren(
    h(
      "div",
      { class: "skeleton", role: "status" },
      h("span"),
      h("span"),
      h("span"),
      h("p", {}, label),
    ),
  );
}
export function errorView(root, error, retry) {
  root.replaceChildren(
    empty("โหลดข้อมูลไม่สำเร็จ", error.message, button("ลองอีกครั้ง", retry)),
  );
}
export function table(headers, rows, label = "รายการ") {
  return h(
    "div",
    { class: "table-scroll" },
    h(
      "table",
      { "aria-label": label },
      h("thead", {}, h("tr", {}, ...headers.map((x) => h("th", {}, x)))),
      h(
        "tbody",
        {},
        ...rows.map((cells) =>
          h("tr", {}, ...cells.map((x) => h("td", {}, x))),
        ),
      ),
    ),
  );
}
export const short = (value) => (value ? String(value).slice(0, 8) : "—");
export const when = (value) =>
  value
    ? new Date(value).toLocaleString("th-TH", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
export const bytes = (value) => {
  if (!Number.isFinite(Number(value))) return "—";
  let n = Number(value),
    i = 0;
  while (n >= 1024 && i < 3) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i ? 1 : 0)} ${["B", "KB", "MB", "GB"][i]}`;
};
export const copy = async (value) => {
  await navigator.clipboard.writeText(String(value));
  document.dispatchEvent(
    new CustomEvent("app-toast", { detail: "คัดลอกแล้ว" }),
  );
};
