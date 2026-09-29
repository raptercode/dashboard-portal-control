# ADR 0022: Project auto deploy trigger modes

- Status: Accepted
- Date: 2026-09-29

## Context

Project source polling already syncs each configured branch every five minutes. The owner needs automatic deployment without configuring CI, and an optional way to wait until a CI workflow passes before deployment. An inbound hook must not provide a shell command, arbitrary repository, branch, or revision to deploy.

## Decision

Each project has one active auto deploy mode: `poll`, `github`, or `actions`. The `poll` mode deploys a new revision found by periodic or owner-initiated sync. The `github` mode accepts a signed GitHub push for the configured repository and branch and keeps polling as a fallback. The `actions` mode lets polling update the source checkout but never deploys from polling or owner sync; only the project-scoped Actions hook can queue a release after CI calls it. Changing mode requires an authenticated owner action.

The GitHub hook validates `X-Hub-Signature-256` over the raw request body. The Actions hook requires a random bearer token. Both credentials are stored encrypted with the Portal vault, returned once when created or rotated, removed from project API responses, and never sent to the privileged helper. Hooks only request a sync of the project's configured branch; they cannot choose a commit or run a command. A new release uses the existing durable deployment queue, candidate health check, host activation, and rollback behavior. Duplicate revisions do not create duplicate healthy releases. A hook received while a sync or deployment is running is coalesced into a later source check.

## Consequences

Polling mode needs no GitHub or CI configuration, but may take up to five minutes to discover a commit. GitHub push mode is faster when deliveries arrive; polling covers missed deliveries. Actions mode gives CI a deployment gate, so a missed hook leaves the new revision synced but undeployed until CI retries the hook or the owner changes mode. Disabling the Actions hook stops automatic release creation. The Portal release workflow remains separate from managed project deployment.
