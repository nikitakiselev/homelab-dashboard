#!/bin/sh
# Install the central service, or only a remote agent with --agent.
# Usage: curl -fsSL https://raw.githubusercontent.com/nikitakiselev/homelab-dashboard/main/install.sh | sudo sh
set -eu

ROLE=server
REF=main
SOURCE=
WORKDIR=

usage() {
    cat <<'HELP'
Usage: sh install.sh [--agent] [--ref REF] [--source DIRECTORY]
  --agent             Install only the Linux agent (no Node.js or frontend)
  --ref REF           GitHub branch/tag/commit (default: main)
  --source DIRECTORY  Install from an existing checkout, without downloading it
  --help              Show this help without modifying the computer
HELP
}
fail() { printf '\nError: %s\n' "$*" >&2; exit 1; }
cleanup() { if [ -n "$WORKDIR" ]; then rm -rf -- "$WORKDIR"; fi; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
while [ "$#" -gt 0 ]; do
    case "$1" in
        --agent) ROLE=agent; shift ;;
        --ref) [ "$#" -ge 2 ] || fail '--ref needs a value'; REF=$2; shift 2 ;;
        --source) [ "$#" -ge 2 ] || fail '--source needs a directory'; SOURCE=$2; shift 2 ;;
        --help|-h) usage; exit 0 ;;
        *) fail "Unknown argument: $1" ;;
    esac
done
case "$REF" in ''|*[!a-zA-Z0-9._/-]*) fail 'Invalid GitHub ref' ;; esac
[ "$(uname -s)" = Linux ] || fail 'Automatic installation requires Ubuntu or Debian Linux.'
[ "$(id -u)" -eq 0 ] || fail 'Run the installer with sudo sh.'
[ -r /etc/os-release ] || fail 'Cannot determine the Linux distribution.'
# shellcheck disable=SC1091
. /etc/os-release
case " ${ID:-} ${ID_LIKE:-} " in *debian*|*ubuntu*) ;; *) fail 'Supported systems: Debian and Ubuntu.' ;; esac
command -v apt-get >/dev/null 2>&1 || fail 'apt-get is required.'
command -v systemctl >/dev/null 2>&1 || fail 'systemd is required.'
[ -d /run/systemd/system ] || fail 'systemd must be running (including inside LXC).'
export DEBIAN_FRONTEND=noninteractive
printf 'Installing prerequisites for homelab-dashboard (%s)...\n' "$ROLE"
apt-get update -qq
apt-get install -y --no-install-recommends ca-certificates curl python3 python3-yaml
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3,10) else "Python 3.10+ is required. Use Debian 12+ or Ubuntu 22.04+.")'
WORKDIR=$(mktemp -d /tmp/homelab-install.XXXXXXXX)
chmod 755 "$WORKDIR"

fetch() {
    curl --fail --silent --show-error --location --retry 3 --proto '=https' --tlsv1.2 "$1" --output "$2"
}
if [ -z "$SOURCE" ]; then
    printf 'Downloading source (%s)...\n' "$REF"
    fetch "https://api.github.com/repos/nikitakiselev/homelab-dashboard/tarball/$REF" "$WORKDIR/source.tar.gz" ||
        fail 'Cannot download repository. Check your network connection and the requested ref.'
    chmod 644 "$WORKDIR/source.tar.gz"
    mkdir "$WORKDIR/source"
    # Extract untrusted paths as an unprivileged system account.
    if ! id homelab-build >/dev/null 2>&1; then
        useradd --system --no-create-home --shell /usr/sbin/nologin homelab-build
    fi
    chown homelab-build "$WORKDIR/source"
    runuser -u homelab-build -- tar -xzf "$WORKDIR/source.tar.gz" --strip-components=1 -C "$WORKDIR/source"
    SOURCE=$WORKDIR/source
else
    SOURCE=$(cd "$SOURCE" && pwd)
fi
unset HOMELAB_GITHUB_TOKEN GH_TOKEN GITHUB_TOKEN
if [ ! -f "$SOURCE/deploy/install_agent.py" ] || [ ! -f "$SOURCE/homelab/agent/api.py" ]; then
    fail 'Source checkout is incomplete.'
fi
if [ "$ROLE" = server ]; then
    [ -f "$SOURCE/homelab/server/app.py" ] || fail 'Central server source is missing.'
fi
if [ "$ROLE" = agent ]; then
    python3 "$SOURCE/deploy/install_agent.py"
    exit 0
fi

apt-get install -y --no-install-recommends xz-utils util-linux smartmontools sudo
if ! id homelab-build >/dev/null 2>&1; then
    useradd --system --no-create-home --shell /usr/sbin/nologin homelab-build
fi
# Build frontend without giving npm package scripts root permissions.
mkdir "$WORKDIR/build"
cp -R "$SOURCE/frontend" "$WORKDIR/build/frontend"
cp "$SOURCE/package.json" "$SOURCE/package-lock.json" "$SOURCE/tsconfig.json" "$SOURCE/vite.config.js" "$WORKDIR/build/"
NODE=$(command -v node || true)
if [ -z "$NODE" ] || ! "$NODE" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
    case "$(uname -m)" in x86_64) ARCH=x64 ;; aarch64|arm64) ARCH=arm64 ;; *) fail 'Node.js build supports x86_64 and ARM64.' ;; esac
    printf 'Downloading Node.js 22 from nodejs.org...\n'
    # Do not send GitHub credentials to the Node.js download host.
    curl -fsSL --retry 3 --proto '=https' --tlsv1.2 https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt -o "$WORKDIR/SHASUMS256.txt"
    NODE_ARCHIVE=$(awk -v arch="$ARCH" '$2 ~ "^node-v22\\.[0-9]+\\.[0-9]+-linux-" arch "\\.tar\\.xz$" {print $2; exit}' "$WORKDIR/SHASUMS256.txt")
    [ -n "$NODE_ARCHIVE" ] || fail 'Cannot find an official Node.js binary.'
    curl -fsSL --retry 3 --proto '=https' --tlsv1.2 "https://nodejs.org/dist/latest-v22.x/$NODE_ARCHIVE" -o "$WORKDIR/$NODE_ARCHIVE"
    (cd "$WORKDIR"; awk -v name="$NODE_ARCHIVE" '$2 == name {print}' SHASUMS256.txt | sha256sum -c -)
    tar -xJf "$WORKDIR/$NODE_ARCHIVE" -C "$WORKDIR"
    NODE=$WORKDIR/${NODE_ARCHIVE%.tar.xz}/bin/node
fi
chown -R homelab-build "$WORKDIR/build"
printf 'Building dashboard...\n'
NODE_BIN=$(dirname "$NODE")
# $1 is intentionally expanded by the child shell, not this shell.
# shellcheck disable=SC2016
runuser -u homelab-build -- env PATH="$NODE_BIN:$PATH" npm_config_cache="$WORKDIR/build/.npm" sh -c 'cd "$1" && npm ci --no-audit --no-fund && npm run build' sh "$WORKDIR/build"
python3 "$SOURCE/deploy/install_server.py" --source "$SOURCE" --dist "$WORKDIR/build/dist"
