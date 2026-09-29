# Ubuntu compatibility and platform expansion plan

Localized topic guide; the original detailed record is available in [Thai](../../../th/knowledge/plans/ubuntu-compatibility-plan.md).


Status: research/design, not a support announcement. The detailed original was an untracked planning document and is preserved in Thai. Its v0.8.1 observations are historical: recheck against the current source before implementing changes. Installer acceptance currently remains Ubuntu 24.04/25.04 amd64.

## Screening and scope

Do not promise every Ubuntu release or architecture. Older stock images have libc/kernel/init/package limitations; moving to a maintained LTS is preferable to replacing system libc. Candidate expansion focuses on 22.04/24.04/26.04 amd64 with feature-specific acceptance. Other architectures require matching runtime artifacts/checksums and independent host tests. Server/Desktop/Cloud/WSL/container results are distinct; a WSL read-only OS check or container test does not certify a production host.

The original v0.8.1 baseline noted the Dockerfile lacked scripts/views, unavailable Docker-daemon acceptance, historical test counts, runtime OS requirements and Dovecot 2.4 differences for newer Ubuntu. These observations must not be repeated as current failures: the current Dockerfile already includes scripts/views. Preserve historical logs and record new baseline evidence separately.

## Evidence sequence

1. Metadata/binary preflight: official OS lifecycle, architecture/libc/kernel, apt sources and runtime artifacts/checksums. Record exact version and date; do not expose credentials.
2. Container screening: dependency install, imports/tests, archive content, generated Nginx/Postfix/Dovecot config validated by real binaries; no public mail or host package mutation.
3. Clean VM acceptance: apt, systemd, users/permissions, helper socket, runtime build/start/health, Nginx/TLS, logs, DNS and reboot. Capture OS image/kernel and per-feature pass/fail/blockers.
4. Upgrade/rollback: existing state, organizations/memberships, encryption key, project releases and mail fixtures. Test Portal update separately from supported OS upgrade paths. OS rollback uses VM snapshot/backup, not whole-system apt downgrade. Dovecot 2.3→2.4 needs independent config/data migration and reversible storage handling.
5. Support decision: only expand the gate after evidence, ADR/review and release. Report feature-specific support rather than one blanket success flag.

## Proposed platform architecture

A detector checks kernel/OS family before Linux-specific commands, then ID/VERSION_ID/ID_LIKE, architecture, libc, init, package manager and virtualization. A shared profile registry describes support status, package names/repositories, pinned runtimes/checksums, paths, services and prerequisites for installer/helper/Doctor/updater. Family adapters can share apt/systemd mechanics while retaining distinct Ubuntu/Debian profiles. Other families/platforms remain future work.

Keep preflight readable and refuse unsupported profiles before mutation. Preview selected profile, tools/ports and owned files; plan bounded backups/config validation/reload/rollback. Add detection/profile/package/config tests and real VM acceptance. The public curl bootstrap implemented now only selects/downloads a release and invokes its existing Ubuntu installer; it does not implement this multi-OS architecture or change support policy.

## Next development

Build minimum compatibility fixes only after baseline evidence: shared OS capability profiles, Dovecot-version renderers with validation/recovery, per-feature readiness in UI and documented support matrix. Fresh install, Portal update and OS upgrade each need their own evidence. Read the detailed Thai plan's matrices, sources and final scope before implementing. Do not treat a written plan as successful installation or migrate a production host from this document alone.
