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
from homelab.server.app import Dashboard, address, demo_metrics, handler
from homelab.shared.storage import History

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

    def test_dashboard_does_not_add_implicit_local_host(self):
        self.assertEqual(self.dashboard.public_hosts(),[])
        with patch.object(self.dashboard,'poll'):
            hid=self.add()['id']
        host=self.dashboard.public_hosts()[0]
        self.assertEqual(host['id'],hid)
        self.assertEqual(host['ip'],'127.0.0.1')
        self.assertEqual(host['port'],self.agent.server_port)
        self.assertNotIn('local',host)
        self.dashboard.delete(hid)
        self.assertEqual(self.dashboard.public_hosts(),[])

    def test_temperature_polling_is_independent_of_agent_history(self):
        self.metrics['gpus'] = [{'name': 'Test GPU', 'usage': 20,
                                'memory_used': None, 'memory_total': None, 'temperature': 42}]
        with patch.object(self.dashboard, 'poll'):
            hid = self.add()['id']
        self.dashboard.poll()
        result = self.dashboard.temperatures.read(hid, 1)
        self.assertEqual(len(result['series']), 4)
        sensor = next(s['id'] for s in result['series'] if s['kind'] == 'gpu')
        self.assertEqual(next(r['values'][sensor] for r in result['records'] if sensor in r['values']), 42)
        self.dashboard.poll()
        self.assertEqual(self.dashboard.temperatures.read(hid, 1), result)
        restarted = Dashboard(self.path)
        self.assertEqual(restarted.temperatures.read(hid, 1), result)
        restarted.delete(hid)
        self.assertEqual(restarted.temperatures.read(hid, 1)['series'], [])

    def test_deletion_serializes_with_inflight_temperature_persistence(self):
        with patch.object(self.dashboard, 'poll'):
            hid = self.add()['id']
        paused = threading.Event()
        resume = threading.Event()
        deleting = threading.Event()
        sample = self.dashboard.temperatures.sample

        def delayed_sample(*args):
            paused.set()
            self.assertTrue(resume.wait(5))
            return sample(*args)

        def delete():
            deleting.set()
            self.dashboard.delete(hid)

        with patch.object(self.dashboard.temperatures, 'sample', side_effect=delayed_sample):
            poll = threading.Thread(target=self.dashboard.poll_host, args=(self.dashboard.hosts()[0],))
            poll.start()
            self.assertTrue(paused.wait(5))
            remove = threading.Thread(target=delete)
            remove.start()
            self.assertTrue(deleting.wait(5))
            # Before resuming, require deletion either to wait for the lifecycle
            # lock or (the bug) to have removed the row behind the poll's back.
            deadline = time.monotonic() + 2
            while self.dashboard.hosts() and time.monotonic() < deadline:
                time.sleep(.01)
            resume.set()
            poll.join(10)
            remove.join(10)
        self.assertFalse(poll.is_alive())
        self.assertFalse(remove.is_alive())
        self.assertEqual(self.dashboard.hosts(), [])
        self.assertEqual(self.dashboard.temperatures.read(hid, 1)['series'], [])

    def test_previous_builtin_history_is_preserved_without_collecting(self):
        self.dashboard.history.sample('local',self.metrics)
        self.dashboard.close()
        restored=Dashboard(self.path)
        self.assertEqual(restored.public_hosts(),[])
        self.assertTrue(restored.chart('local',1))
        self.assertTrue(restored.chart('local',90))

    def test_dashboard_retention_is_independent(self):
        dashboard=Dashboard(Path(self.tmp.name)/'short.sqlite',retention_days=1)
        old={**self.metrics,'timestamp':time.time()-2*86400}
        dashboard.history.sample('host',old)
        self.assertEqual(dashboard.chart('host',7),[])
        with self.assertRaises(ValueError):Dashboard(self.path,retention_days=0)

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

    def test_sync_continues_short_pages_with_disk_history(self):
        with patch.object(self.dashboard,'poll'):
            hid=self.add()['id']
        row=self.agent_history.read(self.metrics['agent_id'],0)[0]
        first={**row,'bucket':row['bucket']-600}
        second={**row,'bucket':row['bucket']-300}
        pages=iter([{'records':[first],'has_more':True},{'records':[second],'has_more':False}])
        def reply(ip,port,token,path):
            return next(pages) if path.startswith('/v1/history') else self.metrics
        with patch('homelab.server.app.agent_get',side_effect=reply):
            self.dashboard.poll()
        rows=self.dashboard.history.read(hid,0)
        self.assertEqual(len(rows),2)
        self.assertEqual(rows[0]['disk_io'],row['disk_io'])
        self.assertEqual(rows[1]['disk_io'],row['disk_io'])
        self.dashboard.delete(hid)
        with self.dashboard.history.connect() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM disk_history').fetchone()[0],0)

    def test_chart_periods_keep_nullable_metrics_and_traffic(self):
        # Two buckets in one six-hour interval, with different sample counts.
        bucket=int(time.time()-86400)//21600*21600
        rows=[dict(bucket=bucket,cpu=10,memory=20,gpu=None,rx=100,tx=200,
                   rx_bytes=1000,tx_bytes=2000,samples=1),
              dict(bucket=bucket+300,cpu=30,memory=40,gpu=60,rx=300,tx=400,
                   rx_bytes=3000,tx_bytes=4000,samples=3),
              dict(bucket=bucket+21600,cpu=None,memory=50,gpu=None,rx=0,tx=0,
                   rx_bytes=0,tx_bytes=0,samples=1)]
        self.dashboard.history.mirror('test',rows)
        for days in (7,30,90):
            with self.subTest(days=days):
                result=self.dashboard.chart('test',days)
                self.assertEqual(len(result),2)
                self.assertEqual(result[0]['cpu'],25)
                self.assertEqual(result[0]['memory'],35)
                self.assertEqual(result[0]['gpu'],60)
                self.assertEqual(result[0]['rx'],250)
                self.assertEqual(result[0]['rx_bytes'],4000)
                self.assertEqual(result[0]['tx_bytes'],6000)
                self.assertIsNone(result[1]['cpu'])
                self.assertIsNone(result[1]['gpu'])
        with patch('homelab.server.app.time.time',return_value=bucket+22000):
            self.assertEqual(len(self.dashboard.chart('test',1)),3)

    def test_demo_gpu_history(self):
        dashboard=Dashboard(self.path,demo=True)
        for days in (1,7,30,90):
            with self.subTest(days=days):
                self.assertTrue(all(0<=p['gpu']<=100 for p in dashboard.chart('demo-1',days)))
                self.assertTrue(all(p['gpu'] is None for p in dashboard.chart('demo-0',days)))

    def test_history_api_periods_and_server_page_fallback(self):
        (Path(self.tmp.name)/'index.html').write_text('<html>dashboard</html>')
        api=ThreadingHTTPServer(('127.0.0.1',0),handler(self.dashboard,TOKEN,Path(self.tmp.name)))
        threading.Thread(target=api.serve_forever,daemon=True).start()
        base=f'http://127.0.0.1:{api.server_port}'
        try:
            for days in (1,7,30,90):
                with urlopen(Request(base+f'/api/history/test?days={days}',headers={'Authorization':'Bearer '+TOKEN})) as r:
                    self.assertEqual(json.load(r),{'records':[]})
            with self.assertRaises(HTTPError) as err:
                urlopen(Request(base+'/api/history/test?days=14',headers={'Authorization':'Bearer '+TOKEN}))
            self.assertEqual(err.exception.code,400)
            err.exception.close()
            with urlopen(base+'/servers/test') as r:
                self.assertEqual(r.read(),b'<html>dashboard</html>')
        finally: api.shutdown();api.server_close()

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


    def test_dashboard_version_api_requires_auth_and_reports_build(self):
        from homelab.server.version import release_info
        server=ThreadingHTTPServer(('127.0.0.1',0),handler(self.dashboard,TOKEN,Path(self.tmp.name)))
        threading.Thread(target=server.serve_forever,daemon=True).start()
        base=f'http://127.0.0.1:{server.server_port}'
        try:
            with self.assertRaises(HTTPError) as error:urlopen(base+'/api/version')
            self.assertEqual(error.exception.code,401)
            error.exception.close()
            with urlopen(Request(base+'/api/version',headers={'Authorization':'Bearer '+TOKEN})) as response:
                self.assertEqual(json.load(response),release_info())
            with urlopen(Request(base+'/api/hosts',headers={'Authorization':'Bearer '+TOKEN})) as response:
                self.assertEqual(json.load(response)['version'],release_info())
        finally:server.shutdown();server.server_close()

if __name__=='__main__': unittest.main()
