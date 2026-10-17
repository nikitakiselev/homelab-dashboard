#!/bin/sh
# Run only in an isolated Debian container with a read-only checkout at /repo.
set -eu
[ -f /.dockerenv ] || { echo 'Container-only test'; exit 1; }
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/tmp/test-apt.log 2>&1
apt-get install -y --no-install-recommends systemd python3 python3-yaml >/tmp/test-apt.log 2>&1
mkdir -p /run/systemd/system
: > /run/homelab-installer-test
cp /repo/tests/systemctl_shim.py /usr/local/bin/systemctl
chmod 755 /usr/local/bin/systemctl
sh /repo/install.sh --source /repo >/tmp/test-server-install.log 2>&1
/usr/bin/python3 - <<'PY'
from pathlib import Path
import json,sqlite3,time
from urllib.request import Request,urlopen
import yaml
values=dict(line.split('=',1) for line in Path('/etc/homelab/dashboard.env').read_text().splitlines())
with urlopen(Request('http://127.0.0.1:8080/api/hosts',headers={'Authorization':'Bearer '+values['HOMELAB_DASHBOARD_TOKEN']})) as response:
    assert json.load(response)['hosts'][0]['local']
Path('/tmp/preserved-env').write_bytes(Path('/etc/homelab/dashboard.env').read_bytes())
config=Path('/etc/homelab/collector.yaml')
value=yaml.safe_load(config.read_text());value['collection']['interval_seconds']=7
config.write_text(yaml.safe_dump(value))
Path('/tmp/preserved-yaml').write_bytes(config.read_bytes())
time.sleep(6)
with sqlite3.connect('/var/lib/homelab/dashboard.sqlite') as db:assert db.execute('SELECT count(*) FROM history').fetchone()[0]>0
print('PASS: central installer built UI, launched real unprivileged Python service and passed authenticated API')
PY
sh /repo/install.sh --source /repo >/tmp/test-server-update.log 2>&1
cmp /tmp/preserved-env /etc/homelab/dashboard.env
cmp /tmp/preserved-yaml /etc/homelab/collector.yaml
systemd-analyze verify /etc/systemd/system/homelab-dashboard.service
printf 'PASS: server update preserved token, YAML and history; systemd unit validated\n'
sh /repo/install.sh --source /repo --agent >/tmp/test-agent-install.log 2>&1
/usr/bin/python3 - <<'PY'
from pathlib import Path
import json
from urllib.request import Request,urlopen
values=dict(line.split('=',1) for line in Path('/etc/homelab/agent.env').read_text().splitlines())
with urlopen(Request('http://127.0.0.1:9108/v1/metrics',headers={'Authorization':'Bearer '+values['HOMELAB_AGENT_TOKEN']})) as response:
    assert 'agent_id' in json.load(response)
assert Path('/etc/homelab/agent.yaml').is_file()
assert not Path('/opt/homelab-dashboard/homelab/server').exists()
print('PASS: lightweight agent installer, YAML and real authenticated metrics API; no server code copied')
PY
systemd-analyze verify /etc/systemd/system/homelab-agent.service
