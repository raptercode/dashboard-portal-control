import test from "node:test";
import assert from "node:assert/strict";
import {
  sourceCredentials,
  sourceIsLocked,
  defaultSourceCredential,
} from "../public/ui/core/model.js";
const credentials = [
  { id: "ca", organizationId: "a", host: "github.com", isDefault: true },
  { id: "cb", organizationId: "b", host: "github.com", isDefault: true },
  { id: "cg", organizationId: null, host: "github.com" },
];
const access = (role = "user", permissions = ["credentials.use"]) => ({
  user: { role },
  organizations: [
    { id: "a", permissions },
    { id: "b", permissions: ["credentials.use"] },
  ],
});
test("credential options and defaults remain scoped to the organization and Git host", () => {
  assert.deepEqual(
    sourceCredentials(access(), credentials, "a").map((x) => x.id),
    ["ca"],
  );
  assert.equal(
    defaultSourceCredential(
      access(),
      credentials,
      "a",
      "https://github.com/org/repo.git",
      "cg",
    ).id,
    "ca",
  );
  assert.equal(
    defaultSourceCredential(
      access(),
      credentials,
      "a",
      "https://gitlab.com/org/repo.git",
      "cg",
    ),
    null,
  );
  assert.equal(
    defaultSourceCredential(
      access(),
      credentials,
      "a",
      "git@github.com:org/repo.git",
      "cg",
    ),
    null,
  );
  assert.equal(
    defaultSourceCredential(
      access(),
      credentials,
      "b",
      "https://github.com/org/repo.git",
      "cg",
    ).id,
    "cb",
  );
});
test("management permissions alone cannot bind credentials, and legacy / SSH sources stay locked for members", () => {
  assert.deepEqual(
    sourceCredentials(access("user", ["credentials.update"]), credentials, "a"),
    [],
  );
  assert.equal(
    sourceIsLocked(
      access(),
      { organizationId: "a", credentialId: "ca" },
      credentials,
    ),
    false,
  );
  assert.equal(
    sourceIsLocked(
      access(),
      { organizationId: "a", credentialId: "cg" },
      credentials,
    ),
    true,
  );
  assert.equal(
    sourceIsLocked(
      access(),
      { organizationId: "a", sshKeyId: "ssh" },
      credentials,
    ),
    true,
  );
  assert.equal(
    sourceIsLocked(
      access("master"),
      { organizationId: "a", credentialId: "cg" },
      credentials,
    ),
    false,
  );
});
test("master can select a legacy global credential but organization default takes priority", () => {
  assert.deepEqual(
    sourceCredentials(access("master"), credentials, "a").map((x) => x.id),
    ["ca", "cg"],
  );
  assert.equal(
    defaultSourceCredential(
      access("master"),
      credentials,
      "a",
      "https://github.com/org/repo.git",
      "cg",
    ).id,
    "ca",
  );
});
