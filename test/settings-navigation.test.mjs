import test from "node:test";
import assert from "node:assert/strict";
import { navigation, can, routeFor } from "../public/ui/core/model.js";
test("navigation only exposes host administration to master and grants credential management independently", () => {
  const user = {
    user: { role: "user" },
    organizations: [
      { id: "a", permissions: ["project.view", "credentials.update"] },
    ],
  };
  const links = navigation(user).flatMap((g) => g.links.map((x) => x[1]));
  assert.ok(links.includes("/credentials"));
  assert.ok(links.includes("/projects"));
  assert.ok(!links.includes("/setup"));
  assert.ok(!links.includes("/settings/updates"));
  assert.ok(!links.includes("/"));
  assert.equal(can(user, "credentials.use", { organizationId: "a" }), false);
  assert.equal(can(user, "credentials.update", { organizationId: "b" }), false);
});
test("navigation recomputes grants rather than retaining hidden group state from a different account", () => {
  const master = { user: { role: "master" }, organizations: [] };
  assert.equal(navigation(master).length, 4);
  const user = { user: { role: "user" }, organizations: [] };
  assert.equal(
    navigation(user).some((g) => g.id === "infrastructure"),
    false,
  );
  assert.equal(
    navigation(master).some((g) => g.id === "infrastructure"),
    true,
  );
});
test("client routes cover all deep links, ignore unsafe settings section names and reject unknown routes", () => {
  assert.equal(routeFor("/settings/account?cli_code=ABC").id, "account");
  assert.equal(routeFor("/settings?section=__proto__").id, "account");
  assert.equal(routeFor("/projects/app/edit/repository").step, 2);
  assert.equal(routeFor("/projects/app/logs").slug, "app");
  assert.equal(routeFor("/mail/setup").id, "mail-setup");
  assert.equal(routeFor("/not-a-page").id, "not-found");
});
