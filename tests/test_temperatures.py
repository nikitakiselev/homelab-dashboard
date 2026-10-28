import copy
import tempfile
import time
import unittest
import json
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from homelab.server.temperatures import Temperatures


class TemperatureTests(unittest.TestCase):
    def test_cpu_summary_is_stable_and_uses_metrics_time(self):
        metrics = {'timestamp': time.time() - 600, 'cpu': {'temperature': 0, 'temperature_source': 'coretemp · package'}}
        self.store.sample('host', metrics)
        first = self.store.read('host', 1)
        self.assertEqual(len(first['series']), 1)
        self.assertEqual(first['series'][0]['kind'], 'cpu')
        sensor = first['series'][0]['id']
        self.assertEqual(first['records'][0]['values'][sensor], 0)
        metrics['cpu']['temperature'] = 99
        self.store.sample('host', metrics)
        self.assertEqual(self.store.read('host', 1), first)
        metrics['timestamp'] += 300
        metrics['cpu'].update(temperature=42, temperature_source='coretemp · max core')
        self.store.sample('host', metrics)
        result = self.store.read('host', 1)
        self.assertEqual(result['series'], first['series'])
        self.assertEqual(result['records'][-1]['values'][sensor], 42)
        for cpu in ({}, {'temperature': None}, {'temperature': float('nan')}, {'temperature': True}):
            self.store.sample('empty', {'timestamp': time.time(), 'cpu': cpu})
        self.assertEqual(self.store.read('empty', 1)['series'], [])

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'dashboard.sqlite'
        self.store = Temperatures(self.path, 90)
        self.now = int(time.time()) // 21600 * 21600
        self.metrics = {
            'timestamp': self.now + 31,
            'gpus': [{'name': 'GPU', 'temperature': 0},
                     {'name': 'GPU', 'temperature': -2}],
            'disks': [{'name': 'sda', 'model': 'Disk', 'serial': 'DISK-A',
                       'temperature': 32, 'smart_updated_at': self.now - 600}],
        }

    def test_records_every_device_and_deduplicates_saved_measurements(self):
        self.store.sample('host', self.metrics)
        updated = copy.deepcopy(self.metrics)
        updated['timestamp'] += 300
        updated['gpus'][0]['temperature'] = 20
        self.store.sample('host', updated)
        result = self.store.read('host', 1)
        self.assertEqual(len(result['series']), 3)
        gpu_ids = [s['id'] for s in result['series'] if s['kind'] == 'gpu']
        self.assertEqual(len(set(gpu_ids)), 2)
        disk_id = next(s['id'] for s in result['series'] if s['kind'] == 'disk')
        self.assertEqual([(r['bucket'], r['values'][disk_id]) for r in result['records']
                          if disk_id in r['values']], [(self.now - 600, 32)])
        self.assertEqual([r['values'][gpu_ids[0]] for r in result['records']
                          if gpu_ids[0] in r['values']], [0, 20])
        # A replay cannot change the mean or create another point.
        self.store.sample('host', self.metrics)
        self.assertEqual(self.store.read('host', 1), result)

    def test_identity_survives_disk_rename_but_not_replacement(self):
        self.store.sample('host', self.metrics)
        self.metrics['disks'][0].update(name='sdb', smart_updated_at=self.now + 1)
        self.store.sample('host', self.metrics)
        self.assertEqual(len(self.store.read('host', 1)['series']), 3)
        self.metrics['disks'][0].update(serial='DISK-B', smart_updated_at=self.now + 2)
        self.store.sample('host', self.metrics)
        self.assertEqual(len(self.store.read('host', 1)['series']), 4)

    def test_rejects_unknown_future_nonfinite_and_missing_measurements(self):
        self.metrics['gpus'] = [{'name': 'bad', 'temperature': float('nan')},
                                {'name': 'missing', 'temperature': None}]
        self.metrics['disks'][0].pop('smart_updated_at')
        self.store.sample('host', self.metrics)
        self.assertEqual(self.store.read('host', 1), {'series': [], 'records': []})
        self.metrics['gpus'] = [{'name': 'GPU', 'temperature': 12}]
        self.metrics['timestamp'] = time.time() + 3600
        self.store.sample('host', self.metrics)
        self.assertEqual(self.store.read('host', 1)['records'], [])

    def test_weighted_aggregation_restart_and_host_isolation(self):
        self.metrics['disks'] = []
        self.metrics['gpus'] = [{'name': 'GPU', 'temperature': 10}]
        for offset, value in [(1, 10), (11, 20), (301, 60)]:
            self.metrics['timestamp'] = self.now + offset
            self.metrics['gpus'][0]['temperature'] = value
            self.store.sample('host', self.metrics)
        result = Temperatures(self.path, 90).read('host', 7)
        sensor = result['series'][0]['id']
        self.assertEqual(result['records'], [{'bucket': self.now, 'values': {sensor: 30}}])
        self.assertEqual(len(self.store.read('host', 1)['records']), 2)
        self.assertEqual(self.store.read('other', 1)['records'], [])
        for days in (1, 7, 30, 90):
            self.assertTrue(self.store.read('host', days)['records'])
        with self.assertRaises(ValueError):
            self.store.read('host', 2)

    def test_persists_bounded_five_minute_aggregates_not_every_dashboard_poll(self):
        self.metrics['disks'] = []
        self.metrics['gpus'] = [{'name': 'GPU', 'temperature': 20}]
        for offset in range(1, 291, 10):
            self.metrics['timestamp'] = self.now + offset
            self.store.sample('host', self.metrics)
        with self.store.history.connect() as db:
            count = db.execute('SELECT COUNT(*) FROM temperature_samples').fetchone()[0]
        self.assertEqual(count, 1)

    def test_retention_and_deletion_include_device_metadata(self):
        self.metrics['timestamp'] = time.time() - 2 * 86400
        self.metrics['disks'] = []
        Temperatures(self.path, 1).sample('host', self.metrics)
        self.assertEqual(self.store.read('host', 90)['records'], [])
        self.metrics['timestamp'] = time.time()
        self.store.sample('host', self.metrics)
        self.store.delete('host')
        self.assertEqual(self.store.read('host', 1), {'series': [], 'records': []})


class TemperatureHTTPTests(unittest.TestCase):
    def test_demo_temperature_history_is_synthetic_and_not_persisted(self):
        from homelab.server.app import Dashboard
        with tempfile.TemporaryDirectory() as directory:
            dashboard = Dashboard(Path(directory) / 'dashboard.sqlite', demo=True)
            result = dashboard.temperature_chart('demo-1', 1)
            self.assertEqual(len(result['series']), 4)
            self.assertGreater(len(result['records']), 100)
            self.assertEqual(dashboard.temperatures.read('demo-1', 1)['records'], [])
            disabled = Dashboard(Path(directory) / 'other.sqlite')
            self.assertEqual(disabled.temperature_chart('demo-1', 1)['records'], [])

    def test_authenticated_period_api_returns_original_observations(self):
        from homelab.server.app import Dashboard, handler
        with tempfile.TemporaryDirectory() as directory:
            dashboard = Dashboard(Path(directory) / 'dashboard.sqlite')
            dashboard.temperatures.sample('host', {'timestamp': time.time(),
                'gpus': [{'name': 'Test GPU', 'temperature': 42}], 'disks': []})
            server = ThreadingHTTPServer(('127.0.0.1', 0), handler(dashboard, 'test-token', Path(directory)))
            threading.Thread(target=server.serve_forever, daemon=True).start()
            self.addCleanup(server.server_close)
            self.addCleanup(server.shutdown)
            base = f'http://127.0.0.1:{server.server_port}/api/temperatures/host'
            with self.assertRaises(HTTPError) as error:
                urlopen(base)
            self.assertEqual(error.exception.code, 401)
            error.exception.close()
            for days in (1, 7, 30, 90):
                with urlopen(Request(f'{base}?days={days}', headers={'Authorization': 'Bearer test-token'})) as response:
                    result = json.load(response)
                self.assertEqual(len(result['series']), 1)
                self.assertEqual(list(result['records'][0]['values'].values()), [42])
            for days in ('2', 'oops'):
                with self.assertRaises(HTTPError) as error:
                    urlopen(Request(f'{base}?days={days}', headers={'Authorization': 'Bearer test-token'}))
                self.assertEqual(error.exception.code, 400)
                error.exception.close()
