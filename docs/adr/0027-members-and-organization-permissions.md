# ADR 0027: Member accounts and organization permissions

Status: Accepted for v0.8.1

## Context

The Portal previously authenticated one owner. A trusted team needs multiple accounts, each with access to several organizations and different capabilities in each. Host administration and shared credential ownership must remain explicit.

## Decision

Use two global account roles, `master` and `user`, with organization memberships containing explicit permission IDs. Presets are convenience templates. Evaluate permissions on the server with default denial for unknown User routes, current account state, stable organization IDs, and project visibility checks. UI visibility follows the same grants.

Masters administer users and organizations and retain global host/credential/database/mail administration. Users receive only organization permissions. Existing owner data migrates once to a Master; renaming organizations does not change resource identity. Keep slugs globally unique to preserve managed host paths.

Store access collections in SQLite metadata under the existing serialized state transaction. Evaluate an optional pre-mutation guard against the latest state before committing a request mutation. Publish the in-memory snapshot only after persistence succeeds. Sessions carry user ID and authorization version; membership/account changes revoke sessions. Delayed request bodies cannot preserve old permissions.

Invitations are Master-created, single-use random tokens with a 48-hour expiry. Store only token hashes, validate tokens before expensive password hashing, rate-limit anonymous acceptance, and revalidate consumption in the transaction. Never disable or demote the last active Master.

Record human account IDs and organization/project context in audit events. Manual deployment jobs retain their initiator and recheck access before execution and activation. Configured project automation is independent of a human session; retirement requires disabling or rotating its triggers.

## Consequences

The existing owner ENV access policy in ADR 0026 now applies through explicit `env.read` and `env.write` permissions for Users; Masters retain access. Creating monitor tokens requires diagnostic access as well as integration management. Only Masters bind host Git credentials, and Users cannot redirect existing bindings.

This remains one shared host for trusted code and collaborators. Organization authorization is not container, kernel, filesystem, or hostile-tenant isolation. See [access control](../access-control.md) and [testing](../testing.md) for the permission matrix and verification scope.
