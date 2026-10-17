"""Real Linux collector + HTTP + persisted history smoke test; no host privileges."""
import json
import hashlib
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

sys.path.insert(0,str(Path(__file__).resolve().parent.parent))
from homelab.server.app import Dashboard, demo_metrics
from homelab.shared.storage import History
AGENT_VERSION="0.2.1"


def main():
    token='linux-smoke-test-token-not-a-real-credential'
    with tempfile.TemporaryDirectory() as data:
        with socket.socket() as reservation:
            reservation.bind(('127.0.0.1',0))
            port=reservation.getsockname()[1]
        binary=os.environ.get('HOMELAB_AGENT_BINARY',str(Path(__file__).resolve().parent.parent/'releases/homelab-agent_linux_amd64'))
        config=Path(data)/'agent.yaml'
        config.write_text(f'server:\n  bind: 127.0.0.1\n  port: {port}\nhistory:\n  path: {data}/agent.sqlite\n')
        agent_id=hashlib.sha256(Path('/etc/machine-id').read_text().strip().encode()).hexdigest()[:24] if Path('/etc/machine-id').exists() else hashlib.sha256(socket.gethostname().encode()).hexdigest()[:24]
        old=demo_metrics(0);old['timestamp']=time.time()-600
        History(data+'/agent.sqlite').sample(agent_id,old,123,456)
        proc=subprocess.Popen([binary,'run','--config',str(config)],env={**os.environ,'HOMELAB_AGENT_TOKEN':token})
        try:
            base=f'http://127.0.0.1:{port}'
            deadline=time.monotonic()+25
            metrics=None
            while time.monotonic()<deadline:
                try:
                    with urlopen(Request(base+'/v1/metrics',headers={'Authorization':'Bearer '+token}),timeout=2) as response:
                        metrics=json.load(response)
                    if metrics['cpu']['usage'] is not None: break
                except (URLError,HTTPError): pass
                time.sleep(.5)
            assert metrics and metrics['cpu']['usage'] is not None,'CPU sampling failed'
            assert 0<=metrics['cpu']['usage']<=100
            assert metrics['memory']['total']>0
            assert 0<=metrics['memory']['percent']<=100
            assert metrics['uptime']>0
            assert metrics['agent_version']==AGENT_VERSION
            assert metrics['agent_id']==agent_id,'Migration changed machine identity'
            with urlopen(Request(base+'/v1/history?since=0',headers={'Authorization':'Bearer '+token})) as response:
                assert any(r['rx_bytes']==123 for r in json.load(response)['records']),'Go agent lost Python history'
            conflict=subprocess.run([binary,'run','--config',str(config)],env={**os.environ,'HOMELAB_AGENT_TOKEN':token},capture_output=True,text=True,timeout=5)
            assert conflict.returncode!=0 and 'already in use' in conflict.stderr,'Port collision not reported'

            try:
                urlopen(base+'/v1/metrics',timeout=2)
                raise AssertionError('Agent allowed unauthenticated access')
            except HTTPError as error:
                assert error.code==401
                error.close()
            dashboard=Dashboard(data+'/dashboard.sqlite')
            hid=dashboard.add({'name':'linux-smoke','ip':'127.0.0.1','port':port,'token':token})['id']
            # Wait until the automatic poll is done before checking its mirrored history.
            deadline=time.monotonic()+15
            while time.monotonic()<deadline and not dashboard.chart(hid,1): time.sleep(.1)
            assert dashboard.public_hosts()[0]['online']
            assert dashboard.public_hosts()[0]['metrics']['agent_version']==AGENT_VERSION
            assert dashboard.chart(hid,1),'Agent history did not reach dashboard'
            restored=Dashboard(data+'/dashboard.sqlite')
            assert restored.public_hosts()[0]['metrics']['agent_version']==AGENT_VERSION
            assert restored.chart(hid,90),'Dashboard restart lost history'
            builtin=Dashboard(data+'/builtin.sqlite',monitor_self=True)
            try:
                deadline=time.monotonic()+12
                while time.monotonic()<deadline and not builtin.chart('local',1): time.sleep(.2)
                own=builtin.public_hosts()[0]
                assert own['local'] and own['online']
                assert own['port'] is None
                assert builtin.chart('local',1),'Built-in collector did not persist history'
                print('PASS: central server collects its own Linux metrics without an external agent or agent port',flush=True)
            finally:
                builtin.close()
            print('PASS: real Linux CPU/memory/uptime, agent HTTP authorization, host registration, history sync and persistence',flush=True)
        finally:
            proc.terminate()
            proc.wait(timeout=5)

if __name__=='__main__': main()
