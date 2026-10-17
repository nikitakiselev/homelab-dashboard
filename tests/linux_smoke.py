"""Real Linux collector + HTTP + persisted history smoke test; no host privileges."""
import json
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
from homelab.server import Dashboard


def main():
    token='linux-smoke-test-token-not-a-real-credential'
    with tempfile.TemporaryDirectory() as data:
        with socket.socket() as reservation:
            reservation.bind(('127.0.0.1',0))
            port=reservation.getsockname()[1]
        proc=subprocess.Popen([sys.executable,'-m','homelab.agent','--bind','127.0.0.1',
                               '--port',str(port),'--data',data+'/agent.sqlite'],
                              env={**os.environ,'HOMELAB_AGENT_TOKEN':token})
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
            assert dashboard.chart(hid,1),'Agent history did not reach dashboard'
            restored=Dashboard(data+'/dashboard.sqlite')
            assert restored.chart(hid,90),'Dashboard restart lost history'
            print('PASS: real Linux CPU/memory/uptime, agent HTTP authorization, host registration, history sync and persistence',flush=True)
        finally:
            proc.terminate()
            proc.wait(timeout=5)

if __name__=='__main__': main()
