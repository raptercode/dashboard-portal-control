import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { PROJECT_FRAMEWORKS } from "../src/core.mjs";
import {
  runtimes,
  frameworks,
  frameworksFor,
  frameworkAllowed,
  frameworkLabel,
  frameworkPatch,
  detectionPatch,
  logoName,
  logoUrl,
  runtimeLabel,
} from "../public/ui/core/runtimes.js";
import { runtimeName } from "../public/ui/core/model.js";

test("the UI offers exactly the frameworks the server accepts, for the same runtimes", () => {
  assert.deepEqual(Object.keys(frameworks), Object.keys(PROJECT_FRAMEWORKS));
  for (const [name, spec] of Object.entries(PROJECT_FRAMEWORKS))
    assert.deepEqual(frameworks[name].runtimes, spec.runtimes, name);
  for (const spec of Object.values(frameworks))
    for (const runtime of spec.runtimes) assert.ok(runtimes[runtime], runtime);
});

test("every runtime and framework has a logo file that is actually served", async () => {
  const names = [
    ...Object.values(runtimes).map((spec) => spec.logo),
    ...Object.keys(frameworks),
  ];
  for (const name of names) {
    const url = logoUrl(name);
    assert.match(url, /^\/ui\/runtime-logos\/[a-z]+\.svg$/, name);
    await access(new URL(`../public${url}`, import.meta.url));
  }
  assert.equal(logoUrl("not-a-framework"), logoUrl("node"));
});

test("framework choices depend on the runtime and a project shows its framework logo", () => {
  assert.deepEqual(
    frameworksFor("python").map((f) => f.name),
    ["django", "flask", "fastapi"],
  );
  assert.deepEqual(frameworksFor("go"), []);
  assert.deepEqual(frameworksFor("docker-compose"), []);
  assert.ok(frameworksFor("bun").some((f) => f.name === "elysia"));
  assert.ok(frameworkAllowed("elysia", "node"));
  assert.ok(!frameworkAllowed("laravel", "node"));
  assert.equal(logoName({ runtime: "node", framework: "next" }), "next");
  assert.equal(logoName({ runtime: "python" }), "python");
  assert.equal(logoName({ runtime: "docker-compose" }), "docker");
  assert.equal(logoName({ runtime: "node", framework: "unknown" }), "node");
  assert.equal(runtimeLabel({ runtime: "node", framework: "next" }), "Next.js");
  assert.equal(runtimeLabel({ runtime: "docker-compose" }), "Docker Compose");
  assert.equal(runtimeName({ runtime: "bun" }), "Bun");
  assert.equal(frameworkLabel("fastapi"), "FastAPI");
});

test("choosing a framework sets its run mode but keeps an entry point the user wrote", () => {
  assert.deepEqual(frameworkPatch("django", { pythonEntry: "main.py" }), {
    pythonMode: "wsgi",
    pythonEntry: "config.wsgi:application",
  });
  assert.deepEqual(frameworkPatch("fastapi", { pythonEntry: "" }), {
    pythonMode: "asgi",
    pythonEntry: "app:app",
  });
  assert.deepEqual(frameworkPatch("flask", { pythonEntry: "src/server:create" }), {
    pythonMode: "wsgi",
  });
  assert.deepEqual(frameworkPatch("laravel"), {
    phpMode: "artisan",
    phpDocroot: "public",
    phpRouter: "",
    phpInstall: "composer",
  });
  assert.equal(frameworkPatch("cakephp").phpDocroot, "webroot");
  assert.equal(frameworkPatch("symfony").phpRouter, "public/index.php");
  assert.deepEqual(frameworkPatch("next"), {});
});

test("a detected candidate becomes a form patch; no build script means skip the build", () => {
  assert.deepEqual(
    detectionPatch({ runtime: "node", buildScript: null, startScript: "start" }),
    { buildScript: "", startScript: "start" },
  );
  assert.deepEqual(
    detectionPatch({ runtime: "bun", buildScript: "build", startScript: null }),
    { buildScript: "build" },
  );
  assert.deepEqual(
    detectionPatch({
      runtime: "python",
      pythonMode: "asgi",
      pythonEntry: "app:app",
      pythonInstall: "project",
      pythonRequirements: "requirements.txt",
    }),
    {
      pythonMode: "asgi",
      pythonEntry: "app:app",
      pythonInstall: "project",
      pythonRequirements: "requirements.txt",
    },
  );
  assert.deepEqual(
    detectionPatch({ runtime: "php", phpMode: "server", phpDocroot: "public", phpRouter: undefined, phpInstall: "composer" }),
    { phpMode: "server", phpDocroot: "public", phpInstall: "composer" },
  );
  assert.equal(detectionPatch({ runtime: "php", phpRouter: null }).phpRouter, "");
  assert.deepEqual(
    detectionPatch({ runtime: "docker-compose", composeFile: "compose.yml", composeService: "web" }),
    { composeFile: "compose.yml", composeService: "web" },
  );
  // Detection never carries unrelated server fields into the draft.
  assert.deepEqual(
    detectionPatch({ runtime: "go", goPackage: "./cmd/api", evidence: [1], notice: "x", confidence: "high" }),
    { goPackage: "./cmd/api" },
  );
});
