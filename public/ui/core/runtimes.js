// Runtimes, frameworks and their logos. Pure data: no DOM, so it can be tested
// in Node. `frameworks` must stay in step with PROJECT_FRAMEWORKS in
// src/core.mjs, which the server uses to validate; a test compares them.
export const runtimes = Object.freeze({
  node: {
    label: "Node.js",
    detail: "ใช้ npm หรือ pnpm ตามโปรเจกต์ · pnpm ต้องติดตั้งก่อนใช้งาน",
    logo: "node",
  },
  bun: {
    label: "Bun",
    detail: "ติดตั้ง dependencies และรัน package script ด้วย Bun ใน systemd",
    logo: "bun",
  },
  go: {
    label: "Go",
    detail: "build เป็น binary และรันด้วย systemd",
    logo: "go",
  },
  python: {
    label: "Python",
    detail: "ติดตั้งและรันใน .venv ด้วย user ของโปรเจกต์",
    logo: "python",
  },
  php: {
    label: "PHP",
    detail: "Composer และ PHP built-in server ใน systemd",
    logo: "php",
  },
  "docker-compose": {
    label: "Docker Compose",
    detail: "Compose ที่ผ่าน policy check ก่อน activate",
    logo: "docker",
  },
});
const web = ["node", "bun"];
export const frameworks = Object.freeze({
  next: { label: "Next.js", runtimes: web },
  nuxt: { label: "Nuxt", runtimes: web },
  express: { label: "Express", runtimes: web },
  nestjs: { label: "NestJS", runtimes: web },
  fastify: { label: "Fastify", runtimes: web },
  hono: { label: "Hono", runtimes: web },
  remix: { label: "Remix", runtimes: web },
  sveltekit: { label: "SvelteKit", runtimes: web },
  astro: { label: "Astro", runtimes: web },
  angular: { label: "Angular", runtimes: web },
  elysia: { label: "Elysia", runtimes: ["bun", "node"] },
  django: { label: "Django", runtimes: ["python"] },
  flask: { label: "Flask", runtimes: ["python"] },
  fastapi: { label: "FastAPI", runtimes: ["python"] },
  laravel: { label: "Laravel", runtimes: ["php"] },
  codeigniter: { label: "CodeIgniter", runtimes: ["php"] },
  symfony: { label: "Symfony", runtimes: ["php"] },
  slim: { label: "Slim", runtimes: ["php"] },
  cakephp: { label: "CakePHP", runtimes: ["php"] },
});
// Logo file for every runtime and framework name that has one.
const logoFiles = Object.freeze({
  node: "nodejs",
  bun: "bun",
  go: "go",
  python: "python",
  php: "php",
  docker: "docker",
  next: "nextjs",
  nuxt: "nuxt",
  express: "express",
  nestjs: "nestjs",
  fastify: "fastify",
  hono: "hono",
  remix: "remix",
  sveltekit: "sveltekit",
  astro: "astro",
  angular: "angular",
  elysia: "elysia",
  django: "django",
  flask: "flask",
  fastapi: "fastapi",
  laravel: "laravel",
  codeigniter: "codeigniter",
  symfony: "symfony",
  slim: "slim",
  cakephp: "cakephp",
});
export const logoUrl = (name) =>
  `/ui/runtime-logos/${logoFiles[name] || logoFiles.node}.svg`;
export const frameworkLabel = (name) => frameworks[name]?.label || name || "";
export const frameworkAllowed = (framework, runtime) =>
  !!frameworks[framework]?.runtimes.includes(runtime);
export const frameworksFor = (runtime) =>
  Object.entries(frameworks)
    .filter(([, spec]) => spec.runtimes.includes(runtime))
    .map(([name, spec]) => ({ name, label: spec.label }));
// What to show as a project's logo: its framework, else its runtime.
export function logoName(project = {}) {
  if (project.framework && logoFiles[project.framework]) return project.framework;
  return runtimes[project.runtime]?.logo || "node";
}
export const runtimeLabel = (project = {}) =>
  frameworkLabel(project.framework) ||
  runtimes[project.runtime]?.label ||
  project.runtime ||
  "";
// Choosing a framework by hand sets the run mode that framework normally
// needs. A value the user already customised is left alone.
export function frameworkPatch(framework, draft = {}) {
  const entry = draft.pythonEntry || "";
  const plain = ["", "main.py"];
  const php = (mode, docroot, router) => ({
    phpMode: mode,
    phpDocroot: docroot,
    phpRouter: router,
    phpInstall: "composer",
  });
  switch (framework) {
    case "django":
      return {
        pythonMode: "wsgi",
        ...(plain.concat("app:app").includes(entry)
          ? { pythonEntry: "config.wsgi:application" }
          : {}),
      };
    case "flask":
      return {
        pythonMode: "wsgi",
        ...(plain.concat("config.wsgi:application").includes(entry)
          ? { pythonEntry: "app:app" }
          : {}),
      };
    case "fastapi":
      return {
        pythonMode: "asgi",
        ...(plain.concat("config.wsgi:application").includes(entry)
          ? { pythonEntry: "app:app" }
          : {}),
      };
    case "laravel":
      return php("artisan", "public", "");
    case "codeigniter":
      return php("spark", "public", "");
    case "symfony":
    case "slim":
      return php("server", "public", "public/index.php");
    case "cakephp":
      return php("server", "webroot", "webroot/index.php");
    default:
      return {};
  }
}
const detectionKeys = [
  "goPackage",
  "pythonMode",
  "pythonEntry",
  "pythonInstall",
  "pythonRequirements",
  "phpMode",
  "phpDocroot",
  "phpInstall",
  "composeFile",
  "composeService",
];
// The settings a detected candidate carries, as a patch for the form draft.
// For Node and Bun a missing build script means "skip the build".
export function detectionPatch(candidate = {}, runtime = candidate.runtime) {
  const patch = {};
  for (const key of detectionKeys) if (candidate[key]) patch[key] = candidate[key];
  if (candidate.phpRouter !== undefined) patch.phpRouter = candidate.phpRouter || "";
  if (runtime === "node" || runtime === "bun") {
    patch.buildScript = candidate.buildScript ?? "";
    if (candidate.startScript) patch.startScript = candidate.startScript;
  }
  return patch;
}
