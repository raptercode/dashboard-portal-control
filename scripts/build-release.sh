#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(sed -nE 's/^[[:space:]]*"version":[[:space:]]*"([^"]+)".*/\1/p' "$ROOT/package.json" | head -n 1)"
[[ -n "$VERSION" ]] || { echo 'Could not read package version.' >&2; exit 1; }
OUTPUT_DIR="${ROOT}/dist"
OUTPUT="${OUTPUT_DIR}/dashboard-portal-${VERSION}.tar.gz"
CHECKSUM="${OUTPUT}.sha256"
mkdir -p "$OUTPUT_DIR"
rm -f -- "$OUTPUT" "$CHECKSUM"

# Normalised metadata makes independently built release archives comparable.
tar --create --gzip --file "$OUTPUT" --directory "$ROOT" \
  --format=posix --sort=name --mtime='@0' --owner=0 --group=0 --numeric-owner \
  --exclude='.env' --exclude='data' --exclude='node_modules' --exclude='.git' --exclude='dist' \
  .
(cd "$OUTPUT_DIR" && sha256sum --binary "$(basename "$OUTPUT")" > "$(basename "$CHECKSUM")")
printf 'Created %s\nChecksum %s\n' "$OUTPUT" "$CHECKSUM"
