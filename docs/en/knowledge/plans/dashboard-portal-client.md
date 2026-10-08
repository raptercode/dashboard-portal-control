# dashboard-portal-client plan

[ภาษาไทย](../../../th/knowledge/plans/dashboard-portal-client.md) · [Documentation index](../../README-index.md)

- Status: **Proposed** — no client, write token, or new endpoint has been implemented
- Date: 2026-10-09
- Goal: a separate CLI for Windows, Linux, and CI to inspect Portal/projects and change individual environment keys while Portal owns authorization, persistence, encryption, and audit

## Current baseline

| Capability | Implemented now | Client gap |
| --- | --- | --- |
| Portal health | Public `GET /api/health` | Process response only, not project or whole-host health |
| Deploy status | A project-scoped Monitor token reads `GET /api/monitor/v1/projects/:slug/deployments` | No runtime logs, host doctor, or mutation |
| Host doctor / DNS / edge | Web-session endpoints with permissions | No bearer contract for a remote CLI |
| Project ENV | `GET /api/projects/:slug/environment` returns plaintext for `env.read`; `POST` with `mode: replace` writes the whole document for `env.write` | Whole-document replacement can overwrite concurrent edits; legacy `variables` merge cannot set empty values or remove keys |
| Host CLI | Installed `dashboard-portal` command provides help/version/update/configure-update/password reset | It is not a remote client |

The Monitor response in this checkout now uses explicit field lists and excludes `failureLog`; see the [Monitor API reference](../../how-to/monitor-api.md). A source change does not update an installed host.

## Proposed shape

- Separate repository: `dashboard-portal-client`. Executable: `dpctl`, avoiding a name collision with the host's `dashboard-portal` command.
- Portal owns the HTTP contract, authorization, transactions, encryption, and audit. The client handles input, HTTP calls, and output.
- Start with a Node CLI for Windows/Linux and CI. Provide stable `--json` output for AI/automation and concise human output. Document and test the Portal API compatibility range.
- Store the origin/profile in configuration and the token in an OS credential store or CI secret store. Keep tokens out of configuration, logs, URLs, and TLS-insecure requests; see [RFC 6750](https://www.rfc-editor.org/info/rfc6750/).

## Initial commands

| Proposed command | Result | API need |
| --- | --- | --- |
| `dpctl check portal` | HTTP/TLS and process status | Existing `/api/health` |
| `dpctl project status <slug>` | Sync, active release, recent job, failure summary | Existing Monitor API |
| `dpctl project checks <slug>` | Available health/edge/domain checks with timestamps and evidence limits | New project-scoped read endpoint |
| `dpctl host doctor` | Tool and host diagnostics for Masters | New host-scoped endpoint |
| `dpctl env keys <slug>` | Key names and revision, without values | New metadata endpoint |
| `dpctl env set <slug> KEY --stdin` or `--file PATH` | Atomic single-key update; also support `--prompt` and explicit `--empty` | New patch endpoint requiring `env.write` |
| `dpctl env unset <slug> KEY` | Explicit key removal | Same patch endpoint |

Secrets must not be supplied as `KEY=value` command arguments, which can appear in shell history or process listings. The client should not echo values to stdout/stderr or enable request-body debug logging by default. See [OWASP Secrets Management](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html) and [CI/CD Security](https://cheatsheetseries.owasp.org/cheatsheets/CI_CD_Security_Cheat_Sheet.html).

## Portal permissions and ENV contract

1. Keep existing Monitor tokens read-only. Issue a separate client token with project/host scope, action scopes, expiry, revocation, and audited actor identity. Token privileges cannot exceed the issuer's grants; disabling the account or removing grants must invalidate affected tokens.
2. Add an ENV metadata read that returns keys and a revision without values, allowing an `env.write` holder without `env.read` to use `env set`.
3. Add a key-level `PATCH` with distinct `set`, `unset`, and empty-value operations. Check a precondition such as `If-Match`/revision inside the transaction and return `412` for a stale revision. This prevents lost updates as described by [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.1).
4. Reuse existing validation, vault, and audit paths. Audit key names and outcomes, never values. Saving ENV affects the next deployment and does not trigger deployment automatically.
5. Keep `env.read` separate from `env.write`. A future value-read command must explicitly require `env.read`.

## Phases and acceptance

1. **Read-only MVP:** Freeze response and exit-code contracts; implement `check portal` and `project status` with Monitor tokens. Verify Windows/Linux behavior, JSON output, revoked/wrong-project tokens, and network failures.
2. **Scoped checks:** Add client tokens and project/host check endpoints. Verify cross-project and cross-organization denial, expiry/revocation, permission changes, and response minimization.
3. **ENV write:** Add metadata and atomic patch in Portal, then `env keys/set/unset`. Verify write-only grants, empty/unset, 412 conflicts, concurrent writers, encryption/restore, audit redaction, and absence of secrets in output.
4. **Acceptance:** Exercise the client against an installed host with TLS, proxy, account grants, and a subsequent deployment that receives changed ENV. Release the client separately only after its contract and compatibility matrix pass.

The first release excludes deploy/rollback, shell commands, and AI auto-fix. Later mutation commands should reuse Portal's deployment queue, health checks, and audit with distinct scopes.
