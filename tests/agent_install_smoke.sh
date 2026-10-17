#!/bin/sh
# Container-only test of Go installation, non-default port, update and rollback.
set -eu
[ -f /.dockerenv ] || exit 1
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/tmp/test-apt.log 2>&1
apt-get install -y --no-install-recommends systemd python3 >/tmp/test-apt.log 2>&1
mkdir -p /run/systemd/system /etc/homelab
: > /run/homelab-installer-test
cp /repo/tests/systemctl_shim.py /usr/local/bin/systemctl
chmod 755 /usr/local/bin/systemctl
cat > /etc/homelab/agent.yaml <<'YAML'
server:
  bind: 127.0.0.1
  port: 19108
collection:
  interval_seconds: 1
  disks:
    enabled: false
  gpu:
    enabled: false
history:
  path: /var/lib/homelab-agent/agent.sqlite
YAML
printf 'HOMELAB_AGENT_TOKEN=container-test-token-not-real-credentials\n' > /etc/homelab/agent.env
chmod 600 /etc/homelab/agent.env
cp /etc/homelab/agent.env /tmp/original-env
cp /etc/homelab/agent.yaml /tmp/original-yaml
/repo/releases/homelab-agent_linux_amd64 install --binary /repo/releases/homelab-agent_linux_amd64
homelab-agent status
sleep 2
/repo/releases/homelab-agent_linux_amd64 install --binary /repo/releases/homelab-agent_linux_amd64
cmp /etc/homelab/agent.env /tmp/original-env
cmp /etc/homelab/agent.yaml /tmp/original-yaml
cat > /tmp/bad-agent <<'BAD'
#!/bin/sh
if [ "$1" = version ]; then echo 'homelab-agent 0.0.0-broken'; exit 0; fi
exit 1
BAD
chmod 755 /tmp/bad-agent
if /repo/releases/homelab-agent_linux_amd64 install --binary /tmp/bad-agent; then
    echo 'FAIL: broken upgrade was accepted'; exit 1
fi
homelab-agent status
cmp /usr/local/bin/homelab-agent /repo/releases/homelab-agent_linux_amd64
cmp /etc/homelab/agent.env /tmp/original-env
cmp /etc/homelab/agent.yaml /tmp/original-yaml
python3 - <<'PY'
import sqlite3
with sqlite3.connect('/var/lib/homelab-agent/agent.sqlite') as db:
    assert db.execute('SELECT sum(samples) FROM history').fetchone()[0]>=2
PY
systemd-analyze verify /etc/systemd/system/homelab-agent.service 2>/tmp/unit-diagnostics
[ ! -s /tmp/unit-diagnostics ] || { cat /tmp/unit-diagnostics; exit 1; }
printf 'PASS: Go installation, custom YAML port, CLI status, repeat update and automatic rollback; history/token/YAML preserved\n'
