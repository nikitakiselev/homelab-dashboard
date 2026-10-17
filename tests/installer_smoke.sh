#!/bin/sh
# Run only in an isolated Debian container with a read-only checkout at /repo.
set -eu
[ -f /.dockerenv ] || { echo 'Container-only test'; exit 1; }
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/tmp/test-apt.log 2>&1
apt-get install -y --no-install-recommends systemd python3 >/tmp/test-apt.log 2>&1
mkdir -p /run/systemd/system
: > /run/homelab-installer-test
cp /repo/tests/systemctl_shim.py /usr/local/bin/systemctl
chmod 755 /usr/local/bin/systemctl
sh /repo/install.sh --source /repo >/tmp/test-server-install.log 2>&1
/usr/bin/python3 - <<'PY'
from pathlib import Path
import json,sqlite3,time
from urllib.request import Request,urlopen
values=dict(line.split('=',1) for line in Path('/etc/homelab/dashboard.env').read_text().splitlines())
with urlopen(Request('http://127.0.0.1:8080/api/hosts',headers={'Authorization':'Bearer '+values['HOMELAB_DASHBOARD_TOKEN']})) as response:
    assert json.load(response)['hosts']==[]
assert not Path('/etc/homelab/collector.yaml').exists()
Path('/tmp/preserved-env').write_bytes(Path('/etc/homelab/dashboard.env').read_bytes())
config=Path('/etc/homelab/collector.yaml')
config.write_text('Legacy collector settings: no longer used\n')
Path('/tmp/preserved-yaml').write_bytes(config.read_bytes())
with sqlite3.connect('/var/lib/homelab/dashboard.sqlite') as db:
    db.execute('INSERT INTO history VALUES (?,?,?,?,?,?,?,?,?,?)',('local',int(time.time())//300*300,10,20,None,0,0,0,0,1))
print('PASS: central installer built UI, launched real unprivileged Python service and passed authenticated API')
PY
sh /repo/install.sh --source /repo >/tmp/test-server-update.log 2>&1
cmp /tmp/preserved-env /etc/homelab/dashboard.env
cmp /tmp/preserved-yaml /etc/homelab/collector.yaml
systemd-analyze verify /etc/systemd/system/homelab-dashboard.service
if command -v smartctl >/dev/null 2>&1; then echo 'FAIL: dashboard installed SMART tools'; exit 1; fi
if command -v homelab-agent >/dev/null 2>&1; then echo 'FAIL: dashboard installed an agent implicitly'; exit 1; fi
printf 'PASS: server update preserved token, YAML and history; systemd unit validated\n'
HOMELAB_AGENT_BINARY=/repo/releases/homelab-agent_linux_amd64 sh /repo/install.sh --source /repo --agent >/tmp/test-agent-install.log 2>&1
command -v hdparm >/dev/null
homelab-agent doctor | sed -n '/ATA SMART:/p' | grep -q 'enabled=false'
/usr/bin/python3 - <<'PY'
from pathlib import Path
import json,sqlite3,time
from urllib.request import Request,urlopen
values=dict(line.split('=',1) for line in Path('/etc/homelab/agent.env').read_text().splitlines())
with urlopen(Request('http://127.0.0.1:9108/v1/metrics',headers={'Authorization':'Bearer '+values['HOMELAB_AGENT_TOKEN']})) as response:
    assert 'agent_id' in json.load(response)
assert Path('/etc/homelab/agent.yaml').is_file()
assert not Path('/opt/homelab-dashboard/current/homelab/server/collectors').exists()
with sqlite3.connect('/var/lib/homelab/dashboard.sqlite') as db:
    assert db.execute('SELECT count(*) FROM history WHERE host=?',('local',)).fetchone()[0]==1
server_env=dict(line.split('=',1) for line in Path('/etc/homelab/dashboard.env').read_text().splitlines())
headers={'Authorization':'Bearer '+server_env['HOMELAB_DASHBOARD_TOKEN'],'Content-Type':'application/json'}
body=json.dumps({'name':'Local Linux agent','ip':'127.0.0.1','port':9108,'token':values['HOMELAB_AGENT_TOKEN']}).encode()
with urlopen(Request('http://127.0.0.1:8080/api/hosts',data=body,headers=headers)) as response:
    assert response.status==201
with urlopen(Request('http://127.0.0.1:8080/api/hosts',headers=headers)) as response:
    hosts=json.load(response)['hosts']
    assert len(hosts)==1 and hosts[0]['online'] and not hosts[0].get('local')
print('PASS: lightweight agent installer, YAML and real authenticated metrics API; no server code copied')
PY
cd /tmp
homelab-agent version
homelab-agent run --help >/dev/null
systemd-analyze verify /etc/systemd/system/homelab-agent.service
