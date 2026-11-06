# CLI for people, CI and AI agents

[ภาษาไทย](../../th/how-to/cli.md) · [Documentation index](../README-index.md)

The companion project is `strckro`, executable `skctl`; Node.js 20.20.2+ is required. Version `0.2.0` is published on npm: install with `npm install --global strckro` or run `npx --package strckro skctl --help`. To distribute an archive directly, run `npm run pack:release` in the CLI source directory and transfer the resulting `.tgz`, then install with `npm install --global ./strckro-0.2.0.tgz`. Source development also supports `npm link`. Update the backend to this CLI-enabled revision before connecting.

```sh
skctl login --server https://portal.example.com
skctl login --server https://portal.example.com --no-browser
skctl login --server https://portal.example.com --token YOUR_CLI_TOKEN
skctl projects list --json
skctl init --project my-app
skctl env import --file .env.production --json
skctl domains set --domains app.example.com
skctl deploy --sync --wait --timeout 300 --json
skctl domains verify --json
```

Browser login displays a code and URL. Sign into Portal, compare the code with the terminal, then explicitly approve. `--no-browser` prints the URL without opening it and needs no local callback port. Requests expire after ten minutes and exchange for one token exactly once. Create/revoke tokens in **Settings > Account > CLI and AI access**. Tokens expire after 1–90 days (default 30), support project/action scopes, and cannot exceed issuer grants. Default login scopes exclude `env.read`; members with fewer grants must use `--scope`. Account disablement/password changes invalidate tokens. Permissions are checked per request and before mutations commit. Monitor tokens remain read-only.

Windows stores credentials using current-user DPAPI; Linux/macOS use a `0600` file in a `0700` directory under `$XDG_CONFIG_HOME/skctl` or `~/.config/skctl`. Override with `DASHBOARD_CONFIG_DIR`. `logout` removes the local credential; revoke in Portal to invalidate all copies. `--token-stdin` and `DASHBOARD_TOKEN` accept secret-manager input. HTTPS is required except for loopback development, redirects are rejected, and saved credentials are never sent to another origin.

`skctl --help` documents project create/sync/status, deploy/wait, jobs, restart, rollback, logs, domain list/set/clear/check/verify, and env keys/set/unset/import/pull. Use `--json` for AI/CI: one result on stdout, login guidance on stderr. Deploy uses Git source on Portal rather than local file uploads. Domains reuse Nginx/TLS workflows and do not create DNS-provider records. `skctl.json` contains server/project only.

Environment patches preserve other keys/comments, support explicit empty values/removals, and enforce a revision precondition. A stale revision returns HTTP 412 / exit 5, without retry. `env keys` requires `env.read` or `env.write`; writes require `env.write`; `env pull --file PATH` requires `env.read` and creates a new file without printing values. Saving ENV does not deploy.

API: anonymous `POST /api/cli/device/start` and `/poll`; browser-session `GET/POST /api/cli/tokens`, `DELETE /api/cli/tokens/:id`, `GET/POST /api/cli/devices/:userCode` (CSRF for writes). Existing project endpoints accept CLI bearer tokens through an explicit action allow-list. Tokens cannot administer accounts, issue tokens, install host tools or administer Git credentials. `GET /api/projects/:slug/environment/metadata` returns keys/revision. `PATCH /api/projects/:slug/environment` accepts `{ revision, set: { KEY: "value" }, unset: ["OLD"] }`. Server persistence contains hashes of tokens/device secrets; ENV stays encrypted and values stay out of audit.

Exit codes: 0 success, 1 API/deploy, 2 input, 3 auth, 4 permission, 5 revision conflict, 6 network/timeout. HTTP success with `ok:false` returns exit 1. Test backend with `node --test test/cli-api.test.mjs`; run `npm test` in the CLI, setting `DASHBOARD_BACKEND_PATH` to include paired integration tests. Demo tests do not certify Linux deployment, DNS, Nginx or TLS issuance.
