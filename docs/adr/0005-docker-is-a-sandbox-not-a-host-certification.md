# ADR 0005: Docker sandbox does not certify host behaviour

- Status: Accepted
- Date: 2026-08-03

## Context

Users want to develop and test through Docker on their main machine first and point `demo.test` at the container. This product also has capabilities that depend on a real Ubuntu host, such as apt, systemd, file ownership, and Nginx reload.

## Decision

Docker Compose runs the Dashboard in `demo` mode on Ubuntu 24.04 and publishes port 80 for `demo.test` in the test environment. In this mode the installer can exercise allowlist, confirmation, audit, and state transitions, but must not change packages on the Docker host.

Certifying the privileged helper, package installation, systemd, and reboot persistence requires a separate Ubuntu 24.04 VM.

## Consequences

- The UI must clearly show Sandbox mode
- CI may use Docker for API/integration tests that do not touch the host
- Passing Docker tests must not be treated as proof that the real-server installer works
