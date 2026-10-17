import json
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from homelab.server import Dashboard, address, demo_metrics, handler
from homelab.storage import History

TOKEN='a-secure-agent-token-for-tests'

class SystemTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.path=Path(self.tmp.name)/'test.sqlite'
        self.metrics=demo_metrics(0)
        self.agent_history=History(Path(self.tmp.name)/'agent.sqlite')
        self.agent_history.sample(self.metrics['agent_id'],self.metrics,1234,5678)
        owner=self
        class FakeAgent(BaseHTTPRequestHandler):
            def do_GET(self):
                if self.headers.get('Authorization')!='Bearer '+TOKEN:
                    self.send_error(401); return
                if self.path.startswith('/v1/history'):
                    data={'records':owner.agent_history.read(owner.metrics['agent_id'],0)}
                else: data=owner.metrics
                body=json.dumps(data).encode()
                self.send_response(200);self.end_headers();self.wfile.write(body)
            def log_message(self,*args): pass
        self.agent=ThreadingHTTPServer(('127.0.0.1',0),FakeAgent)
        threading.Thread(target=self.agent.serve_forever,daemon=True).start()
        self.dashboard=Dashboard(self.path)

    def tearDown(self):
        self.agent.shutdown(); self.agent.server_close(); self.tmp.cleanup()

    def add(self,token=TOKEN):
        return self.dashboard.add({'ip':'127.0.0.1','port':self.agent.server_port,'token':token,'name':'Test node'})

    def test_add_poll_history_and_restart(self):
        # Suppress asynchronous poll so the test deterministically owns each sync.
        with patch.object(self.dashboard,'poll'):
            hid=self.add()['id']
        self.dashboard.poll()
        host=self.dashboard.public_hosts()[0]
        self.assertTrue(host['online'])
        self.assertNotIn('token',host)
        self.assertEqual(self.dashboard.chart(hid,1)[0]['rx_bytes'],1234)
        # Repeated synchronization replaces a bucket and never duplicates traffic.
        self.dashboard.poll()
        self.assertEqual(self.dashboard.chart(hid,1)[0]['tx_bytes'],5678)
        restarted=Dashboard(self.path)
        self.assertEqual(len(restarted.hosts()),1)
        self.assertIsNotNone(restarted.public_hosts()[0]['metrics'])
        self.assertFalse(restarted.public_hosts()[0]['online'])
        self.assertEqual(restarted.chart(hid,90)[0]['rx_bytes'],1234)
        restarted.delete(hid)
        self.assertEqual(restarted.hosts(),[])
        self.assertEqual(restarted.chart(hid,1),[])

    def test_wrong_token_does_not_register(self):
        with self.assertRaises(HTTPError) as error: self.add('incorrect-but-long-enough-token')
        error.exception.close()
        self.assertEqual(self.dashboard.hosts(),[])

    def test_agent_replacement_detected(self):
        with patch.object(self.dashboard,'poll'): self.add()
        self.metrics['agent_id']='replacement'
        self.dashboard.poll()
        self.assertFalse(self.dashboard.public_hosts()[0]['online'])

    def test_address_restriction(self):
        for ip in ('8.8.8.8','169.254.169.254','0.0.0.0','224.0.0.1','example.com'):
            with self.assertRaises(ValueError): address(ip)
        self.assertEqual(address('192.168.1.20'),'192.168.1.20')

    def test_storage_retention_and_averages(self):
        h=History(Path(self.tmp.name)/'retention.sqlite')
        m=demo_metrics(0); m['timestamp']=time.time()-91*86400
        h.sample('a',m)
        self.assertEqual(h.read('a',0),[])
        m['timestamp']=int(time.time())//300*300+1;m['cpu']['usage']=10
        h.sample('a',m,100,200)
        m['cpu']['usage']=30
        h.sample('a',m,300,400)
        row=h.read('a',0)[0]
        self.assertEqual(row['cpu'],20)
        self.assertEqual(row['rx_bytes'],400)
        self.assertEqual(row['tx_bytes'],600)

    def test_api_auth_and_origin(self):
        api=ThreadingHTTPServer(('127.0.0.1',0),handler(self.dashboard,TOKEN,Path(self.tmp.name)))
        threading.Thread(target=api.serve_forever,daemon=True).start()
        base=f'http://127.0.0.1:{api.server_port}'
        try:
            with self.assertRaises(HTTPError) as err: urlopen(base+'/api/hosts')
            self.assertEqual(err.exception.code,401)
            err.exception.close()
            with urlopen(Request(base+'/api/hosts',headers={'Authorization':'Bearer '+TOKEN})) as r:
                self.assertEqual(json.load(r)['hosts'],[])
            req=Request(base+'/api/hosts',data=b'{}',headers={'Authorization':'Bearer '+TOKEN,'Origin':'https://evil.example'})
            with self.assertRaises(HTTPError) as err: urlopen(req)
            self.assertEqual(err.exception.code,403)
            err.exception.close()
        finally: api.shutdown();api.server_close()

if __name__=='__main__': unittest.main()
