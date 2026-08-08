# ADR 0008: Persisted credentials and project environment are encrypted

- Status: Accepted
- Date: 2026-08-03

## Context

Private HTTPS repositories need a real token, and projects need a `.env` that can be reused across deployments. Users may choose to store both once and reuse them.

## Decision

The Dashboard accepts HTTPS tokens and `.env` content through authenticated, CSRF-protected requests and encrypts them with AES-256-GCM before writing persistent state. API, audit log, and UI return only credential metadata and environment key names.

`HOSTMGR_SECRET_KEY` is a 32-byte base64 key in the deployment `.env` and must remain unchanged for the lifetime of that state. If the key is lost or changed, previously stored values cannot be decrypted.

Once the host deployment helper is wired, it decrypts values in memory only as needed, uses the token with Git without putting it on the command line/logs, and creates the release `.env` with project-user permissions.

## Consequences

- State backups must also back up `HOSTMGR_SECRET_KEY` securely, or credentials cannot be restored
- Rotating the master key must be a dedicated operation that decrypts and re-encrypts every secret atomically; not supported in v0.1
- Users view/edit `.env` by saving new content, not by reading values back through the UI
