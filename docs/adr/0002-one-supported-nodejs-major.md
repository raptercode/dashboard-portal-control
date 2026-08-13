# ADR 0002: Native mode supports one Node.js major version

- Status: Superseded by [ADR 0022](0022-bun-native-project-runtime.md)
- Date: 2026-08-03

## Context

Native mode is intended to stay low-resource and avoid managing multiple runtime versions on the host in the first release.

## Decision

Native mode supports only Node.js **24 LTS** as one major version on the host per Host Manager release. There is no UI to choose or switch Node.js per project.

## Consequences

- Projects that need a different Node.js major must use Docker mode or remain out of first-release scope
- Deployment validation must check Node.js major 24 in both UI and CLI
- Docs must not claim support for PHP or other native runtimes until additional ADRs exist
