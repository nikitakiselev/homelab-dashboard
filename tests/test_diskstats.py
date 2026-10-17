import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from homelab.server.collectors.linux import Collector

from homelab.server.collectors.diskstats import parse_diskstats, disk_deltas
from homelab.server.app import Dashboard, demo_metrics
from homelab.shared.storage import History


class DiskStatsTests(unittest.TestCase):
    def parse(self, raw):
        return parse_diskstats(raw, lambda name: name == 'sda')

    def test_parser_sector_units_and_reset(self):
        old = self.parse('8 0 sda 10 0 100 0 20 0 200 0 0 0 0\n8 1 sda1 10 0 100 0 20 0 200 0 0 0 0\ninvalid')
        current = self.parse('8 0 sda 12 0 110 0 23 0 220 0 0 0 0 0 0 0 0 0 0')
        self.assertEqual(list(old), ['sda'])
        self.assertEqual(disk_deltas(old, {}, 5), {})
        self.assertEqual(disk_deltas(current, old, 5)['sda'],
                         dict(read_bytes=5120, write_bytes=10240, read_ops=2, write_ops=3, seconds=5))
        self.assertEqual(disk_deltas(old, current, 5), {})
        self.assertEqual(disk_deltas(current, old, 0), {})
        self.assertEqual(disk_deltas(current, current, 5)['sda']['read_bytes'], 0)
        self.assertEqual(disk_deltas(current, self.parse(''), 5), {})
        changed = self.parse('8 16 sda 12 0 110 0 23 0 220 0 0 0 0')
        self.assertEqual(disk_deltas(changed, old, 5), {})
        self.assertEqual(self.parse('8 0 sda 12 0 invalid 0 23 0 220 0 0 0 0'), {})

    def test_builtin_collector_samples_without_hardware_commands(self):
        with tempfile.TemporaryDirectory() as temp:
            lines = ['8 0 sda 10 0 100 0 20 0 200 0 0 0 0']
            def fixture(path, default=''):
                return {'/proc/stat':'cpu 10 0 0 90 0 0 0 0',
                        '/proc/meminfo':'MemTotal: 100 kB\nMemAvailable: 50 kB',
                        '/proc/net/dev':'header\nheader', '/proc/uptime':'100 100',
                        '/proc/diskstats':lines[0]}.get(str(path),default)
            collector = Collector(History(Path(temp)/'test.sqlite'))
            with patch('homelab.server.collectors.linux.read',side_effect=fixture), \
                 patch('homelab.server.collectors.linux.Path.exists',return_value=True), \
                 patch('homelab.server.collectors.linux.time.monotonic',side_effect=[10,15,20,25,30,35]), \
                 patch('homelab.server.collectors.linux.command') as command:
                collector.collect()
                self.assertEqual(collector.latest['disk_io'],{})
                lines[0] = '8 0 sda 12 0 110 0 23 0 220 0 0 0 0'
                collector.collect()
                self.assertEqual(collector.latest['disk_io']['sda']['read_bytes'],5120)
                lines[0] = ''
                collector.collect()
                self.assertEqual(collector.latest['disk_io'],{})
                self.assertIn('disk_io',collector.latest['diagnostics'])
                lines[0] = '8 0 sda 12 0 110 0 23 0 220 0 0 0 0'
                collector.collect()
                self.assertEqual(collector.latest['disk_io'],{})
                collector.collect()
                self.assertEqual(collector.latest['disk_io']['sda']['read_bytes'],0)
                collector.disks_enabled = False
                collector.collect()
                self.assertEqual(collector.latest['disk_io'],{})
                command.assert_not_called()

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
