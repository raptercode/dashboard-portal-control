# 1.0.0 acceptance record

## Release candidate 1.0.0 integrated with v0.8.9 — 2026-10-15

The user authorized a stable/production-channel release with no production target. A separate checkout starts from `origin/master` v0.8.9 (`3f611fc`) and integrates v1 work without dropping published pnpm/Prisma/Monitor fixes. Fixed the Prisma Worker integration that injected HTTP PORT/HOST, preserving explicit user ENV, and updated stale VM helper-test contexts. Package/lock/changelog are 1.0.0.

- **Full Linux:** 386/386, 0 failed/skipped, 19.435 seconds on pinned Node 24.18.0 / Go 1.26.3 / Python 3.11.2 / PHP 8.2.34 in Docker, including real pnpm 11.19.0 install/build/HTTP.
- **Node matrix:** 20.20.2 / 22.23.3 / 24.18.0 / 26.10.0 each 101/101, total 404 executions, 0 failed/skipped. The pnpm smoke project uses Node 24; it does not claim pnpm 11 compatibility with Node 20 projects.
- **Source:** unchanged before/after manifest for 191 files, SHA-256 `700106bf0ba6800dfadcbd73ac1f59a6fa87002cf1eadaa8ce7502dced9f0eeb`. All 123 docs and diff checks passed. The first run found two stale VM fixtures and missing harness pnpm; the results above are the final full rerun after corrections.
- **Browser:** Monitor create/one-time reveal/reload-hide/revoke; invitation create/copy/revoke; disabling Viewer through UI invalidates an existing session with 401. Domainless Web/Worker cards are accurate; empty Worker ENV creates a release. Preparation fails as expected without fixture repository source, with visible failure/logs. Failed release history locks service type/runtime and hides HTTP controls. This does not certify successful host activation/rollback or every interactive password/invitation-acceptance form.

Ignored evidence is in `E:/dashboard-control/docs/knowledge-local/v1-release-20261015/`. Signing/publication/download verification follows on the committed/tagged candidate and is separate from production-host updates. Clean install/systemd/Nginx/public TLS/reboot/whole-host restore remain untested; operational Mail remains deferred. Changelog and release notes retain these limits.

## Full Docker of latest source 2026-10-15 round 2

The user requested another full test and a complete remaining-work summary, confirmed that no production target exists, and requested no production-test target search. This round uses Docker/local evidence and records unverified host behavior as limitations; no SSH/VM request or production change.

`npm test` passed **369/369, 0 failed/skipped/cancelled/todo**, 18.007 seconds on Debian 12 / Node 24.20.0 / Go 1.26.3 / Python 3.11.2 / PHP 8.2.34, Docker 29.7.2. The harness pins cached base-image digests, mounts `/app` read-only, uses a temporary project root and `privileged=false`, and has no host Docker socket or user `.env`. Before/after manifests match for 187 source files: SHA-256 `ace781b690b0d86889df373b590c3fcd4c0438a8616ff23e9f878496388ad646`. HEAD is `a14cf934a9a75bfb7e6d37141ac906d5cde49ee9` plus dirty changes. This covers the latest source including the UI ENV fix, but is not a committed 1.0.0 candidate.

Ignored local evidence in `docs/knowledge-local/v1-full-20261015-r2/`: `full-linux.log`, `Dockerfile.test`, `source-manifest-before.json`, `source-manifest-after.json`, `source-verification.log`, `container-metadata.log`, `harness-image.log`. All 121 docs and diff checks passed. This round's container/image were removed and inventory verified empty; other projects' containers/volumes/shared base images were preserved. No production-code edits, version bump, commit, tag, signing or publication.

This supersedes the prior full-suite-before-UI-patch limitation: the latest full suite includes that patch. The 320 Node 20/22/24/26 matrix executions and runtime/Compose/browser/restore smoke from the 14th remain historical evidence, not a rerun of every flow with the current Worker diff. See the [readiness plan](v1-readiness-plan.md) for all remaining and deferred work.

## Domainless Web / portless Worker 2026-10-15

Added `serviceType: web|worker`; legacy projects default to Web. Web deployment allows no domain and avoids Nginx/Certbot when no old managed config exists. Long-running Workers support Node.js/Bun/Go/Python scripts, reserve no port, perform no HTTP probe, inject no PORT/HOST and allow empty ENV. Candidates prepare/build without starting a consumer. Activation stops the old process before switching, then checks the same running PID without crashes/restarts for 5 seconds. Failure attempts to restore the old unit/ENV/current/process; incomplete recovery configuration rejects before stopping the service. This does not certify job processing or exactly-once behavior; cutover may interrupt service briefly. Any release history locks service type and Worker runtime. See the [guide](../../how-to/internal-services-and-workers.md).

| Check | Result and boundary |
| --- | --- |
| Full Linux suite | **368/368, 0 failed/skipped**, 19.392 seconds on Debian 12 / Node 24.20.0 / Go 1.26.3 / Python 3.11.2 / PHP 8.2.34 / WSL2 kernel 6.6.87. This preceded the final UI fixes and additional regression cases, so it is not a full rerun of the final diff |
| Final focused Linux | **22/22, 0 failed/skipped** after final UI fixes: helper 11, model/API 4, service UI 4, project list 3, including empty Worker ENV advancing to Build and previous ENV checks before stopping a service |
| Process smoke | **5 checks passed** with real child processes and filesystem: no start during preparation, old stop before new start, crash rejection and rollback. The command manager is a stub, not real systemd |
| Browser | Created and saved a Worker through all three local demo steps; no port/HTTP controls or domain menu; Web shows no-domain status. Empty Worker ENV advances to Build/Release review, and direct deploy confirms process checks/downtime. Found and fixed the remaining UI mandatory-ENV guard and stale PORT copy, then retested. No real helper activation |
| Documents / cleanup | **121 docs** passed validation; syntax/diff checks passed. Only this round's containers/image were removed; other containers/volumes were preserved. Browser fixture stopped after inspection |

Ignored local evidence: `docs/knowledge-local/v1-worker-20261015/` contains `full-linux.log`, `focused-ui-final.log`, `real-worker-smoke.log`, `container-metadata.log`, `worker-release-review.png`. No commit/tag/version bump/publication. Source remains v0.8.5 baseline `a14cf93` plus dirty changes. Stable release still requires a frozen candidate, clean-host install/upgrade, real systemd/helper/Nginx recovery, domainless Web and portless Worker activation/rollback/reboot, public TLS and whole-host restore. Operational Mail remains deferred.

## Docker acceptance 2026-10-14 and cleanup 2026-10-15

The user explicitly authorized Docker for this test round, overriding the earlier restriction, then requested cleanup. A workstation shutdown interrupted the summary; continuation on the 15th verified saved evidence and completed cleanup without repeating unchanged suites. Source remains v0.8.5 `a14cf93` plus an uncommitted diff; no commit/tag/publication/production deployment occurred.

| Check | Result | Evidence boundary |
| --- | --- | --- |
| Full Linux suite | **349/349 passed, 0 failed, 0 skipped**, 13.303 seconds | Ubuntu 24.04, Node 24.18.0, Go 1.26.3, Python 3.12.3, PHP 8.3.6, Docker 29.7.2; seven internal PTY cases, real Go build/HTTP, Python venv/wheel/HTTP/failure/rollback, real flock/crash/path guards and root tmpfiles passed |
| Node matrix | **80 per version, 320 executions**, 0 failures/skips | Pinned 20.20.2 better-sqlite3 and 22.23.3 / 24.18.0 / 26.10.0 node:sqlite; core/access/auth/secrets/upgrade fixtures, not installed-host provisioning |
| Cross-driver restore | **Six seed/verify runs passed** | Reciprocal Node 20↔24, schema 4 snapshots of 77,824 bytes, restored sessions/login/ENV grants, wrong-key rejection, integrity and persisted writes; not legacy migration or whole-host/key-file restore |
| HTTP acceptance | **12/12 passed** | Settings/static assets, CSRF, organization isolation, invitations/revoke/disabled sessions, ENV grants and simulated sync/deploy/two-release rollback; credential/invitation submissions exercised through API |
| Real runtime smoke | Passed | Node 24.18.0/Bun 1.3.13 actual candidate preparation/queue/build/HTTP health 200; build exit 42 removed candidates while preserving prior release state and a prior fixture process; PHP 8.3.6 source preparation/php-l/built-in server HTTP 200 under UID/GID 65534; no Composer/FPM/helper activation claim |
| Real Compose CLI | **5/5 passed** | Compose 5.4.0 build/up, restart, bad candidate 503/unhealthy with active r1 still 200, promotion to r2 and rollback to r1; manual fixture workflow, not Portal helper/Nginx/TLS integration |
| Browser | Listed scenarios passed | Master Settings split across three pages, desktop and 390×844 mobile; Escape returned menu focus; Viewer had no deploy/host controls and direct Monitor navigation redirected to account; Operator ENV was empty/read-only, missing ENV blocked deployment, then saved Master ENV enabled simulated deployment; explicit Logs showed sandbox notice; Maintainer could read/edit ENV according to grant; unassigned user saw zero projects, no creation control and no empty menu categories |
| Container restart | **Five checks passed** | Existing session, project count, active release ID and ENV decryption persisted, also confirmed in browser; same container writable layer retained, not reboot/volume migration/host restore |

Only tests/fixtures needed correction: the CPU test used real `os.loadavg()` while expecting zero; a scoped mock now checks the exact 75% delta and 50% fallback/100% clamp without changing production behavior. The harness project root moved to `/tmp` because source mounts are read-only. Raw browser seeds lacked protocol; actual sync API normalized them and the seed was corrected. The final full Linux rerun passed all tests.

The demo image was built from the current Dockerfile: `dp-v1-candidate:20261014`, image `sha256:495ebbfa9b8358c199785f647c19f59f366e0ffa0cc90ad6391973b5a2409e24`, non-root `hostmgr`, all capabilities dropped/no-new-privileges, loopback port, no host Docker socket or privileged mode. Logs/scripts/screenshots/synthetic snapshots are retained under ignored `docs/knowledge-local/v1-docker-20261014/`.

Cleanup on the 15th backed up current/previous demo state under `docker-state-backup/`, removed the two remaining demo containers and five test images including the earlier readiness image. Agents had already removed their matrix/runtime/Compose containers and network. `docker builder prune --force` reclaimed 5.566 GB of unused build cache. Other project containers were preserved and all 15 volumes remained unchanged; no named volumes or other projects' images were deleted.

Still required before stable go live: clean Ubuntu install/legacy upgrade, installed runtime/tool/helper permissions, public DNS/ACME/TLS, actual helper/systemd/Nginx activation/failure recovery, reboot and whole-host/key/application-data restore from a frozen candidate commit. Browser results are local fixture scenarios, not all interactive forms or public HTTPS acceptance. Operational Mail stays deferred and remote `dpctl` remains a separate proposal.

## System / UI / independent verification round 2026-10-10

The user requested separate system, UI and verification agents to finish v1 source work. This round ran no Docker, prepared/published no release, created no tag and deployed no production host. Source remains v0.8.5 baseline `a14cf93` plus an uncommitted diff, not a final candidate commit.

- **System:** Monitor GET requests that persist `lastUsedAt` now hold a shared maintenance lease. Busy maintenance returns 503 without state changes; monitoring and usage persistence resume when the lock is free. This complements the earlier installer recovery, consistent snapshots and CLI/helper leases.
- **UI:** Four sidebar categories retain icons/direct links and hide empty groups according to grants. `/settings/account`, `/settings/updates` and `/settings/monitor` use separate templates; responses contain only the selected task's forms. `/settings` defaults to account and legacy query links work. Current-page state and mobile Escape/focus/label behavior were improved.
- **Independent tests:** `npm test` on Windows Node 24.11.1: 348 total, 342 passed, 0 failed, 6 Linux-only skips; 41.570 seconds. The initial run found a Mail/sidebar accessibility-label contract mismatch; it was corrected before the successful full rerun. A final one-line outside-click aria-label correction received another syntax check and an 8/8 Settings/Mail targeted rerun, with no additional full-suite run after that line.
- **Linux fixtures:** Ubuntu WSL 24.04.1, kernel `6.6.87.2-microsoft-standard-WSL2`, root, existing Node 22.16.0: 21/21 passed, 0 skipped across bootstrap, CLI maintenance, installer recovery, maintenance locks and server maintenance. The bootstrap wrapper verifies seven internal PTY cases. No Docker invocation or actual host service-configuration mutation occurred.
- **HTTP smoke:** A current-source loopback Node demo fixture passed project visibility checks for Master/Viewer/Operator/Maintainer/unassigned users, missing-CSRF denial, three Settings routes and the JS module asset. This is not browser acceptance.
- **Documents/checks:** `npm run docs:check` passed for 119 Markdown files; `git diff --check`, JS syntax and `bash -n install.sh dashboard-portal.sh scripts/build-release.sh` passed.

Still open: fresh UI visual/keyboard/mobile acceptance (browser automation was unavailable this round), clean install/public TLS/helper permissions, real Native/Compose deploy/failure/rollback, reboot, quiescent legacy upgrade and whole-host restore on an identified disposable Ubuntu VM/staging target. Operational Mail remains deferred; `dpctl` remains a separate proposed plan. Fixture results do not certify v1 go live. Publication waits for a new user instruction.

## Resumed local checks 2026-10-06

Continued without starting or running Docker. The current uncommitted candidate passed `npm test`: 341 tests, 335 passed, 0 failed, 6 platform skips. Independent recovery/maintenance review found no additional concrete P0 defect. `npm run docs:check` passed for 115 files; `git diff --check` and Bash syntax checks for the installer, wrapper and release script passed.

A localhost Node demo fixture using the current source verified login for an active user without organization membership: Projects showed zero projects and no create controls. At 390 × 844, the empty-state page fit the viewport and the mobile navigation opened and closed. This is limited demo evidence; invitation, access revocation, disabled-user flows, other role/mobile variants and real host deployment remain open. Local screenshot: `docs/knowledge-local/v1-browser-evidence/unassigned-mobile-local.jpg` (ignored).

Next priorities: complete remaining browser/access variants with local fixtures; verify clean install, public TLS, deploy/failure/rollback, reboot, legacy upgrade and whole-host restore on a disposable Ubuntu VM/staging; then freeze a candidate commit and validate the signed release. Legacy upgrades require confirmed quiescence. Mail remains operationally deferred. Version is still 0.8.5; nothing has been tagged, published or deployed to production.

[ภาษาไทย](../../../th/knowledge/plans/v1-acceptance-record.md)

Work order: [readiness priorities](v1-readiness-plan.md). Updated 2026-10-15.
This record separates implemented behavior, local test evidence and operational
acceptance. Pending rows do not certify a release or production deployment.

## Candidate and scope

| Field | Current record |
| --- | --- |
| Source baseline | v0.8.5, `a14cf934a9a75bfb7e6d37141ac906d5cde49ee9` |
| Current changes | Uncommitted implementation and documentation diff on the source baseline; no final candidate commit |
| Final candidate/tag | Pending; repeat affected checks after each code change and final checks on the exact release commit |
| Operational scope | One Ubuntu amd64 host, trusted repositories, organization-scoped access |
| Build boundary | Node/Bun build and candidate execution use the Portal account context; organization grants do not provide hostile-code isolation |
| Mail | Operational Mail is deferred from 1.0.0 readiness; existing Mail features are not a claim of verified external delivery or recovery |
| Test environments | Latest round: user-authorized isolated Docker suites and loopback browser scenarios; earlier Windows/WSL evidence retained; disposable systemd Ubuntu VM/host acceptance pending |

## Release gates

| ID | Priority / check | Status | Required evidence |
| --- | --- | --- | --- |
| A01 | P0 scope | Recorded | Trusted-repository boundary and Mail deferral above; freeze candidate and Ubuntu image/kernel before host testing |
| A02 | P0 local baseline | Current local pass; frozen commit pending | Latest full Docker 369/369, 0 failed/skipped, unchanged source manifest; see round 2 above. Recheck the committed candidate after freezing version/commit |
| A03 | P0 Node matrix | Partial local evidence | Latest pinned 20.20.2 / 22.23.3 / 24.18.0 / 26.10.0 each passed 80 core/access/auth/restore tests; installed provisioning, Node 20 better-sqlite3/other majors node:sqlite integration, project build/start and selected-major upgrade still require acceptance |
| A04 | P0 clean install | Partial local evidence | WSL Linux PTY harness passed 7 tests; actual bootstrap/extracted CLI on Ubuntu 24.04/25.04 amd64, API/static/login/helper permissions and tool installation remain pending |
| A05 | P0 deploy/failure/rollback | Pending | Node/Bun/Go/Python/PHP Native plus Compose, shared Nginx and HTTPS; domainless Web and portless Node/Bun/Go/Python script Workers; rejected build/health/config/TLS/process restores the previous release and unmanaged configuration; explicit rollback |
| A06 | P0 reboot | Pending real host | Reboot disposable VM/host; Portal, helper, Nginx and enabled applications recover; verify Certbot timer |
| A07 | P0 upgrade/restore | Partial fixture evidence; real host pending | Installer recovery fixtures passed; legacy upgrade must start quiescent because old processes do not lease. Pre-0.8.3/v0.8.5 to candidate, both SQLite drivers, major preservation, orgs/grants/ENV/decryption, state plus original key/app-data restore remain host gates |
| A08 | P0 browser/access | Partial local browser/API pass | Master/User and Viewer/Operator/Maintainer flows, invitations, ENV, progress/logs, deploy/rollback/mobile; API rejects cross-org access, revoked grants, disabled users and missing CSRF |
| A09 | Mail operational acceptance | Deferred from 1.0.0 | No readiness claim for external inbound/outbound, provider-edge ports, DNS/TLS or mailbox recovery; require separate acceptance before advertising operational Mail |
| A10 | P0 signed release | Pending | Final tests/docs, version/lock/tag/archive consistency, Ed25519 signature, downloaded SHA-256 and stable feed; publication and production update are separate steps |

Docker/WSL can verify Linux scripts, PTY behavior, dependencies, runtime builds
and selected HTTP/API/browser flows. A container or WSL pass does not close
systemd boot, real reboot, public ACME/TLS, provider networking or VM restore
gates. Record the environment used for every result.

## Run log format

Each small round uses an implementation agent followed by an independent test
agent. Record: round/date, candidate commit plus dirty diff, gate IDs, exact
commands, environment/version, sanitized evidence, pass/fail/skip, defects and
next bounded action. Never put secrets or private host identifiers in this file.

## Recorded rounds

All results below are local evidence from 2026-10-01 on the baseline plus
uncommitted diff. They do not close final-candidate or real-host gates.

| Round | Evidence | Result / remaining boundary |
| --- | --- | --- |
| 1 baseline | Full local suite (`npm test`), Windows Node 24.11.1 | 320 total: 319 pass, 0 fail, 1 Linux PTY skip |
| 1 Linux bootstrap | WSL PTY bootstrap harness | 7 pass; actual public install and host lifecycle remain pending |
| 2 independent checks | Independent focused CLI/installer/bootstrap validation | 13 pass; CLI Go path and reset behavior/docs corrected |
| Node matrix | Core suite on pinned Node 20.20.2 / 22.23.3 / 24.18.0 / 26.10.0 | 68 per version, 272 total pass, 0 fail/skip; installed runtime provisioning remains pending |
| 3 recovery | Existing installer suites plus `node --test test/installer-recovery.test.mjs` | Existing 28 pass; recovery 6 pass: explicit failure, partial backup, independent service state, absent catchall, success, signal codes and busy lease |
| Linux lease | `test/maintenance-lock.test.mjs` on Linux Docker | 4 pass; real systemd/upgrade/reboot still pending |

Recovery and shared-lease behavior are described in
[ADR 0031](../adr/0031-maintenance-exclusion-and-install-recovery.md).
## Pause and latest evidence — 2026-10-01

User requested a pause. Agents finished their rounds. Changes are uncommitted
and package version remains 0.8.5; no tag, publication or production deployment
was performed. Docker demo was stopped and Docker Desktop shutdown requested.
Test images and stopped demo state are retained; other project data/volumes
were not deleted.

- Latest full Windows suite: 340 total, 334 pass, 0 fail, 6 platform skips.
- Linux root focused suite: 35 pass, 0 fail/skip. Boot tmpfiles/recovery had
  separately passed 7 tests; CLI/password/software contract checks passed 12.
- Queue/close regression added after the full run: maintenance integration 5/5
  on Windows/Linux. Strengthened restore regression passed 1 local test. These
  final additions were targeted checks, not a rerun of the full suite.
- Six cross-driver Docker seed/verify runs passed in both directions between
  Node 20.20.2/better-sqlite3 and Node 24.20.0/node:sqlite. Schema 4, consistent
  snapshots 77,824 bytes. Actual restored session, master/member login, granted
  ENV read/denied write, wrong-key rejection, integrity and persisted writes
  pass. This does not certify legacy-version or whole-host restore.
- Browser Docker demo: Master create/sync/ENV/deploy, Viewer read-only controls,
  Operator deploy/rollback without ENV editor, Maintainer ENV read and Escape
  closing logs checked. Final-candidate browser, unassigned user, mobile/access
  variants and real host queued activation remain pending. Local screenshot:
  `docs/knowledge-local/v1-browser-evidence/operator-rollback-demo.jpg` (ignored).

Resume by reviewing the dirty candidate and rerunning final checks after any
changes. Supply a disposable Ubuntu VM/staging target and test domain for clean
install, public TLS, real deployment/rollback/reboot and legacy upgrade/whole-host
restore. First legacy upgrade must be quiescent. Mail stays outside operational
1.0.0 claims; P1 features remain proposals. The gate table above remains open
where this latest local evidence does not establish host acceptance.
