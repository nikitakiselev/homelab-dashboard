#!/bin/sh
# Install the prebuilt Go agent. No Go toolchain or Python is needed on the host.
set -eu
[ "$(uname -s)" = Linux ] || { echo 'Linux is required.' >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || { echo 'Run with sudo sh.' >&2; exit 1; }
[ -d /run/systemd/system ] || { echo 'A running systemd instance is required.' >&2; exit 1; }
case "$(uname -m)" in x86_64) arch=amd64 ;; aarch64|arm64) arch=arm64 ;; *) echo 'Supported architectures: x86_64 and ARM64.' >&2; exit 1 ;; esac
release=${1:-latest}
case "$release" in latest|main) base=https://github.com/nikitakiselev/homelab-dashboard/releases/latest/download ;; agent-v*[!a-zA-Z0-9._-]*) echo 'Invalid release tag.' >&2; exit 1 ;; agent-v*) base=https://github.com/nikitakiselev/homelab-dashboard/releases/download/$release ;; *) echo 'Use --ref agent-vX.Y.Z for a specific agent release.' >&2; exit 1 ;; esac
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends ca-certificates curl smartmontools hdparm util-linux
for vendor in /sys/class/drm/card[0-9]*/device/vendor; do
    if [ -f "$vendor" ] && [ "$(cat "$vendor")" = 0x8086 ]; then
        apt-get install -y --no-install-recommends intel-gpu-tools
        break
    fi
done
work=$(mktemp -d /tmp/homelab-agent.XXXXXXXX)
trap 'rm -rf -- "$work"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if [ -n "${HOMELAB_AGENT_BINARY:-}" ]; then
    cp "$HOMELAB_AGENT_BINARY" "$work/homelab-agent"
else
    asset=homelab-agent_linux_$arch
    curl -fsSL --retry 3 --proto '=https' --tlsv1.2 "$base/SHA256SUMS" -o "$work/SHA256SUMS"
    curl -fsSL --retry 3 --proto '=https' --tlsv1.2 "$base/$asset" -o "$work/$asset"
    (cd "$work"; awk -v name="$asset" '$2 == name {print}' SHA256SUMS > expected; [ "$(wc -l < expected)" -eq 1 ]; sha256sum -c expected)
    mv "$work/$asset" "$work/homelab-agent"
fi
chmod 755 "$work/homelab-agent"
"$work/homelab-agent" install --binary "$work/homelab-agent"
