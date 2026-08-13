# ADR 0014: Native project build step is optional

- Status: Accepted
- Date: 2026-08-07

## Context

Native Node.js projects use `npm ci` when a valid lockfile is available, then
the dashboard previously required an npm script named `build`. Server-rendered
Express applications often have no compilation step and expose only `start`;
forcing a fictitious `build` script prevents an otherwise valid deployment.

## Decision

`startScript` remains required and is always a constrained npm-script name. A
project may explicitly leave `buildScript` empty, which means the candidate
installs dependencies, skips the build phase, then starts and health-checks the
application. A valid `package-lock.json` uses `npm ci`; an absent or stale
lockfile falls back to `npm install` in the candidate only, without modifying
the synced Git checkout. A supplied build script remains a constrained
npm-script name; free-form shell commands are still prohibited.

The production installer must expose the complete pinned Node distribution on
`/usr/local/bin`, including `node`, `npm`, `npx`, and `corepack`. Deployment
failures are recorded and returned as a bounded, stage-specific diagnostic that
does not include process output or environment values.

## Consequences

- Express and similar runtime-only projects can deploy without a dummy build
  script.
- Frontend projects can continue to use their explicit `build` script.
- The dashboard preserves the npm-script-only security boundary and does not
  persist arbitrary build logs that could expose secrets.
