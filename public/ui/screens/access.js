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
} from "../core/dom.js";
import { secretReveal } from "../core/overlays.js";
export async function mount(ctx) {
  return ctx.route.id === "members" ? team(ctx) : credentials(ctx);
}
async function credentials(ctx) {
  ctx.root.replaceChildren(
    heading(
      "Git credentials",
      "HTTPS access tokens แยกตามองค์กร ค่า token เข้ารหัสและไม่แสดงค่าเดิม",
    ),
  );
  const orgs = ctx.state.access.organizations.filter(
    (o) =>
      ctx.master() || o.permissions?.some((p) => p.startsWith("credentials.")),
  );
  const choices = orgs.map((o) => [o.id, o.name]);
  if (ctx.master()) choices.push(["", "Global (legacy)"]);
  const scope = field("Organization", "organizationId", {
    choices,
    value: orgs[0]?.id ?? "",
  });
  const collection = h("div", { class: "panel" });
  const actions = h("div", { class: "actions" });
  ctx.root.querySelector(".page-head>.actions").append(actions);
  let requestId = 0;
  const load = async () => {
    const id = ++requestId;
    const organizationId = scope.control.value || null;
    const url = organizationId
      ? "/api/credentials?organizationId=" + encodeURIComponent(organizationId)
      : "/api/credentials";
    const data = await ctx.api.get(url, { ttl: 0 });
    if (!ctx.active() || id !== requestId) return;
    const p = { organizationId };
    actions.replaceChildren(
      organizationId &&
        ctx.can("credentials.create", p) &&
        data.vaultReady &&
        button(
          [icon("plus"), "Add credential"],
          () => editor(ctx, organizationId, null, load),
          "primary",
        ),
    );
    const items = (data.credentials || []).filter(
      (credential) => credential.organizationId === organizationId,
    );
    if (!items.length) {
      collection.replaceChildren(
        empty(
          organizationId
            ? "ยังไม่มี Git credential"
            : "ยังไม่มี Git credential แบบ Global",
          organizationId && "ใช้ public repository ได้โดยไม่ต้องเพิ่ม token",
        ),
      );
      return;
    }
    const grid = table(
      ["Credential", "Git host", "Default", ""],
      items.map((c) => [
        h(
          "div",
          {},
          h("strong", {}, c.name),
          h("small", {}, "Token stored encrypted"),
        ),
        h("code", {}, c.host),
        data.defaultCredentialId === c.id
          ? badge("Default", "success")
          : h("span", {}, "—"),
        h(
          "div",
          { class: "actions" },
          ctx.can("credentials.update", p) &&
            button("Edit", () => editor(ctx, organizationId, c, load), "small"),
          organizationId &&
            ctx.can("credentials.update", p) &&
            button(
              "Set default",
              async () => {
                await ctx.api.post("/api/credentials/default", {
                  organizationId,
                  credentialId: c.id,
                });
                await load();
              },
              "small",
              { disabled: data.defaultCredentialId === c.id },
            ),
          organizationId &&
            ctx.can("credentials.delete", p) &&
            button(
              "Delete",
              async () => {
                if (
                  !(await ctx.confirm(
                    "ลบ credential?",
                    `${c.name} จะลบไม่ได้หากยังมีแอปผูกอยู่`,
                    "Delete",
                  ))
                )
                  return;
                await ctx.api.delete("/api/credentials/" + c.id, {
                  organizationId,
                });
                await load();
              },
              "danger small",
            ),
        ),
      ]),
    );
    grid.classList.add("mobile-cards");
    collection.replaceChildren(grid);
  };
  scope.control.onchange = () =>
    load().catch((e) => ctx.toast(e.message, true));
  ctx.root.append(
    h(
      "div",
      { class: "collection-tools" },
      h("div", { class: "filters" }, scope),
    ),
    collection,
  );
  await load();
}
function editor(ctx, organizationId, c, reload) {
  const d = ctx.dialog(c ? "Edit Git credential" : "Add Git credential");
  const token = field(
    c ? "Replacement token (เว้นว่างเพื่อเก็บเดิม)" : "Personal access token",
    "token",
    {
      type: "password",
      required: !c,
      autocomplete: "new-password",
      maxLength: 4096,
    },
  );
  const f = form(
    async (v) => {
      const payload = { ...v, organizationId };
      if (c) await ctx.api.patch("/api/credentials/" + c.id, payload);
      else await ctx.api.post("/api/credentials", payload);
      token.control.value = "";
      await d.close(true);
      ctx.toast("บันทึก credential แล้ว");
      await reload();
    },
    field("Name", "name", {
      value: c?.name || "",
      required: true,
      pattern: "[a-z][a-z0-9-]{0,79}",
      maxLength: 80,
    }),
    field("Git host", "host", {
      value: c?.host || "github.com",
      required: true,
      maxLength: 253,
      hint: "Token ใช้ได้เฉพาะ repository บน host นี้",
    }),
    token,
    !c && check("ใช้เป็น default ขององค์กร", "default"),
    h("div", { class: "form-actions" }, submit("Save credential")),
  );
  d.body.append(f);
  d.onClosed = () => {
    token.control.value = "";
  };
}
function membershipEditor(ctx, data, selected = []) {
  const root = h("div", { class: "stack" });
  const controls = [];
  const permissions = (ctx.state.access.permissions || []).map((p) =>
    typeof p === "string" ? { id: p, label: p, group: "Permissions" } : p,
  );
  for (const org of data.organizations || []) {
    const selectedOrg = selected.find((m) => m.organizationId === org.id);
    const grant = check("เข้าถึงองค์กรนี้", "grant", !!selectedOrg);
    const grid = h("div", { class: "check-grid" });
    const entries = permissions.map((p) => {
      const c = check(
        p.label || p.id,
        "permission",
        selectedOrg?.permissions?.includes(p.id) || false,
        "",
        p.id,
      );
      grid.append(c);
      return { id: p.id, input: c.querySelector("input") };
    });
    const update = () => {
      grid.hidden = !grant.querySelector("input").checked;
    };
    grant.querySelector("input").onchange = update;
    update();
    const presets = h("div", { class: "actions" });
    for (const [key, label] of [
      ["viewer", "Viewer"],
      ["operator", "Operator"],
      ["maintainer", "Maintainer"],
    ])
      if (ctx.state.access.presets?.[key])
        presets.append(
          button(
            label,
            () => {
              grant.querySelector("input").checked = true;
              entries.forEach(
                (x) =>
                  (x.input.checked = ctx.state.access.presets[key].includes(
                    x.id,
                  )),
              );
              update();
            },
            "small",
          ),
        );
    root.append(
      h(
        "fieldset",
        {},
        h("legend", {}, org.name),
        h("div", { class: "stack" }, grant, presets, grid),
      ),
    );
    controls.push({ org, grant, entries });
  }
  return {
    root,
    collect: () =>
      controls
        .filter((x) => x.grant.querySelector("input").checked)
        .map((x) => ({
          organizationId: x.org.id,
          permissions: x.entries
            .filter((e) => e.input.checked)
            .map((e) => e.id),
        })),
  };
}
async function team(ctx) {
  let data = null;
  ctx.root.replaceChildren(
    heading(
      "Team & organizations",
      "จัดการสมาชิก องค์กร และสิทธิ์ตามงาน",
      button(
        [icon("plus"), "Invite member"],
        () => {
          if (data) return invite(ctx, data);
        },
        "primary",
      ),
    ),
  );
  data = await ctx.api.get("/api/members", { ttl: 0 });
  if (!ctx.active()) return;
  const tabs = h("nav", { class: "tabs", "aria-label": "Team sections" });
  const collection = h("div", { class: "panel" });
  const render = (type) => {
    tabs
      .querySelectorAll("button")
      .forEach((b) => b.classList.toggle("active", b.dataset.tab === type));
    if (type === "members") {
      const grid = table(
        ["Member", "Role", "Organizations", "Status", ""],
        (data.users || []).map((u) => [
          h("strong", {}, u.email),
          badge(u.role),
          h(
            "small",
            {},
            u.role === "master"
              ? "All organizations"
              : (data.memberships || [])
                  .filter((m) => m.userId === u.id)
                  .map(
                    (m) =>
                      data.organizations.find((o) => o.id === m.organizationId)
                        ?.name || "—",
                  )
                  .join(", ") || "No organizations",
          ),
          badge(u.status, u.status === "active" ? "success" : "pending"),
          button("Edit access", () => editMember(ctx, data, u), "small"),
        ]),
      );
      grid.classList.add("mobile-cards");
      collection.replaceChildren(grid);
    }
    if (type === "organizations")
      collection.replaceChildren(
        h(
          "div",
          { class: "panel-body actions" },
          button(
            [icon("plus"), "New organization"],
            () => orgEditor(ctx),
            "primary",
          ),
        ),
        table(
          ["Organization", "Applications scope", ""],
          (data.organizations || []).map((o) => [
            h("strong", {}, o.name),
            h("small", {}, "แยกสิทธิ์และ credentials รายองค์กร"),
            button("Rename", () => orgEditor(ctx, o), "small"),
          ]),
        ),
      );
    if (type === "invitations") {
      const invites = data.invitations || [];
      collection.replaceChildren(
        invites.length
          ? table(
              ["Email", "Role", "Expires", "Status", ""],
              invites.map((i) => [
                h("strong", {}, i.email),
                badge(i.role),
                h("small", {}, when(i.expiresAt)),
                badge(
                  i.acceptedAt
                    ? "Accepted"
                    : i.revokedAt
                      ? "Revoked"
                      : Date.parse(i.expiresAt) < Date.now()
                        ? "Expired"
                        : "Pending",
                  i.acceptedAt ? "success" : "neutral",
                ),
                !i.acceptedAt &&
                  !i.revokedAt &&
                  button(
                    "Revoke",
                    async () => {
                      if (
                        !(await ctx.confirm("ยกเลิกคำเชิญ?", i.email, "Revoke"))
                      )
                        return;
                      await ctx.api.delete("/api/invitations/" + i.id);
                      data = await ctx.api.get("/api/members", { ttl: 0 });
                      render("invitations");
                    },
                    "danger small",
                  ),
              ]),
            )
          : empty(
              "ยังไม่มีคำเชิญ",
              "สร้างคำเชิญแล้วคัดลอกลิงก์ให้สมาชิกผ่านช่องทางที่คุณเลือก",
            ),
      );
    }
  };
  for (const [id, label] of [
    ["members", "Members"],
    ["organizations", "Organizations"],
    ["invitations", "Invitations"],
  ]) {
    const b = button(label, () => render(id), "ghost");
    b.dataset.tab = id;
    tabs.append(b);
  }
  ctx.root.append(h("div", { class: "stack" }, tabs, collection));
  render("members");
}
function orgEditor(ctx, org) {
  const d = ctx.dialog(org ? "Rename organization" : "New organization");
  d.body.append(
    form(
      async (v) => {
        if (org) await ctx.api.patch("/api/organizations/" + org.id, v);
        else await ctx.api.post("/api/organizations", v);
        ctx.state.access = await ctx.api.get("/api/access", { force: true });
        await d.close(true);
        ctx.toast("บันทึกองค์กรแล้ว");
        await ctx.reload();
      },
      field("Organization name", "name", {
        value: org?.name || "",
        required: true,
        maxLength: 80,
      }),
      h("div", { class: "form-actions" }, submit("Save organization")),
    ),
  );
}
function invite(ctx, data) {
  const d = ctx.dialog("Invite a teammate", { wide: true });
  const grants = membershipEditor(ctx, data);
  const role = field("Role", "role", {
    choices: [
      ["user", "Member — permissions per organization"],
      ["master", "Master — all organizations"],
    ],
  });
  role.control.onchange = () => {
    grants.root.hidden = role.control.value === "master";
  };
  d.body.append(
    form(
      async (v) => {
        const r = await ctx.api.post("/api/invitations", {
          email: v.email,
          role: v.role,
          memberships: v.role === "master" ? [] : grants.collect(),
        });
        await d.close(true);
        const url = new URL("/invite", location.origin);
        url.searchParams.set("token", r.token);
        secretReveal("Invitation link — คัดลอกตอนนี้", url.href);
        ctx.toast("สร้างคำเชิญแล้ว ลิงก์มีอายุ 48 ชั่วโมง");
      },
      field("Email", "email", {
        type: "email",
        required: true,
        maxLength: 254,
        autocomplete: "off",
      }),
      role,
      grants.root,
      h("div", { class: "form-actions" }, submit("Create invitation link")),
    ),
  );
}
function editMember(ctx, data, user) {
  const d = ctx.dialog("Edit access · " + user.email, { wide: true });
  const grants = membershipEditor(
    ctx,
    data,
    (data.memberships || []).filter((m) => m.userId === user.id),
  );
  const role = field("Role", "role", {
    choices: ["user", "master"],
    value: user.role,
  });
  grants.root.hidden = user.role === "master";
  role.control.onchange = () => {
    grants.root.hidden = role.control.value === "master";
  };
  d.body.append(
    form(
      async (v) => {
        if (
          !(await ctx.confirm(
            "บันทึกสิทธิ์สมาชิก?",
            `${user.email} · ${v.role} · ${v.status} การลดสิทธิ์มีผลต่อ session และ tokens`,
            "Save access",
          ))
        )
          return;
        await ctx.api.patch("/api/members/" + user.id, {
          role: v.role,
          status: v.status,
          memberships: v.role === "master" ? [] : grants.collect(),
        });
        await d.close(true);
        ctx.toast("บันทึกสิทธิ์แล้ว");
        await ctx.reload();
      },
      h(
        "div",
        { class: "form-columns" },
        role,
        field("Status", "status", {
          choices: ["active", "disabled"],
          value: user.status,
        }),
      ),
      grants.root,
      h("div", { class: "form-actions" }, submit("Save access")),
    ),
  );
}
