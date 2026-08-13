# ADR 0021: Trusted Docker Compose project runtime

- Status: Accepted
- Date: 2026-08-14

## Context

The owner needs projects that cannot use the fixed Node.js/systemd contract.
The Portal remains a single-owner control plane, so running a project image or
Dockerfile is already execution of owner-selected code. It must not turn the
browser into a general root shell or present local Docker sandbox tests as host
acceptance.

## Decision

Projects may select `docker-compose` with a repository-relative YAML file and
one web service. The unprivileged Portal copies an immutable release candidate;
the root-owned helper validates `docker compose config`, rejects privileged
containers, host network/PID/IPC namespaces, and host bind mounts, and requires
the chosen service to publish the configured project port. It then builds and
starts the release during host activation, checks the configured HTTP endpoint,
and restores the previous Compose release if activation, health, domain, or TLS
fails. Runtime logs are read through the same helper.

Docker Compose deployment is only for trusted owner repositories. These checks
are guardrails, not a security boundary against a malicious Dockerfile, image,
or container process. The Portal's own `compose.yaml` remains a local sandbox;
Ubuntu host validation remains mandatory for real deployment behaviour.

## Consequences

- Node projects retain isolated candidate build/health before activation.
- Docker builds happen in the controlled helper activation phase, so release
  events disclose that distinction rather than claiming an isolated container
  candidate was already running.
- Docker Engine + Compose must be installed before syncing a Docker project.
- Inbound auto-deploy remains out of scope; typed helper operations remain the
  only route to privileged host changes.
