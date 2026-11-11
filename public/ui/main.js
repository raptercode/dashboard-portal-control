import {
  h,
  icon,
  link,
  button,
  empty,
  skeleton,
  errorView,
  page,
} from "./core/dom.js";
import { createApi } from "./core/api.js";
import { routeFor, navigation, can } from "./core/model.js";
import {
  dialog,
  confirm,
  toast,
  closeDialogs,
  installFeedback,
} from "./core/overlays.js";

const modules = {
  workspace: () => import("./screens/workspace.js"),
  project: () => import("./screens/project.js"),
  infrastructure: () => import("./screens/infrastructure.js"),
  mail: () => import("./screens/mail.js"),
  access: () => import("./screens/access.js"),
  settings: () => import("./screens/settings.js"),
  auth: () => import("./screens/auth.js"),
};
const host = document.querySelector("#strckro");
const state = { session: null, access: null };
let generation = 0,
  dispose = () => {},
  beforeLeave = null,
  authenticating = false;
let activeUrl = location.href,
  historyIndex = Number(history.state?.strckroIndex) || 0,
  restoringHistory = false;
const scrollPositions = new Map();
history.replaceState(
  { ...history.state, strckroIndex: historyIndex },
  "",
  location.href,
);
const api = createApi({
  onUnauthorized: () => {
    if (state.session?.authenticated) {
      state.session = null;
      state.access = null;
      api.clear();
      void start();
    }
  },
});
installFeedback();
const content = h("main", { id: "content", tabIndex: -1 });
const rail = h("aside", {
  class: "rail",
  id: "rail",
  "aria-label": "เมนูหลัก",
});
const scrim = h("div", { class: "rail-scrim", hidden: true });
const identity = h("span", { class: "identity", role: "img" });
const mode = h("span", { class: "connection" });
const navIcons = {
  "/": "grid",
  "/projects": "layers",
  "/deployments": "deploy",
  "/activity": "activity",
  "/setup": "server",
  "/databases": "database",
  "/mail": "mail",
  "/members": "users",
  "/credentials": "key",
  "/settings/account": "terminal",
  "/settings/updates": "refresh",
  "/settings/monitor": "plug",
};
const paintTheme = () =>
  themeButton.replaceChildren(
    icon(document.documentElement.dataset.theme === "dark" ? "sun" : "moon"),
  );
const themeButton = button(
  icon("moon"),
  () => {
    const next =
      document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("strckro.theme", next);
    } catch {}
    paintTheme();
  },
  "icon",
  { "aria-label": "สลับธีม" },
);
paintTheme();
const menuButton = button(
  icon("menu"),
  () => setRail(!rail.hasAttribute("data-open")),
  "icon strip-menu",
  { "aria-label": "เมนู", "aria-controls": "rail", "aria-expanded": "false" },
);
const searchButton = button(
  [
    icon("search"),
    h("span", {}, "ค้นหาหรือไปที่…"),
    h("kbd", {}, /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘ K" : "Ctrl K"),
  ],
  openSearch,
  "search-button",
  { "aria-label": "ค้นหาใน workspace" },
);
const globalCreate = link(
  [icon("plus"), h("span", {}, "New application")],
  "/projects/new",
  "btn primary global-create",
  { "aria-label": "New application" },
);
const shell = h(
  "div",
  { class: "app" },
  h("a", { href: "#content", class: "skip" }, "ข้ามไปเนื้อหา"),
  h(
    "header",
    { class: "strip" },
    menuButton,
    link(
      [
        h("img", { src: "/ui/brand/logo.svg", width: 30, height: 30, alt: "" }),
        h("strong", {}, "strckro", h("i", {}, ".")),
      ],
      "/",
      "brand",
      { "aria-label": "Strckro" },
    ),
    searchButton,
    h(
      "div",
      { class: "head-actions" },
      mode,
      globalCreate,
      themeButton,
      button(
        icon("logout"),
        async () => {
          if (
            !(await confirm(
              "ออกจากระบบ?",
              "คุณสามารถเข้าสู่ระบบใหม่ได้ทุกเมื่อ",
              "ออกจากระบบ",
            ))
          )
            return;
          await api.post("/api/logout");
          api.clear();
          state.access = null;
          state.session = null;
          await start();
        },
        "icon",
        { "aria-label": "ออกจากระบบ" },
      ),
      identity,
    ),
  ),
  h("div", { class: "frame" }, rail, scrim, content),
);
scrim.addEventListener("click", () => setRail(false));
function setRail(open) {
  rail.toggleAttribute("data-open", open);
  scrim.hidden = !open;
  menuButton.setAttribute("aria-expanded", String(open));
  if (open) rail.querySelector("a")?.focus();
}
function drawNavigation(route) {
  const groups = navigation(state.access);
  page.kicker =
    (groups.find((g) => g.id === route.group) || groups[0])?.label ||
    "Workspace";
  rail.replaceChildren(
    ...groups.map((group) =>
      h(
        "div",
        { class: "rail-group", role: "group", "aria-label": group.label },
        h("span", { class: "rail-label" }, group.label),
        ...group.links.map(([title, path]) => {
          const current =
            path === route.url.pathname ||
            (path === "/projects" &&
              route.url.pathname.startsWith("/projects/")) ||
            (path === "/mail" && route.id === "mail-setup") ||
            (path === "/settings/account" && route.url.pathname === "/settings");
          const item = link(
            [icon(navIcons[path] || "grid"), h("span", {}, title)],
            path,
            "rail-link",
          );
          if (current) item.setAttribute("aria-current", "page");
          return item;
        }),
      ),
    ),
    h(
      "div",
      { class: "rail-foot" },
      link(
        [icon("terminal"), h("span", {}, "CLI & AI access")],
        "/settings/account#cli-access",
        "rail-link",
      ),
      h("small", {}, "Self-hosted"),
    ),
  );
  const email = state.access?.user?.email || "";
  identity.textContent = (email.trim()[0] || "?").toUpperCase();
  identity.title = email;
  identity.setAttribute("aria-label", email || "Account");
  mode.textContent =
    state.session?.mode === "host" ? "Host connected" : "Local sandbox";
  mode.classList.toggle("sandbox", state.session?.mode !== "host");
  globalCreate.hidden = !can(state.access, "project.create");
}
async function go(
  destination,
  { replace = false, force = false, historyMove = false } = {},
) {
  const url = new URL(destination, location.origin);
  if (url.origin !== location.origin) {
    location.href = url;
    return;
  }
  if (!force && beforeLeave && !(await beforeLeave())) return false;
  if (!(await closeDialogs())) return false;
  const route = routeFor(url);
  if (route.master && state.access?.user?.role !== "master")
    return go("/projects", { replace: true, force: true });
  dispose();
  beforeLeave = null;
  setRail(false);
  const current = ++generation;
  scrollPositions.set(activeUrl, window.scrollY);
  if (!historyMove && url.href !== activeUrl) {
    if (!replace) historyIndex++;
    history[replace ? "replaceState" : "pushState"](
      { strckroIndex: historyIndex },
      "",
      url,
    );
  }
  activeUrl = url.href;
  document.body.dataset.page = route.id;
  drawNavigation(route);
  const root = h("section", { class: "screen", "data-screen": route.id });
  content.replaceChildren(root);
  content.removeAttribute("aria-busy");
  if (route.id === "not-found") {
    root.append(
      empty(
        "ไม่พบหน้านี้",
        "เลือกหน้าอื่นจากแถบนำทาง",
        link("Applications", "/projects", "btn primary"),
      ),
    );
    return;
  }
  skeleton(root);
  let stopped = false;
  const cleanups = [];
  const ctx = {
    root,
    route,
    api,
    state,
    go,
    toast,
    dialog,
    confirm,
    can: (permission, project) => can(state.access, permission, project),
    master: () => state.access?.user?.role === "master",
    active: () => !stopped && current === generation,
    dirty: (value) => {
      beforeLeave = value
        ? () =>
            confirm(
              "มีการแก้ไขที่ยังไม่บันทึก",
              "ทิ้งการแก้ไขแล้วไปหน้าอื่นหรือไม่?",
              "ทิ้งการแก้ไข",
            )
        : null;
    },
    onDispose: (fn) => cleanups.push(fn),
    // A screen that redraws itself (the mailbox) keeps the address bar and
    // history in step without being mounted again. Back still remounts.
    locate: (destination, { replace = false } = {}) => {
      if (stopped || current !== generation) return;
      const next = new URL(destination, location.origin);
      if (next.href === activeUrl) return;
      if (!replace) historyIndex++;
      history[replace ? "replaceState" : "pushState"](
        { strckroIndex: historyIndex },
        "",
        next,
      );
      activeUrl = next.href;
    },
    reload: async () => {
      api.invalidate();
      return go(location.href, { replace: true, force: true });
    },
    poll: (work, delay = 5000) => {
      let timer,
        running = false;
      const tick = async () => {
        if (stopped) return;
        if (!document.hidden && !running) {
          running = true;
          try {
            await work();
          } catch (error) {
            if (error.status !== 401) toast(error.message, true);
          } finally {
            running = false;
          }
        }
        if (!stopped)
          timer = setTimeout(
            tick,
            typeof delay === "function" ? delay() : delay,
          );
      };
      timer = setTimeout(tick, typeof delay === "function" ? delay() : delay);
      cleanups.push(() => clearTimeout(timer));
    },
  };
  dispose = () => {
    stopped = true;
    cleanups.forEach((fn) => fn());
  };
  try {
    const screen = await modules[route.module]();
    if (current !== generation) return;
    await screen.mount(ctx);
    if (!ctx.active()) return;
    const title = root.querySelector("h1")?.textContent || "Workspace";
    document.title = `${title} · Strckro`;
    root.dataset.ready = "true";
    content.focus({ preventScroll: true });
    window.scrollTo(0, historyMove ? scrollPositions.get(url.href) || 0 : 0);
    document.dispatchEvent(
      new CustomEvent("strckro:ready", { detail: route.id }),
    );
  } catch (error) {
    if (ctx.active()) errorView(root, error, () => ctx.reload());
  }
  return true;
}
async function start() {
  if (authenticating) return;
  authenticating = true;
  try {
    if (routeFor(location.href).id === "invite") {
      host.replaceChildren(h("div", { id: "auth-root" }));
      const auth = await modules.auth();
      await auth.invitation({
        root: host.firstChild,
        api,
        go: () => start(),
        toast,
      });
      return;
    }
    const session = await api.get("/api/session", { force: true, ttl: 0 });
    state.session = session;
    if (!session.authenticated || session.bootstrapRequired) {
      dispose();
      beforeLeave = null;
      const root = h("div", { id: "auth-root" });
      host.replaceChildren(root);
      const auth = await modules.auth();
      await auth.login({
        root,
        api,
        session,
        onSuccess: async () => {
          authenticating = false;
          await start();
        },
      });
      return;
    }
    state.access = await api.get("/api/access");
    host.replaceChildren(shell);
    await go(location.href, { replace: true, force: true });
  } catch (error) {
    errorView(host, error, () => start());
  } finally {
    authenticating = false;
  }
}
let commandDialog = null;
async function openSearch() {
  if (!state.access) return;
  if (commandDialog?.node.open) {
    await commandDialog.close(true);
    return;
  }
  const d = dialog("Go anywhere", { wide: true });
  commandDialog = d;
  d.onClosed = () => {
    commandDialog = null;
    searchButton.focus();
  };
  d.node.classList.add("command");
  const input = h("input", {
    type: "search",
    placeholder: "ค้นหาหน้า แอป หรือองค์กร…",
    "aria-label": "ค้นหาใน workspace",
  });
  const list = h("div", { class: "command-list" });
  d.body.append(input, list);
  let projects = [];
  const render = () => {
    const query = input.value.trim().toLocaleLowerCase("th");
    const entries = navigation(state.access)
      .flatMap((g) =>
        g.links.map(([name, path]) => ({ name, path, meta: g.label })),
      )
      .concat(
        projects.map((p) => ({
          name: p.name,
          path:
            "/projects?search=" +
            encodeURIComponent(p.slug) +
            "#" +
            encodeURIComponent(p.slug),
          meta: p.organization || p.slug,
        })),
      );
    list.replaceChildren(
      ...entries
        .filter((x) =>
          (x.name + " " + x.meta).toLocaleLowerCase("th").includes(query),
        )
        .map((x) =>
          link(
            [h("strong", {}, x.name), h("small", {}, x.meta), icon("arrow")],
            x.path,
          ),
        ),
    );
    if (!list.children.length)
      list.append(empty("ไม่พบรายการ", "ลองใช้คำค้นหาอื่น"));
  };
  input.oninput = render;
  render();
  input.focus();
  void api
    .get("/api/projects")
    .then((data) => {
      projects = data.projects || [];
      if (d.node.open) render();
    })
    .catch((e) => toast(e.message, true));
  d.node.addEventListener("keydown", (e) => {
    const links = [...list.querySelectorAll("a")];
    if (e.key === "Escape") {
      e.preventDefault();
      void d.close(true);
      return;
    }
    if (!links.length) return;
    const index = links.indexOf(document.activeElement);
    if (["ArrowDown", "ArrowUp"].includes(e.key)) {
      e.preventDefault();
      links[
        e.key === "ArrowDown"
          ? (index + 1) % links.length
          : index <= 0
            ? links.length - 1
            : index - 1
      ].focus();
    }
    if (e.key === "Enter" && e.target === input) {
      e.preventDefault();
      links[0].click();
    }
  });
}
document.addEventListener("click", (event) => {
  const a = event.target.closest("a[href]");
  if (
    !state.access ||
    !a ||
    a.target ||
    a.hasAttribute("download") ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.altKey ||
    event.button !== 0
  )
    return;
  const url = new URL(a.href, location.href);
  if (
    url.origin !== location.origin ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/ui/") ||
    routeFor(url).id === "not-found"
  )
    return;
  if (url.pathname === location.pathname && url.hash === "#content") return;
  event.preventDefault();
  void go(url);
});
window.addEventListener("popstate", async (event) => {
  if (restoringHistory) {
    restoringHistory = false;
    return;
  }
  const targetIndex = Number(event.state?.strckroIndex) || 0;
  const delta = targetIndex - historyIndex;
  const accepted = await go(location.href, {
    replace: true,
    historyMove: true,
  });
  if (accepted === false) {
    restoringHistory = true;
    if (delta) history.go(-delta);
    else history.replaceState({ strckroIndex: historyIndex }, "", activeUrl);
  } else historyIndex = targetIndex;
});
window.addEventListener("beforeunload", (e) => {
  if (beforeLeave) {
    e.preventDefault();
    e.returnValue = "";
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && rail.hasAttribute("data-open")) setRail(false);
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    void openSearch();
  }
});
void start();
