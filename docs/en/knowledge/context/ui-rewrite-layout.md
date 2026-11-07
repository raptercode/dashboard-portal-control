# Strckro Signal UI (2026-11-07)

[ภาษาไทย](../../../th/knowledge/context/ui-rewrite-layout.md)

## Scope

This is a replacement frontend. The former app.js, app.css, page markup, sidebar, dialog partials and page controllers were removed. Brand assets, runtime logos and environment-editor.js remain: the environment parser is also imported by the backend. Backend routes, sessions, CSRF, authorization, deployment helpers, configuration and stored data are unchanged.

## Runtime and layout

views/layout.html and views/mail-layout.html emit the same minimal shell. The small views/pages templates contain route metadata for direct reloads; they do not contain the old interfaces. Existing public URLs continue to resolve through src/ui-routes.mjs. Browser navigation uses the History API and does not reload the document.

- public/ui/main.js: session bootstrap, shared application frame, route transitions, keyboard search, navigation and view lifecycle.
- public/ui/core: safe DOM components, API cache, permission / route models, dialogs, DNS presentation and disposable polling.
- public/ui/screens: lazy-loaded workspace, project, release, infrastructure, Mail, access, settings and authentication modules.
- public/ui/css: the complete responsive visual system, loaded in this order: tokens.css (themes, type, base elements), components.css (controls, ledger, instruments, dialogs), shell.css (host strip, rail, page header) and screens.css (sign-in and screen compositions). No previous stylesheet is loaded underneath it.
- public/ui/brand/hero-track.svg: the animated route shown on the sign-in screen.

The frame is a host strip above a left rail that lists every section at once, so no destination is two clicks away. Below 1040 px the rail becomes a drawer. Overview is an operational inventory and host-health view. Applications use a ledger table that becomes cards on mobile. Clicking an application opens a dedicated sheet for deploy plans, ENV, domains, release history, automation and notifications. Create/edit uses identity, source/runtime and review routes. Mail has a separate step navigator within the same frame.

## Design language

The interface follows one idea from the logo: a release is a track from source to build to serving. Surfaces stay quiet and neutral (warm paper in the light theme, green-black in the dark theme). The single lime signal colour is reserved for what is alive or what to press: primary actions, the active marker and Live state. Nothing is fetched from a third party; type uses the system font stacks.

- Track (`track`): three stations drawn from `pipelineStages(project)` in core/model.js, used in lists, Overview and the application sheet header. Each state is also available as an accessible label.
- Tick gauge (`gauge`): host CPU, memory and disk, amber from 75 % and red from 90 %.
- LED badges, a railway-style release timeline, and a quiet track glyph for empty states.
- Light and dark themes follow the system preference until the user chooses one with the theme button. Motion respects reduced-motion settings.

## Loading and lifecycle contracts

A signed-in Applications cold load needs only /api/session, /api/access and /api/projects. It must not wait for doctor, audit, credentials, Git settings or software updates. Update checks are requested only on System updates. Feature modules are imported when the corresponding screen or application sheet is opened.

The API client deduplicates short-lived reads in memory. Mutations invalidate cached reads; logout clears account state. ENV reads are excluded from caching and token plaintext is never written to browser storage. View generations prevent a delayed module from replacing the current route. Pollers stop on disposal, ignore late responses and pause while the document is hidden. Runtime logs keep their own scroll position.

Normal navigation shows a content skeleton while retaining the shared frame. Local filters do not request data. Dirty forms and ENV require a discard choice before leaving. Application deletion requires its exact name. Token dialogs clear plaintext on close. UI permission checks supplement server authorization; they are not a replacement for it.

## Runtime and framework selection

Runtime and Framework are menus with logos (core/picker.js, with the data in core/runtimes.js), not native selects. core/runtimes.js lists the same frameworks as PROJECT_FRAMEWORKS in src/core.mjs, and a test fails if they drift apart. Optional runtimes that the host lacks (Go, Python, PHP) are shown but cannot be chosen.

Typing or pasting an HTTPS repository URL in the application form fetches the branches and then detects the runtime and framework through /api/projects/runtime-detect, after a short pause. Detection fills the runtime, framework and its settings (for example a Django run mode, or skipping the build when there is no build script) and lists what it found. It never replaces a choice the user makes while it runs. Fetch branches and the detect button remain for repeating it by hand. SSH repositories are not inspected automatically, because the server cannot read them without a deploy key.

## Domains, deployments and releases

The Domains tab reads each domain's DNS, Cloudflare proxy and origin TLS status when it opens and after every change, and shows one readiness state per domain with the A / AAAA records and the Nginx / TLS checks. Refresh only checks; Verify and Verify all change configuration. While one operation runs every control waits. A removal the host refused shows its error and offers an explicit retry. At most ten domains are accepted.

A deployment is one line in the Deploy tab, in the header of the application sheet and on the application lists: the phase it is in, how it ended, a rollback in progress, or a successful rollback after a failure. Logs open only when "ดูรายละเอียด" is pressed, never by themselves. Restart and Rollback name the release and commit they act on, and Rollback says when both releases carry the same commit. Restart reads the application again even when the request failed. Lists repaint only when their data changed, so keyboard focus stays on the row.

## Local preview

~~~powershell
npm run preview:ui
~~~

Open http://127.0.0.1:4343 with preview@strckro.local / Strckro-Preview-2026!.

The preview binds to loopback. It uses a temporary state database and project directory, a fresh vault key and demo-mode operations. It does not load .env or use production state. Ctrl+C stops it. STRCKRO_PREVIEW_PORT overrides the port.

## Validation

~~~powershell
npm test
npm run docs:check
npm run test:ui
~~~

The browser suite needs Playwright and its Chromium browser available to Node. For a development checkout without Playwright, install it with npm install --no-save playwright and npx playwright install chromium. Alternatively set STRCKRO_PLAYWRIGHT_MODULE to an importable module path or file URL; STRCKRO_BROWSER_PATH can select an existing executable. These are test tools, not production dependencies.

The browser tests start isolated demo servers and exercise real UI interactions: request isolation, navigation without document reloads, ENV editing with hidden rows, dirty dismissal, project runtime changes, domains, personal tokens, CLI approval, invitation acceptance, member permissions, Console, Mail settings, authentication and responsive deep links. Backend and security tests remain in the regular suite. Tests that depended on text extraction from the deleted monolith or exact old markup were replaced by tests of the new models and real browser flows.

The controlled performance regression test delays the unrelated software-update endpoint by 600 ms. The former UI requested eight APIs and waited for that endpoint; the interface requests three APIs and never calls it on Applications. Timings measured on the local preview are workstation measurements, not production latency guarantees.
