import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { hashPassword } from "../../src/auth.mjs";
import { SecretVault } from "../../src/core.mjs";
import { start, OWNER_PASSWORD } from "../support/server.mjs";

const { chromium } = await import(
  process.env.STRCKRO_PLAYWRIGHT_MODULE || "playwright"
);
let browser;
before(async () => {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.STRCKRO_BROWSER_PATH
      ? { executablePath: process.env.STRCKRO_BROWSER_PATH }
      : {}),
  });
});
after(async () => {
  await browser?.close();
});
async function fixture(t, options = {}) {
  const ctx = await start({
    projectRuntimeDetector: async () => ({
      recommendedRuntime: "node",
      recommendedFramework: "next",
      candidates: [
        {
          runtime: "node",
          framework: "next",
          buildScript: "build",
          startScript: "start",
        },
      ],
      buildScript: "build",
      startScript: "start",
      notice: "Fixture detection",
      evidence: [],
    }),
    branchFetcher: async () => ["main", "develop"],
    domainDnsCheck: async (hostname) => ({
      hostname,
      status: "ok",
      expected: ["192.0.2.1"],
      resolved: ["192.0.2.1"],
      detail: "Fixture DNS matches",
    }),
    databaseDrivers: async () => ({
      postgresql: { package: "pg", installed: true },
    }),
    databaseQuery: async () => ({
      columns: ["id", "name"],
      rows: [[1, "fixture"]],
      rowCount: 1,
      durationMs: 1,
    }),
    mailHostnameCheck: async () => ({
      status: "ok",
      detail: "Fixture hostname",
    }),
    mailOutboundCheck: async () => ({
      checkedAt: new Date().toISOString(),
      ports: [
        { port: 25, status: "open" },
        { port: 587, status: "open" },
        { port: 2525, status: "open" },
      ],
      recommendation: { mode: "direct" },
    }),
    ...options,
  });
  await ctx.app.store.update((state) => {
    state.git.identity = { name: "UI fixture", email: "owner@local.test" };
    for (const tool of Object.values(state.tools)) tool.status = "Installed";
    const org = state.organizations[0];
    state.projects = [
      ["alpha", "Alpha"],
      ["worker", "Background worker"],
    ].map(([slug, name], i) => ({
      slug,
      name,
      organizationId: org.id,
      organization: org.name,
      repository: `https://github.com/example/${slug}.git`,
      protocol: "https",
      directory: "/",
      branch: "main",
      runtime: "node",
      nodeMajor: 24,
      nodePackageManager: "auto",
      buildScript: "build",
      startScript: "start",
      serviceType: i ? "worker" : "web",
      port: i ? null : 3210,
      healthCheckEnabled: !i,
      healthCheckPath: "/",
      sync: { status: "synced", revision: "a".repeat(40) },
      deployment: {
        state: "idle",
        activeReleaseId: null,
        previousReleaseId: null,
        releases: [],
      },
      domains: { hosts: [] },
    }));
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    colorScheme: "light",
  });
  const login = await context.request.post(ctx.base + "/api/login", {
    data: { email: "owner@local.test", password: OWNER_PASSWORD },
  });
  assert.equal(login.status(), 200);
  const session = await (
    await context.request.get(ctx.base + "/api/session")
  ).json();
  await context.request.post(ctx.base + "/api/projects/alpha/environment", {
    headers: { "x-csrf-token": session.csrfToken },
    data: {
      mode: "replace",
      content:
        "# preserve\n" +
        Array.from({ length: 70 }, (_, i) => `KEY_${i}=value-${i}`).join("\n") +
        "\n",
    },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.stack || e.message));
  const go = async (path) => {
    await page.goto(ctx.base + path);
    await page.locator("[data-ready=true]").waitFor();
  };
  t.after(async () => {
    await context.close();
    await ctx.app.close();
    assert.deepEqual(errors, []);
  });
  return { ...ctx, context, page, go, session, errors };
}
async function clickNav(page, path) {
  await page.locator(`.rail a[href="${path}"]`).click();
  await page.locator("[data-ready=true]").waitFor();
}
async function dismiss(page) {
  const dialogs = page.locator("dialog[open]");
  if (await dialogs.count()) {
    await dialogs
      .last()
      .getByRole("button", { name: "ปิด", exact: true })
      .first()
      .click();
    await dialogs.last().waitFor({ state: "hidden" });
  }
}

test("applications load only their API and navigation stays in the same document with a slow unrelated endpoint", async (t) => {
  const { page, base } = await fixture(t);
  const requests = [];
  let documents = 0;
  page.on("request", (r) => {
    if (r.resourceType() === "document") documents++;
    const path = new URL(r.url()).pathname;
    if (path.startsWith("/api/")) requests.push(path);
  });
  await page.route("**/api/software-update", async (route) => {
    await new Promise((r) => setTimeout(r, 600));
    await route.fulfill({ json: { status: "current" } });
  });
  await page.goto(base + "/projects");
  await page.locator("[data-project=alpha]").waitFor();
  assert.deepEqual(
    requests.sort(),
    ["/api/access", "/api/projects", "/api/session"].sort(),
  );
  await clickNav(page, "/deployments");
  assert.equal(documents, 1);
  await page.keyboard.press("Control+k");
  await page.keyboard.press("Control+k");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.keyboard.press("Control+k");
  const search = page.getByRole("dialog").getByRole("searchbox");
  await search.fill("Alpha");
  await page.keyboard.press("Enter");
  await page.locator("dialog.sheet[open]").waitFor();
  assert.equal(await page.getByRole("button", { name: "Restart app", exact: true }).count(), 0);
  assert.equal(documents, 1);
  await page.keyboard.press("Escape");
  await page.locator("dialog.sheet").waitFor({ state: "hidden" });
  await page.goBack();
  await page.locator("[data-screen=deployments][data-ready=true]").waitFor();
  await page.goForward();
  await page.locator("[data-screen=projects][data-ready=true]").waitFor();
  assert.equal(documents, 1);
});

test("Storage remains clickable when a live project's Deploy pane is taller than the sheet", async (t) => {
  const { app, page, go } = await fixture(t);
  await app.store.update((state) => {
    const project = state.projects.find((item) => item.slug === "alpha");
    project.storagePath = "uploads";
    project.deployment.activeReleaseId = "release-one";
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await go("/projects");
  await page.getByRole("button", { name: "Alpha", exact: true }).click();
  await page.getByRole("tab", { name: "Storage", exact: true }).click({ timeout: 5000 });
  await page.getByText("ใช้งานอยู่", { exact: true }).waitFor();
  await page.getByText("uploads", { exact: true }).waitFor();
});

test("ENV rows retain filtered keys, preserve comments, save empty values, and protect unsaved dismissal", async (t) => {
  const { page, go, context, base } = await fixture(t);
  await go("/projects");
  await page.getByRole("button", { name: "Alpha", exact: true }).click();
  await page.getByRole("tab", { name: "Environment", exact: true }).click();
  const editor = page.getByRole("textbox", { name: ".env document" });
  await editor.fill("invalid line");
  await page
    .locator("dialog.sheet .dialog-head")
    .getByRole("button", { name: "ปิด", exact: true })
    .click();
  const guard = page.getByRole("dialog", {
    name: "ทิ้งการแก้ไขที่ยังไม่บันทึก?",
  });
  await guard.getByRole("button", { name: "ยกเลิก", exact: true }).click();
  assert.equal(await editor.inputValue(), "invalid line");
  const original = (
    await (
      await context.request.get(base + "/api/projects/alpha/environment")
    ).json()
  ).environment.content;
  await editor.fill(original);
  await page.getByRole("button", { name: "ทีละ key", exact: true }).click();
  await page.getByRole("searchbox", { name: "กรอง ENV key" }).fill("KEY_69");
  const visible = page.locator(".env-row:visible");
  assert.equal(await visible.count(), 1);
  await visible
    .getByRole("textbox", { name: "ENV value", exact: true })
    .fill("");
  await page.getByRole("button", { name: "บันทึก ENV", exact: true }).click();
  await page
    .getByText("บันทึกแล้ว · ใช้เมื่อ deploy ครั้งถัดไป", { exact: true })
    .waitFor();
  const saved = (
    await (
      await context.request.get(base + "/api/projects/alpha/environment")
    ).json()
  ).environment;
  assert.equal(saved.variables.length, 70);
  assert.ok(saved.content.startsWith("# preserve"));
  assert.equal(saved.variables.find((v) => v.key === "KEY_69").value, "");
  await page.getByRole("tab", { name: "Domains", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Domain", exact: true })
    .fill("app.example.test");
  await page.getByRole("button", { name: "เพิ่มโดเมน", exact: true }).click();
  await page
    .getByRole("heading", { name: "app.example.test", exact: true })
    .waitFor();
  // Statuses are read without being asked: DNS records and the count appear by themselves.
  await page.getByRole("cell", { name: "192.0.2.1", exact: true }).waitFor();
  assert.equal(await page.getByText("1/10 โดเมน").count(), 1);
  assert.equal(
    await page.getByRole("button", { name: "Refresh", exact: true }).isEnabled(),
    true,
  );
  assert.equal(
    await page.getByRole("button", { name: "Verify all", exact: true }).count(),
    1,
  );
  // The new domain is a duplicate now: the form says so and keeps what was typed.
  await page
    .getByRole("textbox", { name: "Domain", exact: true })
    .fill("app.example.test");
  await page.getByRole("button", { name: "เพิ่มโดเมน", exact: true }).click();
  await page.getByText("โดเมนนี้อยู่ในโปรเจคแล้ว", { exact: false }).waitFor();
  assert.equal(
    (
      await (await context.request.get(base + "/api/projects")).json()
    ).projects.find((p) => p.slug === "alpha").domains.hosts[0],
    "app.example.test",
  );
});

// Runtime and Framework are menus with logos, not native selects.
async function choose(page, menu, option) {
  await page.getByRole("combobox", { name: menu, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("typing a repository URL detects the runtime and framework, with logos in the menus, and never overrides a choice", async (t) => {
  const { page, go } = await fixture(t);
  await go("/projects/new");
  await page
    .getByRole("textbox", { name: "Application name", exact: true })
    .fill("Detected app");
  await page
    .getByRole("button", { name: "Continue to source →", exact: true })
    .click();
  await page.locator("[data-ready=true]").waitFor();
  await page
    .getByRole("textbox", { name: "Repository URL", exact: false })
    .fill("https://github.com/example/detected.git");
  const detected = page.locator(".detected");
  await detected.waitFor();
  assert.match(await detected.innerText(), /Next\.js/);
  const runtime = page.getByRole("combobox", { name: "Runtime", exact: true });
  const framework = page.getByRole("combobox", {
    name: "Framework (optional)",
    exact: true,
  });
  assert.match(await runtime.innerText(), /Node\.js/);
  assert.match(await framework.innerText(), /Next\.js/);
  assert.equal(await page.getByLabel("Branch", { exact: true }).inputValue(), "main");
  // The menu lists frameworks with their logos and marks the detected one.
  await framework.click();
  const options = page.getByRole("option");
  assert.ok((await options.count()) > 5);
  assert.ok((await page.locator(".picker-list img").count()) > 5);
  assert.match(
    await page.getByRole("option", { name: "Next.js", exact: true }).innerText(),
    /ตรวจพบ/,
  );
  await page.keyboard.press("Escape");
  // A framework that does not belong to the runtime disappears with it.
  await choose(page, "Runtime", "Go");
  assert.equal(await framework.isVisible(), false);
  await choose(page, "Runtime", "Node.js");
  assert.equal(await framework.isVisible(), true);
});

test("create flow preserves runtime settings, guards dirty navigation, and saves pnpm / skip-build configuration", async (t) => {
  const { page, go, context, base } = await fixture(t);
  await go("/projects/new");
  await page
    .getByRole("textbox", { name: "Application name", exact: true })
    .fill("New storefront");
  assert.equal(
    await page
      .getByRole("textbox", { name: "Slug", exact: false })
      .inputValue(),
    "new-storefront",
  );
  await page.locator('.rail a[href="/activity"]').click();
  await page
    .getByRole("dialog", { name: "มีการแก้ไขที่ยังไม่บันทึก" })
    .getByRole("button", { name: "ยกเลิก", exact: true })
    .click();
  assert.ok(page.url().endsWith("/projects/new"));
  await page
    .getByRole("button", { name: "Continue to source →", exact: true })
    .click();
  await page.locator("[data-ready=true]").waitFor();
  await page
    .getByRole("textbox", { name: "Repository URL", exact: false })
    .fill("https://github.com/example/new.git");
  // Typing the URL inspects it by itself; let that settle before choosing by hand.
  await page.locator(".detected").waitFor();
  await page
    .getByRole("combobox", { name: "Package manager", exact: true })
    .selectOption("pnpm");
  await choose(page, "Runtime", "Go");
  await page
    .getByRole("textbox", { name: "Go package", exact: false })
    .fill("./cmd/server");
  await choose(page, "Runtime", "Node.js");
  assert.equal(
    await page
      .getByRole("combobox", { name: "Package manager", exact: true })
      .inputValue(),
    "pnpm",
  );
  await page
    .getByRole("textbox", { name: "Build script", exact: false })
    .fill("");
  await page
    .getByRole("button", { name: "Review configuration →", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Review your application", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "บันทึกและ sync source", exact: true })
    .click();
  await page.locator("[data-project=new-storefront]").waitFor();
  const project = (
    await (await context.request.get(base + "/api/projects")).json()
  ).projects.find((p) => p.slug === "new-storefront");
  assert.equal(project.nodePackageManager, "pnpm");
  assert.equal(project.buildScript, null);
});

test("tokens are shown once, device approval works, and a read-only member sees no host administration", async (t) => {
  const { page, go, context, base, session, app } = await fixture(t);
  await go("/settings/account");
  await page
    .getByRole("textbox", { name: "Token name", exact: true })
    .fill("Browser fixture");
  await page
    .getByRole("button", { name: "Create CLI token", exact: true })
    .click();
  const reveal = page.getByRole("dialog", {
    name: "CLI token — แสดงครั้งเดียว",
  });
  const token = await reveal.getByRole("textbox").inputValue();
  assert.ok(token.startsWith("dp_"));
  assert.equal(
    await page.evaluate(
      (value) => JSON.stringify({ ...localStorage }).includes(value),
      token,
    ),
    false,
  );
  await reveal.getByRole("button", { name: "ซ่อนและปิด", exact: true }).click();
  await reveal.waitFor({ state: "detached" });
  assert.equal(
    await page
      .locator("textarea,input")
      .evaluateAll(
        (nodes, value) => nodes.some((node) => node.value === value),
        token,
      ),
    false,
  );
  const device = await context.request.post(base + "/api/cli/device/start", {
    data: { name: "Test device", scopes: ["project.view"], expiresInDays: 1 },
  });
  const request = await device.json();
  await go("/settings/account?cli_code=" + request.userCode);
  await page.getByRole("button", { name: "อนุมัติ CLI", exact: true }).click();
  await page
    .getByText("อนุมัติแล้ว กลับไปที่ terminal ได้เลย", { exact: true })
    .waitFor();
  const owner = app.store.snapshot();
  const org = owner.organizations[0];
  const invite = await context.request.post(base + "/api/invitations", {
    headers: { "x-csrf-token": session.csrfToken },
    data: {
      email: "viewer@local.test",
      role: "user",
      memberships: [{ organizationId: org.id, permissions: ["project.view"] }],
    },
  });
  const invitation = await invite.json();
  const member = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  t.after(() => member.close());
  const mp = await member.newPage();
  await mp.goto(base + "/invite?token=" + invitation.token);
  await mp
    .getByLabel("รหัสผ่านใหม่", { exact: false })
    .fill("Strong-Fixture-2026!");
  await mp
    .getByLabel("ยืนยันรหัสผ่าน", { exact: true })
    .fill("Strong-Fixture-2026!");
  await mp
    .getByRole("button", { name: "เปิดใช้งานบัญชี", exact: true })
    .click();
  await mp
    .getByText(
      "เปิดใช้งานบัญชีแล้ว เข้าสู่ระบบด้วยอีเมลและรหัสผ่านใหม่ได้เลย",
      { exact: true },
    )
    .waitFor();
  await mp.goto(base + "/projects");
  await mp
    .getByRole("textbox", { name: "อีเมล", exact: true })
    .fill("viewer@local.test");
  await mp.getByLabel("รหัสผ่าน", { exact: true }).fill("Strong-Fixture-2026!");
  await mp
    .getByRole("button", { name: "เข้าสู่ workspace →", exact: true })
    .click();
  await mp.locator("[data-project=alpha]").waitFor();
  assert.equal(
    await mp
      .locator(".rail")
      .getByText("Infrastructure", { exact: true })
      .count(),
    0,
  );
  assert.equal(await mp.locator(".global-create").isVisible(), false);
  assert.equal(
    await mp.getByRole("button", { name: "Deploy", exact: true }).count(),
    0,
  );
});

test("database connection and Console use the real API without a real database", async (t) => {
  const { page, go } = await fixture(t);
  await go("/databases");
  await page
    .getByRole("button", { name: "Add connection", exact: false })
    .first()
    .click();
  const d = page.getByRole("dialog", { name: "Add database connection" });
  await d
    .getByRole("textbox", { name: "Connection name", exact: true })
    .fill("test-postgres");
  await d.getByRole("textbox", { name: "Database", exact: true }).fill("test");
  await d.getByRole("textbox", { name: "Username", exact: true }).fill("test");
  await d
    .getByRole("textbox", { name: "Password", exact: true })
    .fill("fixture-only");
  await d.getByRole("button", { name: "Save connection", exact: true }).click();
  await page.getByRole("link", { name: "Console", exact: true }).click();
  await page.locator("[data-screen=console][data-ready=true]").waitFor();
  await page
    .getByRole("textbox", { name: "Statement", exact: true })
    .fill("SELECT 1");
  await page.getByRole("button", { name: "Run query", exact: true }).click();
  await page.getByRole("cell", { name: "fixture", exact: true }).waitFor();
});

test("all deep links stay within desktop and mobile widths and support theme switching", async (t) => {
  const { page, go } = await fixture(t);
  const paths = [
    "/",
    "/projects",
    "/deployments",
    "/activity",
    "/setup",
    "/credentials",
    "/databases",
    "/members",
    "/settings/account",
    "/settings/updates",
    "/settings/monitor",
    "/mail",
    "/mail/setup",
    "/projects/new",
    "/projects/alpha/edit",
    "/projects/alpha/edit/repository",
    "/projects/alpha/edit/review",
    "/projects/alpha/logs",
  ];
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const path of paths) {
      await go(path);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
        false,
        path + " at " + width,
      );
    }
  }
  await page.getByRole("button", { name: "สลับธีม", exact: true }).click();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
});

test("first-run bootstrap creates an owner through the new authentication interface", async (t) => {
  const app = await start({ password: undefined });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  t.after(async () => {
    await context.close();
    await app.app.close();
  });
  const page = await context.newPage();
  await page.goto(app.base);
  await page
    .getByRole("heading", { name: "Create your workspace.", exact: true })
    .waitFor();
  await page.getByLabel("อีเมล", { exact: true }).fill("new-owner@local.test");
  await page
    .getByLabel("รหัสผ่านใหม่", { exact: false })
    .fill("Strckro-Owner-2026!");
  await page
    .getByLabel("ยืนยันรหัสผ่าน", { exact: true })
    .fill("Strckro-Owner-2026!");
  await page
    .getByRole("button", { name: "สร้างบัญชีเจ้าของระบบ", exact: true })
    .click();
  await page.locator("[data-screen=overview][data-ready=true]").waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    ),
    false,
  );
});

test("create-release action confirms once, updates the live inventory, and keeps notification hooks project-scoped", async (t) => {
  const { page, go, context, base } = await fixture(t);
  await go("/projects");
  await page.getByRole("button", { name: "Alpha", exact: true }).click();
  await page
    .getByRole("button", { name: "Create release", exact: true })
    .click();
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/projects/alpha/deploy") &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("dialog", { name: "สร้าง release ใหม่?" })
    .getByRole("button", { name: "Create release", exact: true })
    .click();
  assert.ok((await response).status() < 400);
  let active = false;
  for (let i = 0; i < 12; i++) {
    const data = (
      await (await context.request.get(base + "/api/projects")).json()
    ).projects.find((p) => p.slug === "alpha");
    if (data.deployment.state === "active") {
      active = true;
      break;
    }
    await page.waitForTimeout(250);
  }
  assert.equal(active, true);
  const job = page.getByRole("dialog", {
    name: "Alpha · deployment",
    exact: true,
  });
  // Progress is one inline line; the log opens only when someone asks for it.
  assert.equal(await job.count(), 0);
  if (!(await page.locator("dialog.sheet[open]").count()))
    await page.getByRole("button", { name: "Alpha", exact: true }).click();
  await page.getByRole("tab", { name: "Notifications", exact: true }).click();
  await page
    .getByRole("textbox", { name: "ชื่อ hook", exact: true })
    .fill("Fixture notifications");
  await page
    .getByRole("textbox", { name: "Webhook URL", exact: true })
    .fill("https://example.test/notifications");
  await page
    .getByRole("button", { name: "เพิ่ม notification hook", exact: true })
    .click();
  await page.getByRole("heading", { name: "Alpha", exact: true }).waitFor();
  const hooks = (
    await (await context.request.get(base + "/api/notification-hooks")).json()
  ).hooks;
  assert.equal(hooks[0].projectSlug, "alpha");
  assert.deepEqual(hooks[0].events, [
    "deployment.succeeded",
    "deployment.failed",
  ]);
});

test("only a Master can see and rotate a legacy Git credential without rebinding projects", async (t) => {
  const { app, page, go, context, base, session } = await fixture(t);
  const organizationId = app.store.snapshot().organizations[0].id;
  const headers = { "x-csrf-token": session.csrfToken };
  const previousToken = "fixture-legacy-git-token";
  const replacementToken = "fixture-replacement-git-token";
  const memberEmail = "credential-editor@local.test";
  const memberPassword = "Strong-Fixture-2026!";
  const memberId = randomUUID();
  const legacy = await context.request.post(base + "/api/credentials", {
    headers,
    data: { name: "legacy-git", host: "github.com", token: previousToken },
  });
  assert.equal(legacy.status(), 201);
  const { credential } = await legacy.json();
  const scoped = await context.request.post(base + "/api/credentials", {
    headers,
    data: { organizationId, name: "organization-git", host: "github.com", token: previousToken },
  });
  assert.equal(scoped.status(), 201);
  await app.store.update((state) => {
    for (const project of state.projects) project.credentialId = credential.id;
    state.users.push({
      id: memberId, email: memberEmail, password: hashPassword(memberPassword),
      role: "user", status: "active", authVersion: 1,
    });
    state.memberships.push({ userId: memberId, organizationId, permissions: ["credentials.update"] });
  });

  await go("/credentials");
  const selector = page.getByRole("combobox", { name: "Organization" });
  assert.equal(await selector.inputValue(), organizationId);
  await page.getByText("organization-git", { exact: true }).waitFor();
  assert.equal(await page.getByText(credential.name, { exact: true }).count(), 0);
  await selector.selectOption({ label: "Global (legacy)" });
  const row = page.getByRole("row", { name: /legacy-git/ });
  await row.getByRole("button", { name: "Edit", exact: true }).click();
  assert.equal(await page.getByText("organization-git", { exact: true }).count(), 0);
  const dialog = page.getByRole("dialog", { name: "Edit Git credential" });
  const token = dialog.getByLabel(/Replacement token/);
  assert.equal(await token.inputValue(), "");
  await token.fill(replacementToken);
  const [response] = await Promise.all([
    page.waitForResponse((reply) =>
      reply.url() === base + "/api/credentials/" + credential.id &&
      reply.request().method() === "PATCH",
    ),
    dialog.getByRole("button", { name: "Save credential", exact: true }).click(),
  ]);
  assert.equal(response.status(), 200);
  assert.equal((await response.json()).credential.id, credential.id);
  await dialog.waitFor({ state: "hidden" });
  const state = app.store.snapshot();
  const saved = state.credentials.find((item) => item.id === credential.id);
  const vault = new SecretVault(Buffer.alloc(32, 7).toString("base64"));
  assert.equal(vault.decrypt(saved.encryptedToken), replacementToken);
  assert.deepEqual(state.projects.map((project) => project.credentialId), [credential.id, credential.id]);

  const member = await browser.newContext();
  t.after(() => member.close());
  const login = await member.request.post(base + "/api/login", {
    data: { email: memberEmail, password: memberPassword },
  });
  assert.equal(login.status(), 200);
  const memberPage = await member.newPage();
  await memberPage.goto(base + "/credentials");
  await memberPage.getByText("organization-git", { exact: true }).waitFor();
  assert.deepEqual(
    await memberPage.getByRole("combobox", { name: "Organization" })
      .locator("option").evaluateAll((options) => options.map((option) => option.value)),
    [organizationId],
  );
  assert.equal(await memberPage.getByText(credential.name, { exact: true }).count(), 0);
});

test("Git credential editor and team invitations use the new dialogs without losing organization scope", async (t) => {
  const { page, go, context, base } = await fixture(t);
  await go("/credentials");
  await page
    .getByRole("button", { name: "Add credential", exact: false })
    .click();
  const credential = page.getByRole("dialog", { name: "Add Git credential" });
  await credential
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("fixture-git");
  await credential
    .getByLabel("Personal access token", { exact: true })
    .fill("fixture-personal-access-token");
  await credential
    .getByRole("checkbox", { name: "ใช้เป็น default ขององค์กร", exact: true })
    .check();
  await credential
    .getByRole("button", { name: "Save credential", exact: true })
    .click();
  await page.getByRole("cell", { name: "fixture-git", exact: false }).waitFor();
  const creds = await (
    await context.request.get(base + "/api/credentials")
  ).json();
  assert.equal(
    creds.credentials[0].organizationId,
    (await (await context.request.get(base + "/api/access")).json())
      .organizations[0].id,
  );
  await go("/members");
  await page
    .getByRole("button", { name: "Invite member", exact: false })
    .click();
  const invite = page.getByRole("dialog", {
    name: "Invite a teammate",
    exact: true,
  });
  await invite
    .getByRole("textbox", { name: "Email", exact: true })
    .fill("new-person@local.test");
  await invite
    .getByRole("checkbox", { name: "เข้าถึงองค์กรนี้", exact: true })
    .first()
    .check();
  await invite
    .getByRole("button", { name: "Viewer", exact: true })
    .first()
    .click();
  await invite
    .getByRole("button", { name: "Create invitation link", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Invitation link — คัดลอกตอนนี้" })
    .waitFor();
  const invitations = (
    await (await context.request.get(base + "/api/members")).json()
  ).invitations;
  assert.equal(invitations[0].email, "new-person@local.test");
  assert.ok(invitations[0].memberships.length > 0);
});

test("Mail identity and delivery configuration save independently through the new step navigator", async (t) => {
  const { page, go, context, base } = await fixture(t);
  await go("/mail/setup");
  await page.getByRole("button", { name: /Identity$/ }).click();
  await page
    .getByRole("textbox", { name: "Mail hostname", exact: false })
    .fill("mail.example.test");
  await page
    .getByRole("button", { name: "Save hostname", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Domain", exact: true })
    .fill("example.test");
  await page.getByRole("button", { name: "Add domain", exact: true }).click();
  await page.getByRole("button", { name: /Delivery$/ }).click();
  await page
    .getByRole("combobox", { name: "Delivery mode", exact: true })
    .selectOption("relay-587");
  await page
    .getByRole("textbox", { name: "Relay host", exact: true })
    .fill("smtp.example.test");
  await page
    .getByRole("textbox", { name: "Relay username", exact: true })
    .fill("fixture");
  await page
    .getByLabel("Relay password", { exact: false })
    .fill("fixture-relay-password");
  await page
    .getByRole("button", { name: "Save delivery mode", exact: true })
    .click();
  const mail = (await (await context.request.get(base + "/api/mail")).json())
    .mail;
  assert.equal(mail.hostname, "mail.example.test");
  assert.equal(mail.domains[0].domain, "example.test");
  assert.equal(mail.outboundMode, "relay-587");
  assert.equal(mail.relay.hasPassword, true);
  assert.equal(JSON.stringify(mail).includes("fixture-relay-password"), false);
});

test("Mail test shows a failed SMTP submission in place of a previous success", async (t) => {
  const detail = "Hostname/IP does not match certificate's altnames";
  const { app, base, context, session, page, go } = await fixture(t, {
    mailSend: async () => {
      throw new Error(detail);
    },
  });
  await app.store.update((state) => {
    state.mail.configure = { status: "configured" };
    state.mail.mailboxes = [
      { id: "sender", localPart: "sender", domain: "example.test" },
    ];
    state.mail.lastTest = {
      status: "passed",
      at: "2026-09-20T18:43:00.000Z",
      from: "sender@example.test",
      to: "old@example.net",
      detail: "250 Previously queued",
    };
  });
  const delivery = await context.request.post(base + "/api/mail/outbound-mode", {
    headers: { "x-csrf-token": session.csrfToken },
    data: {
      mode: "relay-587",
      relay: {
        host: "smtp.example.test",
        port: 587,
        username: "fixture",
        password: "fixture-password",
      },
    },
  });
  assert.equal(delivery.status(), 200);

  await go("/mail/setup?step=7");
  await page.getByText("250 Previously queued", { exact: false }).waitFor();
  const recipient = page.getByRole("textbox", { name: "Send to" });
  await recipient.fill("new@example.net");
  await page.getByRole("button", { name: "Send test email", exact: true }).click();
  await page
    .getByRole("dialog", { name: "ส่งอีเมลทดสอบ?" })
    .getByRole("button", { name: "ส่งอีเมลทดสอบ", exact: true })
    .click();

  const error = page.locator("form [role=alert]");
  await error.waitFor();
  assert.equal(await error.textContent(), detail);
  await page.getByText("sender@example.test → new@example.net", { exact: true }).waitFor();
  await page.getByText("250 Previously queued", { exact: false }).waitFor({ state: "detached" });
  assert.equal(await recipient.inputValue(), "new@example.net");
});
