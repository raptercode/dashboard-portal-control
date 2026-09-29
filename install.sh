#!/usr/bin/env bash
# Public bootstrap: serve this file as https://dashboard-portal.cloud/install.sh.
set -Eeuo pipefail
umask 077

REPO='https://github.com/raptercode/dashboard-portal-control'
VERSION=''
NODE_MAJOR='24'
TMP_DIR=''
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
usage() {
  printf '%s\n' \
    'Latest stable: curl -fsSL https://dashboard-portal.cloud/install.sh | bash' \
    'Specific version: curl -fsSL https://dashboard-portal.cloud/install.sh | bash -s -- --version v0.8.3' \
    'Version tags must include v (e.g. v0.8.3). Domain and a valid TLS email are required and prompted in the terminal.' \
    'Portal Node major defaults to 24; advanced option: --node-major=20|22|24|26.'
}
while (( $# )); do
  case "$1" in
    --version)
      [[ $# -ge 2 && -z "$VERSION" ]] || die '--version needs one version.'
      VERSION="$2"; shift 2 ;;
    --version=*) [[ -z "$VERSION" ]] || die 'Duplicate version.'; VERSION="${1#*=}"; shift ;;
    --node-major) [[ $# -ge 2 ]] || die '--node-major needs one major.'; NODE_MAJOR="$2"; shift 2 ;;
    --node-major=*) NODE_MAJOR="${1#*=}"; shift ;;
    --help|-h) usage; exit 0 ;;
    *) usage >&2; die "Unknown option: $1" ;;
  esac
done
[[ -z "$VERSION" || "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die 'Version must look like v0.8.3.'
[[ "$NODE_MAJOR" =~ ^(20|22|24|26)$ ]] || die 'Node major must be 20, 22, 24 or 26.'
[[ "$(uname -s)" == 'Linux' ]] || die 'Run on an Ubuntu server.'
source /etc/os-release
[[ "${ID:-}" == 'ubuntu' && ( "${VERSION_ID:-}" == '24.04' || "${VERSION_ID:-}" == '25.04' ) ]] || die 'This release supports Ubuntu 24.04 or 25.04 only.'
[[ "$(uname -m)" == 'x86_64' ]] || die 'This release supports amd64 only.'
for tool in curl tar sha256sum mktemp; do command -v "$tool" >/dev/null || die "Required tool missing: $tool"; done
if [[ $EUID -ne 0 ]]; then command -v sudo >/dev/null || die 'A sudo-capable account is required.'; fi
# stdin contains the script when invoked through curl | bash. Keep every prompt,
# sudo and the underlying password setup on the controlling terminal instead.
{ exec 3<>/dev/tty; } 2>/dev/null || die 'An interactive terminal is required; run the command over an interactive SSH session.'
printf 'Dashboard Portal installation\n' >&3
read -r -p 'Portal domain (e.g. portal.example.com): ' DOMAIN <&3
read -r -p 'Email for TLS certificates: ' EMAIL <&3
[[ "$DOMAIN" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]] || die 'A lower-case fully qualified domain is required.'
[[ "$EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || die 'A valid email is required.'
download() { curl --fail --location --proto '=https' --proto-redir '=https' --tlsv1.2 --silent --show-error "$@"; }
if [[ -z "$VERSION" ]]; then
  RELEASE_URL="$(download -o /dev/null -w '%{url_effective}' "$REPO/releases/latest")"
  VERSION="${RELEASE_URL##*/}"
  [[ "$RELEASE_URL" == "$REPO/releases/tag/$VERSION" && "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die 'Could not resolve the latest stable release.'
fi
TMP_DIR="$(mktemp -d /tmp/dashboard-portal-bootstrap.XXXXXX)"
trap '[[ -z "$TMP_DIR" ]] || rm -rf -- "$TMP_DIR"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
ARCHIVE="dashboard-portal-${VERSION#v}.tar.gz"
printf 'Downloading Dashboard Portal %s...\n' "$VERSION" >&3
download "$REPO/releases/download/$VERSION/$ARCHIVE" -o "$TMP_DIR/$ARCHIVE"
download "$REPO/releases/download/$VERSION/$ARCHIVE.sha256" -o "$TMP_DIR/$ARCHIVE.sha256"
# Check exactly one digest for the requested archive; never execute filenames
# supplied by a remote checksum file or allow extra checksum entries.
CHECKSUM="$(cat "$TMP_DIR/$ARCHIVE.sha256")"
[[ "$CHECKSUM" =~ ^([a-fA-F0-9]{64})[[:space:]]+\*?([^[:space:]]+)$ ]] || die 'Invalid release checksum file.'
EXPECTED_HASH="${BASH_REMATCH[1]}"
[[ "${BASH_REMATCH[2]}" == "$ARCHIVE" ]] || die 'Checksum names a different archive.'
printf '%s  %s\n' "$EXPECTED_HASH" "$TMP_DIR/$ARCHIVE" | sha256sum --check --status || die 'Release checksum verification failed.'
mkdir "$TMP_DIR/release"
tar --extract --gzip --file "$TMP_DIR/$ARCHIVE" --directory "$TMP_DIR/release" --no-same-owner --no-same-permissions
[[ -f "$TMP_DIR/release/dashboard-portal.sh" && -f "$TMP_DIR/release/package.json" ]] || die 'Release is missing the installer or package metadata.'
cd "$TMP_DIR/release"
if [[ $EUID -eq 0 ]]; then
  bash ./dashboard-portal.sh "--domain=$DOMAIN" "--email=$EMAIL" "--node-major=$NODE_MAJOR" <&3
else
  sudo -- bash ./dashboard-portal.sh "--domain=$DOMAIN" "--email=$EMAIL" "--node-major=$NODE_MAJOR" <&3
fi
