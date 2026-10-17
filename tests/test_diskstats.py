import tempfile
import time
import unittest
from pathlib import Path

from homelab.server.app import Dashboard, demo_metrics
from homelab.shared.storage import History


class DiskStatsTests(unittest.TestCase):
    def test_persistence_sync_periods_and_missing_values(self):
        with tempfile.TemporaryDirectory() as temp:
            agent = History(Path(temp)/'agent.sqlite')
            metrics = demo_metrics(0)
            bucket = int(time.time())//300*300
            metrics['timestamp'] = bucket+1
            metrics['disk_io'] = {'sda':dict(read_bytes=5120,write_bytes=10240,read_ops=2,write_ops=3,seconds=5)}
            agent.sample('test',metrics)
            agent.sample('test',metrics)
            dashboard = Dashboard(Path(temp)/'server.sqlite')
            rows = History(agent.path).read('test',0)
            self.assertEqual(rows[0]['disk_io']['sda']['read_bytes'],10240)
            for _ in range(2):
                dashboard.history.mirror('test', rows)
            for days in (1,7,30,90):
                result = dashboard.chart('test',days)[0]['disk_io']['sda']
                self.assertEqual(result,dict(read_bytes=10240,write_bytes=20480,read_ops=4,write_ops=6,seconds=10))
            # Old agents don't supply disk history, which must remain unavailable.
            metrics.pop('disk_io')
            agent.sample('legacy',metrics)
            self.assertNotIn('disk_io',agent.read('legacy',0)[0])
            # Retention applies to disk history too.
            metrics['timestamp'] -= 91*86400
            metrics['disk_io'] = rows[0]['disk_io']
            agent.sample('expired',metrics)
            with agent.connect() as db:
                self.assertEqual(db.execute('SELECT count(*) FROM disk_history WHERE host=?',('expired',)).fetchone()[0],0)

    def test_disk_aggregation_uses_elapsed_time(self):
        with tempfile.TemporaryDirectory() as temp:
            dashboard=Dashboard(Path(temp)/'server.sqlite')
            bucket=int(time.time()-86400)//21600*21600
            rows=[]
            for offset,seconds,read in ((0,5,100),(300,15,900)):
                rows.append(dict(bucket=bucket+offset,cpu=10,memory=20,gpu=None,rx=0,tx=0,rx_bytes=0,tx_bytes=0,samples=1,
                                 disk_io={'sda':dict(read_bytes=read,write_bytes=0,read_ops=1,write_ops=0,seconds=seconds)}))
            dashboard.history.mirror('test',rows)
            io=dashboard.chart('test',7)[0]['disk_io']['sda']
            self.assertEqual(io['read_bytes']/io['seconds'],50)
            self.assertEqual(io['read_ops'],2)
