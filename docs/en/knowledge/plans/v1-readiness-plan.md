# 1.0.0 readiness priorities

## Authorized stable release and latest candidate 2026-10-15

Publication is now authorized. A separate candidate combines v0.8.9 and v1 work with package/lock/changelog 1.0.0. Full Docker 386/386 and exact Node matrix 101 per major, 404 total, passed with no failures/skips. Additional browser checks cover Monitor lifecycle, invitation revoke, member disable and Worker failure/logs/locks; see the [acceptance record](v1-acceptance-record.md). These results supersede the local-validation and compatibility items below. Current sequence: clean committed/tagged candidate → archive/signature/checksum → publication/download verification. Host/Mail and untested interactive-form limits remain in release notes. Stable publication is not a production-host update.

## Complete remaining-work summary after full Docker 2026-10-15 round 2

Latest-source full suite passed **369/369, 0 failed/skipped** with matching before/after hashes for 187 source files. All 121 docs and diff checks passed; this round's containers/image were cleaned. See the [acceptance record](v1-acceptance-record.md). The user confirmed no production target exists and requested no production-test search: Docker/local is this round's boundary, and missing host evidence is recorded below without requesting SSH/VM. Source/package/lock remain 0.8.5 plus dirty changes; 1.0.0 is not released.

### Work remaining before publication, by priority

| Priority | Remaining work | Completion evidence |
| --- | --- | --- |
| P0.1 | Important browser interactions not yet evidenced | Invitation creation/separate-session acceptance/single-use/revoke; grants removal/account disable with an existing session; password form/confirmation/session invalidation; Monitor token create/one-time reveal-copy/revoke on the new page; Worker release creation/progress/logs/edit locks using an accurate fixture (without a helper show awaiting activation, never simulate active). Actual rollback remains a host limitation |
| P0.2 | Compatibility after Worker changes | Relevant Worker/core/access/SQLite checks on Node 20/22/24/26 from final source. The previous 320 matrix executions preceded Worker changes; this latest full run used Node 24.20.0 only |
| P0.3 | Freeze scope and candidate | Select all intended 1.0.0 dirty/untracked files without unrelated work; align package/lock at 1.0.0 and bilingual changelog/release notes including Mail/Worker/host limitations; commit candidate and rerun final checks on that committed source with verified version/commit identity |
| P0.4 | Package and signed artifacts | Use canonical `release:prepare`/`git archive` from a clean committed candidate. Include new Worker helpers/UI/views/docs; exclude `.env`, state/keys, local evidence and dependencies. Verify contents, version/lock/tag, matching public key, Ed25519 signature, SHA-256 and immutable archive URL/feed using the existing key |
| P0.5 | Publish and verify published bytes | On a user release instruction, push branch/tag and publish archive/checksum/signed stable.json; download and verify signature/hash/feed and remote SHA. Changed public bootstrap needs separate bytes/syntax checks. Publication is distinct from production deployment |

`release:prepare` reads the working package version but archives committed HEAD. Freeze and commit first or untracked Worker/UI files are omitted. Avoid the legacy worktree archive script for public release without auditing exclusions: it can include ignored local evidence.

### Unverified host behavior — no production test in this round

| Group | Missing real-host evidence |
| --- | --- |
| Installation / tools | Clean Ubuntu install through public bootstrap/extracted CLI, helper socket/Unix permissions and actual missing runtime/tool provisioning |
| Deployment / recovery | Real helper/systemd/Nginx integration for Native/Compose, domainless Web and supported portless Workers; health/config/start/TLS failure recovery and rollback under an actual service manager |
| DNS / TLS | Public DNS/ACME/HTTPS, provider networking/firewall, Certbot renewal/timer and preservation of unmanaged Nginx |
| Reboot | Portal/helper/Nginx/enabled projects returning after a host reboot. Successful container restart does not prove this |
| Upgrade / restore | Quiescent legacy upgrade, installed Node-major/ownership preservation, whole-host state/encryption-key/application-data/external-DB/volume restore. Passing cross-driver/SQLite fixtures is not whole-host restore |

If publication proceeds without host acceptance, release notes must retain these limits. Docker does not certify every production lifecycle. Worker process checks do not certify queue/job success or exactly-once behavior. Scope is trusted repositories on one host; organization grants are not hostile-tenant isolation.

### Deferred beyond 1.0.0 — not mandatory gates for this scope

- **Mail:** external inbound/outbound, DNS/TLS/provider-edge ports and mailbox recovery; operational acceptance is deferred as agreed.
- **Remote `dpctl`:** still Proposed; client tokens/scopes, metadata/atomic ENV patch and remote deploy/rollback are not implemented. The existing installed host CLI is separate.
- **Unsupported Workers:** PHP, Docker Compose, Python ASGI/WSGI and one-shot/cron jobs.
- **P1 operations:** certificate expiry/renewal UI/alerts/action, standalone stop/restart, scheduled Nginx drift/diff preview, notification retry queue and automated per-project backup/restore.
- **P2:** SSH deploy-key lifecycle, GitLab inbound auto-deploy, log search/time filtering, advanced/import Nginx configuration, browser terminal, more OS/architectures and untrusted-repository isolation.

The following sections retain historical planning/evidence. Use this latest summary for the current work boundary.

## Internal Web / Worker round 2026-10-15

Added domainless Web and portless Workers for Node.js, Bun, Go and Python scripts, with separate UI purpose selection, optional ENV, post-activation process checks and recovery that stops the new consumer before restoring the old one. See the [guide](../../how-to/internal-services-and-workers.md). Full Linux passed 368/368 before the final UI patch; latest focused passed 22/22 after empty-ENV fixes and browser retesting. This round's Docker resources were cleaned. See the [acceptance record](v1-acceptance-record.md). Next P0 gates include real systemd domainless Web and Worker activation/failure/rollback/reboot, plus frozen-candidate installation/upgrade/TLS/restore. Docker does not complete host gates; publication remains deferred.

## Latest Docker round and cleanup 2026-10-14–15

The user authorized Docker. Full Linux 349/349, the exact Node matrix 320 executions, cross-driver restore, real runtime smoke, local browser scenarios and Compose CLI smoke passed. Test containers/images were cleaned and unused build cache reclaimed; state backups and evidence remain local. See the [acceptance record](v1-acceptance-record.md) for scope and corrections. Next gates are frozen-candidate Ubuntu installation/upgrade, public TLS, real helper/systemd/Nginx activation, reboot and whole-host restore. No release was published.

## Implementation round 2026-10-10 — publication deferred

The user requested separate system, UI and verification agents to finish v1 source work, without running Docker or publishing a release. Existing scope remains trusted repositories on one host. Operational Mail is deferred; the remote `dpctl` client remains a separate proposal. Local success does not complete host acceptance.

| Area | Implemented source work | Status |
| --- | --- | --- |
| System | Installer recovery, consistent snapshots, shared maintenance leases and boot tmpfiles; the Monitor GET that writes `lastUsedAt` also holds a lease | Implemented; local/WSL fixtures passed, see latest acceptance record |
| UI | Sidebar groups work/projects, membership/access, host tools and settings, with icons and direct links | Implemented; fresh live visual acceptance pending |
| Settings | Separate templates at `/settings/account`, `/settings/updates`, `/settings/monitor`; `/settings` defaults to account and legacy query links work | Route/render tests passed; responses emit only the selected task's forms |
| Access | Grants, independent ENV read/write, cross-organization denial, CSRF, disabled/revoked accounts and invitation lifecycle | API regressions passed; unverified browser interactions remain pending |
| Handoff | Bilingual documents and acceptance record distinguish implementation, fixtures and host evidence | Updated; version remains 0.8.5, no tag/publication/production deployment |

Before go live: inspect the new UI visually and exercise keyboard/mobile interactions; complete clean install/public TLS/helper permissions, supported runtime deploy/failure/rollback, reboot, quiescent legacy upgrade and whole-host restore on an identified disposable Ubuntu VM/staging target. Then freeze a commit and validate the final candidate. Publication waits for a new user instruction.

[ภาษาไทย](../../../th/knowledge/plans/v1-readiness-plan.md)

Baseline: v0.8.5, commit `a14cf93`, reviewed 2026-10-01. The initial work order preceded implementation; latest results are above and in the acceptance record. It does not authorize production deployment. Scope is one Ubuntu host, trusted repositories and
organization-scoped access; no hostile-tenant sandbox is promised.

Track execution in the [acceptance record](v1-acceptance-record.md). The user
confirmed operational Mail is deferred from 1.0.0; existing Mail functions
remain available without an external-delivery or mailbox-recovery readiness
claim. Current implementation rounds are uncommitted changes on the baseline,
not a final release candidate.

Installer recovery and maintenance exclusion are now implemented in the
working tree; see [ADR 0031](../adr/0031-maintenance-exclusion-and-install-recovery.md).
The first upgrade from legacy versions still requires a quiescent host:
legacy processes do not hold leases, and lock availability does not prove
that their operations have drained. Real upgrade/restore acceptance remains open.

## Initial evidence 2026-10-01 (historical)

The local Windows run on Node v24.11.1 passed 319 tests, failed 0 and skipped
1 of 320 tests. The skipped bootstrap PTY harness requires Linux/WSL.
`docs:check` passed for 109 Markdown files before this documentation update.
Real local Go build and offline Python venv tests passed. These results do
not certify Ubuntu, all supported Node majors, browser flows or production.
The v0.8.4 changelog explicitly leaves interactive browser and host acceptance
unverified. Earlier host evidence must be rerun for the final release candidate.

## P0 — release gates, in execution order

| Order | Work | Completion evidence |
| --- | --- | --- |
| 1 | Freeze scope and acceptance matrix | Record exact candidate commit, Ubuntu image/kernel, Portal Node major and project runtimes. Keep installer support at 24.04/25.04 amd64 until separate compatibility evidence exists. Record trusted-repository limits and whether Mail is part of the operational release claim. |
| 2 | Clean Ubuntu installation | Public bootstrap and extracted-release CLI install without manual edits; login, API/static files, helper socket and service permissions pass. Exercise missing-tool installation from UI. Run the skipped PTY harness on Linux/WSL separately. |
| 3 | Deploy, failure recovery and reboot | Native and Compose apps share Nginx and serve HTTPS. Exercise every advertised runtime; bad build/health/config/TLS paths preserve the prior release and unmanaged Nginx. Explicit rollback succeeds. Reboot restores Portal/helper/Nginx/enabled apps. |
| 4 | Upgrade and restore rehearsal | Upgrade a pre-0.8.3 fixture and v0.8.5 to the candidate. Check legacy Node detection and preservation of the configured major, both SQLite drivers, organizations/grants, credentials and environment. Restore a consistent state/key backup plus required app data on staging; verify login, decryption, ownership and application behavior. |
| 5 | Browser and access acceptance | Actual browser flows for Master, User, Viewer, Operator and Maintainer; invitations, environment grants, sync/deploy/rollback, progress/logs and mobile layout. Pair UI checks with API denial for cross-org access, revoked grants, disabled users and missing CSRF. Check redaction separately from authorized environment reads. |
| 6 | Conditional Mail acceptance | If Mail is advertised as operational, verify real external inbound/outbound delivery, DNS, TLS, provider-edge ports and mailbox recovery. If deferred, document that operational Mail acceptance is incomplete and exclude it from the readiness claim. |
| 7 | Final signed candidate and release | Resolve failures, rerun relevant checks after fixes and full release checks on the final commit. Verify package/lock/tag consistency, archive contents, Ed25519 signature, downloaded SHA-256 and stable feed. Publishing and updating production remain separate actions. |

For each row keep exact commands, sanitized logs, pass/fail/skipped results,
candidate version and remaining limitations. A skipped check stays open unless
its feature is explicitly excluded from the release claim. Fix discovered
defects before adding optional features. Scope or code changes require rerunning
affected acceptance on the final candidate.

## P1 — recommended operations features

These are prioritized development proposals, not implemented features or
mandatory gates unless added to the agreed release scope.

1. Certificate expiry and renewal visibility, then expiry alerts and a guarded
   renewal test/action. Verify the host Certbot timer in P0 even if this UI is deferred.
2. Standalone project stop/restart, with grants, audit, busy-state handling and
   real Native/Compose behavior. Deploy/rollback already exists.
3. Nginx drift alerts and diff preview before applying managed changes.
   `checkDrift()` is currently a primitive without scheduled/UI integration.
4. Notification retry queue with bounded retry and duplicate handling.
5. Per-project backup/restore automation with explicit coverage for external
   databases and Docker volumes. This does not replace the P0 restore rehearsal.

## P2 — deferred expansion

SSH deploy-key lifecycle; GitLab inbound auto-deploy; log time/search filters;
advanced Nginx directives and config import; browser terminal; additional OS
profiles/architectures. These are not required for the proposed narrow 1.0.0.
Untrusted-repository build isolation becomes a prerequisite if that trust
boundary changes; it cannot be inferred from organization permissions.

## Starting point

Start with P0 rows 1–2: define the candidate matrix, then run clean-host
acceptance and record failures. Use those failures to choose fixes before P1
feature development. Consult [testing](../../how-to/testing.md),
[installation and restore](../../how-to/production-install.md),
[release workflow](../../how-to/releasing-and-ai-handoff.md),
[architecture](../context/architecture.md) and
[scope](../context/scope-and-roadmap.md).
