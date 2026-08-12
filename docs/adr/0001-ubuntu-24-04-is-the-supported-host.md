# ADR 0001: Ubuntu 24.04 LTS is the supported host

- Status: Accepted
- Date: 2026-08-03
- Note: the host-version restriction below is superseded by [ADR 0012](0012-ubuntu-25-04-is-an-operationally-supported-host.md), which adds Ubuntu 25.04 as an operationally supported host. The reasoning and consequences here otherwise still apply.

## Context

The system manages host packages, systemd, Nginx, and Certbot directly, so the first phase needs one repeatable target platform. Earlier docs referenced Ubuntu 25.04, which is past end of support.

## Decision

The first release supports and certifies only Ubuntu Server 24.04 LTS amd64. Every host-changing workflow must be tested on this environment.

A development machine on Ubuntu 25.04 may work with source or run Docker tests, but that does not count as host certification.

## Consequences

- Scripts, package manifests, and install docs must specify Ubuntu 24.04
- The system will not claim support for Ubuntu 26.04 or other distributions until additional ADRs and test evidence exist
- Docker may test service/API and dependency isolation, but separate VM tests are required for package installation, systemd, Nginx reload, and reboot
