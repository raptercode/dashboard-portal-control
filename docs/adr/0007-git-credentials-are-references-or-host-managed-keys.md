# ADR 0007: Git credentials are references or host-managed keys

- Status: Accepted
- Date: 2026-08-03

## Context

Project sync must support private repositories over HTTPS and SSH, but Dashboard/API/audit logs must not store or transmit Git tokens or SSH private keys in plaintext.

## Decision

The user chooses a protocol per project:

- HTTPS: only an environment secret reference name may be stored, such as `HOSTMGR_GIT_TOKEN`; there is no field or API that accepts a token value
- SSH: the Dashboard creates only a deploy-key identifier; the privileged helper on the host creates and stores the private key with appropriate permissions, and the UI may show only the public key when the helper supports it

Git author name/email are normal metadata and may be stored in state. Sync in the Docker demo validates configuration only and does not clone the repository.

## Consequences

- Tokens must be provisioned outside the Dashboard through a secret store/environment the deployment service can access
- The future deployment helper must resolve references with limited privileges and always redact values
- Public repositories may use HTTPS without a credential reference
