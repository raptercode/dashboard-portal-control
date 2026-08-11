# ADR 0017: SQLite is the single-host control-plane store

## Status

Accepted

## Context

Deployments can run for minutes while dependency installation and application
builds use host CPU. Running that work inside an HTTP request causes
reverse-proxy timeouts. The original JSON aggregate cannot safely coordinate
durable jobs, leases, and a future worker process.

The product is a single-owner, single-host control plane. Redis would add a
daemon, backup surface, and recovery contract without value for one worker.

## Decision

Use a local SQLite database under the Portal data root as the source of truth
for tools, Git configuration, sessions, credentials, projects, releases,
audit events, and deployment jobs. This cutover initializes a clean database;
the existing JSON file contains disposable test data and is not migrated.

Deployment jobs use transactional state, one global worker, and one queued or
running job per project. The HTTP endpoint returns `202 Accepted` immediately.

## Consequences

- No Redis service, network port, or cache is introduced.
- The UI can poll durable job status and deployment phase events.
- A restart marks an in-flight job as interrupted without switching releases.
- The supported Node 24 runtime supplies `node:sqlite`; its behavior is
  covered by database, queue, and restart-recovery tests.
