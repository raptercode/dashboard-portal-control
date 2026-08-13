# UI rewrite layout (2026-08)

Greenfield UI is live; the old `public/index.html` shell is not served.

## Layout

- Templates: `views/layout.html`, `views/pages/*`, `views/partials/*`
- Renderer: `src/render.mjs` (zero-dependency include + escape helpers)
- Routes: `src/ui-routes.mjs`
- Assets: `public/ui/admin.css`, `public/ui/app.js`, `public/ui/router.js`

## Routes

`src/ui-routes.mjs` is the route map used by the server. These paths are
intentionally explicit so a browser reload, bookmark, or back/forward
navigation opens the same section. Unknown paths remain a 404.

- `/` — overview (Ready / Down / Pause counts link to `/projects?status=…`)
- `/setup` — host and Git setup
- `/projects` — project management (`?status=ready|down|pause` filters the list)
- `/projects/new` — create project (identity)
- `/projects/new/repository` — create project (repository / scripts)
- `/projects/new/review` — create project (confirm + sync)
- `/projects/:slug/edit` (+ `/repository`, `/review`) — edit existing project
- `/projects/:slug/logs` — runtime log (auto-refreshing) and deployment log for one project
- `/credentials` — repository credentials
- `/databases` — database client connectors
- `/activity` — audit activity
- `/settings` — Portal settings

## Behavior notes

- Thai-first, dark workspace UI; project create/edit is multipage, not a modal wizard
- Draft state between create/edit steps is kept in `sessionStorage`
- Overview shows Ready/Down/Pause counts and host resource cards
- Resource history samples every 5 minutes into SQLite (`metric_samples`), retains 30 days, UI ranges 1/3/7/15/30 via `GET /api/metrics?range=`
- Runtime log viewer polls a project's systemd unit through the root-owned helper; see [ADR 0019](../adr/0019-runtime-project-logs-are-read-through-the-root-owned-helper.md)
- APIs, CSRF, sessions, and helper trust boundaries are unchanged
- Project creation can choose Node.js/systemd or trusted Docker Compose. The latter asks for a repository-relative Compose file and service; Docker-specific host validation is described in ADR 0021.
- Settings owns Monitor Logs Tokens and deployment notification hooks (Discord, Google Chat, Slack, or generic HTTPS); project cards link to the selected project's notification form.
- Project cards keep identity, domain, and status visible; repository, directory, runtime scripts, protocol, port, and environment-key count are in an expandable details section. Operational actions are grouped in a dropdown, and deleting requires an exact project-name confirmation.
- Inbound Git auto-deploy and i18n remain out of scope
