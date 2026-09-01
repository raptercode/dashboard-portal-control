# UI rewrite layout (2026-08)

Greenfield UI is live; the old `public/index.html` shell is not served.

## Layout

- Templates: `views/layout.html`, `views/pages/*`, `views/partials/*`
- Renderer: `src/render.mjs` (zero-dependency include + escape helpers)
- Routes: `src/ui-routes.mjs`
- Assets: `public/ui/admin.css`, `public/ui/v2-source.css`, `public/ui/v2-compat.css`, `public/ui/app.js`, `public/ui/router.js`

## v2 visual system

`public/ui/v2-source.css` is the supplied Dashboard Portal v2 design system,
kept as a separate source asset so its palette, typography, layout, cards,
timeline, and responsive rules remain traceable. `v2-compat.css` adapts the
live server-rendered templates and data-driven controls to that system without
changing any API, session, CSRF, deployment, or secret-handling behaviour.

The visual shell now follows the supplied v2 topbar/sidebar layout. Dashboard,
Projects, Activity, Setup, Credentials, Databases, and Settings are backed by
the Portal's real routes. Mail is a real route with its own app shell for
service and mailbox management. Before Mail service is configured, it presents
a clearly labelled inbox fixture to orient the owner; the fixture and its
compose actions are hidden as soon as setup is configured. The supplied static
examples for Rules, a standalone Nginx view, and standalone
Certificates/Deploys pages are not added as dead routes: their relevant
operations continue to live on real project, domain, log, and settings flows.

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
- `/mail` — standalone Mail application (opened from the Portal navigation in a new tab)
- `/mail/setup` — Mail setup wizard in the same standalone Mail shell

## Behavior notes

- Thai-first, dark workspace UI; project create/edit is multipage, not a modal wizard
- Draft state between create/edit steps is kept in `sessionStorage`
- Overview shows Ready/Down/Pause counts and host resource cards
- Resource history samples every 5 minutes into SQLite (`metric_samples`), retains 30 days, UI ranges 1/3/7/15/30 via `GET /api/metrics?range=`
- Runtime log viewer polls a project's systemd unit through the root-owned helper; see [ADR 0019](../adr/0019-runtime-project-logs-are-read-through-the-root-owned-helper.md)
- APIs, CSRF, sessions, and helper trust boundaries are unchanged
- Project creation can choose Node.js/systemd or trusted Docker Compose. The latter asks for a repository-relative Compose file and service; Docker-specific host validation is described in ADR 0021.
- Settings owns Monitor Logs Tokens. Each project card owns its deployment notification modal for Discord, Google Chat, Slack, or generic HTTPS hooks; the dialog creates and lists only hooks scoped to that project.
- Project cards keep identity, domain, and a concise state visible: green for an active release, yellow while deploying, red for attention required (failed sync/release or down runtime), and gray after a successful sync before the first release. The card does not disclose the failure cause; operators inspect Logs or the action menu. Repository, directory, runtime scripts, protocol, port, and environment-key count are in an expandable details section. Operational actions are grouped in a dropdown, and deleting requires an exact project-name confirmation.
- On desktop, the sidebar can be collapsed to icons and remembers that local preference. Mobile keeps the existing full-label navigation drawer.
- Mail has a compact app header and no Portal sidebar. It shares the Portal's theme, session, host status, and owner identity, and includes a direct link back to the main Portal.
- Inbound Git auto-deploy and i18n remain out of scope
