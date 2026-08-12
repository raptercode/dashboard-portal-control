# UI rewrite brief — full greenfield (not an upgrade)

**Status:** implemented — see `docs/context/ui-rewrite-layout.md`  
**Scope:** replace the entire Dashboard Portal web UI  
**Non-scope:** do not polish, restyle, or incrementally refactor the current `public/` UI

## Hard rule for agents

This is a **full rewrite**. Treat the existing UI as a **reference for behavior and API contracts only**.

- Do **not** “upgrade”, restyle, or patch `public/index.html`, `public/styles.css`, `public/overrides.css`, or `public/app.js` into a nicer version of themselves.
- Build a **new** UI tree (recommended: `public/ui/` or server-rendered views under `views/`) and switch the server to serve it.
- Keep backend / API / helper / security invariants unchanged unless a UI flow truly requires a small additive endpoint (document it).
- Preserve public URL map where possible: `/`, `/setup`, `/projects`, `/credentials`, `/activity`, `/settings` (see `docs/context/ui-rewrite-layout.md`). New routes may be added for multi-step flows (e.g. project create).

## Product context

- Personal single-owner control plane on a **real production Ubuntu host**
- Native projects first; **Docker project deploy is not in this UI rewrite**
- Visual target: **classic admin panel** (dense, flat, functional) — not marketing / SaaS dashboard chrome
- Language: **Thai-first for now**; bilingual is deferred
- Zero CDN / no external font or icon CDN; system fonts OK

## Decisions already made

1. **Project create becomes multi-page**, not a modal wizard  
   Example shape (adjust names as needed):
   - `/projects` — list
   - `/projects/new` — name / org / slug
   - `/projects/new/repository` — repo, branch, scripts, health, credential
   - `/projects/new/review` — confirm + sync  
   Edit existing project can reuse the same pages with an id/slug param, or a separate `/projects/:slug/edit` later.

2. **Do not split today’s single HTML into several static copies**  
   Copy-pasting `index.html` into `overview.html` / `projects.html` without a shared layout will duplicate shell/nav and rot.  
   For this rewrite, choose **one** of:
   - **Preferred if expanding structure:** EJS (or equivalent) with `layout` + `pages` + small partials, served by the existing Node server
   - **Acceptable alternative:** still one shell, but pages as separate templates/partials loaded by a thin router — not N full standalone HTML duplicates

3. **i18n / dual language:** deferred. Ship one language (Thai UI copy). Do not build an i18n framework in this rewrite.

## Must preserve (backend contracts)

Reuse existing APIs and behaviors. Do not redesign the control-plane trust model.

- Auth session, CSRF, Secure cookies
- Doctor / tools install confirmation flow
- Project sync, deploy, rollback, env secrets (keys only in API)
- Domains + DNS check + Certbot path via helper
- Audit activity
- Software update remains SSH/`dashboard-portal update` (no in-browser self-update)

Read before coding:

- `docs/context/architecture.md`
- `docs/context/ui-rewrite-layout.md`
- `docs/context/scope-and-roadmap.md` (features that exist vs planned)
- `docs/releasing-and-ai-handoff.md` (safety rules)

## UX / visual requirements

- One composition per section; admin density over marketing
- No English marketing eyebrows (`YOUR CONTROL PLANE`, etc.)
- Flat surfaces, thin borders, small radius, tight spacing
- Sidebar + workspace shell; tables/lists over decorative cards
- Mobile: usable nav (drawer/menu), forms stack cleanly
- Keep SVG sprite or equivalent local icons (no icon CDN)

## Suggested delivery slices for agents

Do in order; each slice should leave the app usable.

1. **Shell + routing** — layout, nav, page routes, login/boot, logout  
2. **Overview + Setup** — metrics, readiness, tools, git identity  
3. **Projects list + multi-page create/edit + sync**  
4. **Deploy / env / domains / release log dialogs or pages**  
5. **Credentials + Activity + Settings**  
6. **Delete or stop serving the old UI** once the new tree is default

## Out of scope for this rewrite

- v0.5 Docker project deploy
- v0.6 webhooks / auto-deploy
- SSH deploy-key workflow
- Cert expiry UI / nginx diff / drift alerts (can follow after shell exists)
- Bilingual / i18n framework

## Definition of done

- New UI is the only UI served for allowlisted dashboard paths
- Old marketing-style shell is gone from the live path
- Project creation is multi-page
- Existing host workflows still work against current APIs
- `npm test` passes; no secrets in UI responses
- Short note in `docs/context/` if routing or template layout changed

## Prompt seed for a fresh agent

```text
Full greenfield rewrite of Dashboard Portal UI. Do NOT upgrade or restyle the
existing public/index.html + styles + app.js. Build a new UI (prefer EJS
layout+pages, or a new public/ui tree) and switch the server to serve it.
Preserve APIs, auth/CSRF, and helper trust boundaries. Thai-first classic
admin panel look. Project create must be multi-page routes, not a modal
wizard. No i18n, no Docker projects, no webhooks in this pass.
Follow docs/context/ui-rewrite-brief.md.
```
