# ADR 0009: Projects are organized and HTTPS sync uses temporary AskPass credentials

- Status: Accepted
- Date: 2026-08-03

## Decision

Projects belong to an Organization label and are listed by that label. A project stores one branch and one encrypted `.env` configuration independently from every other project.

For HTTPS sync, the selected encrypted token is decrypted only for the Git operation. The runner creates temporary token and `GIT_ASKPASS` files with restrictive permissions, never puts the token in the repository URL or command arguments, and deletes the temporary files after clone/pull.

## Consequences

- Docker demo can clone/pull real HTTPS repositories into its persistent project volume.
- SSH sync remains blocked until deploy-key generation and public-key registration UX are added.
- Host-mode clone must be wired through the reviewed privileged helper before it is enabled on Ubuntu hosts.
