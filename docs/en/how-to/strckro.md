# Strckro: brand, deployments, and CLI migration

[ภาษาไทย](../../th/how-to/strckro.md) · [Documentation index](../README-index.md)

Strckro is the new product name for Dashboard Portal. The control-plane release is `1.0.4`; the renamed npm client is `strckro@0.2.0`, with the commands `skctl` and `strckro`.

```sh
npm install --global strckro
skctl login --server https://portal.example.com --no-browser
skctl deployments list --json
skctl deploy my-app --sync --wait --timeout 300
```

The frontend includes a new login experience, Overview, brand assets, and a dedicated `/deployments` workspace with project/status filters. It reads actual deployment jobs and release metadata; it does not manufacture history. The metadata-only `GET /api/deployments` endpoint respects current project visibility and CLI project binding. Runtime output and secrets stay on their separately authorized APIs. `skctl deployments list [SLUG]` uses this endpoint.

Primary client variables are `STRCKRO_SERVER`, `STRCKRO_TOKEN`, `STRCKRO_PROJECT`, and `STRCKRO_CONFIG_DIR`. Legacy `DASHBOARD_*` aliases remain supported and the new variables take precedence. `skctl init` writes `strckro.json`; `dpctl.json` remains readable when the new file is absent. Saved credentials use the `strckro` config directory, with read fallback to the old `dpctl` directory when no explicit config-directory override is set. Logging in stores the new credential in the new directory; logout clears the default new and legacy credentials. Windows DPAPI protection is unchanged.

The logo is a native SVG mark: an angular S-shaped delivery path between two terminal nodes. Ink `#14221d`, release lime `#d8ff70`, and muted mint `#a4d9bd` are the core colors. Assets are in `public/ui/brand/`: `logo.svg`, `logo-mono.svg`, `wordmark.svg`, `favicon.svg`, and PNG exports. The SVG is the source of truth and scales to favicon, dashboard, and release artwork without a raster-generation dependency.

The product remains one self-managed host with the existing privilege boundary. This release does not rename host directories, service users, `HOSTMGR_*` variables, the root-only `dashboard-portal` command, or signed update archive names/URLs. Keeping these identifiers preserves existing installations and update trust. The runtime service is updated through the established signed release workflow; publishing a release alone does not update a running host.

The deployment metadata projection and page are separate modules (`src/deployments.mjs` and `public/ui/deployments.js`) so future deployment capabilities can grow without embedding a new engine in the presentation layer. The current lifecycle remains source → build → health → activation, with existing restart/rollback behavior.
