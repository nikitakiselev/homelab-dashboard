from pathlib import Path
import tempfile
import unittest
from homelab.shared.config import load_config
from homelab.shared.storage import History
from homelab.agent.linux import Collector
from homelab.server.app import validate_metrics, demo_metrics


class ConfigTests(unittest.TestCase):
    def read(self,value):
        with tempfile.TemporaryDirectory() as temp:
            file=Path(temp)/'agent.yaml';file.write_text(value)
            return load_config(file)

    def test_values_reach_collector(self):
        config=self.read('collection:\n  interval_seconds: 20\n  disks:\n    enabled: false\n  gpu:\n    interval_seconds: 10\nnetwork:\n  interfaces: [eth9]\nhistory:\n  retention_days: 30\n')
        with tempfile.TemporaryDirectory() as temp:
            collector=Collector(History(Path(temp)/'agent.sqlite'))
            collector.configure(config)
            self.assertEqual(collector.interval_seconds,20)
            self.assertFalse(collector.disks_enabled)
            self.assertEqual(collector.gpu_interval_seconds,10)
            self.assertEqual(collector.interfaces,('eth9',))
        self.assertEqual(config.retention_days,30)

    def test_rejects_unknown_duplicate_and_unsafe_values(self):
        invalid=['collection:\n  interval_second: 4','server:\n  port: 0','history:\n  retention_days: false','collection:\n  interval_seconds: .nan','server:\n  port: 9108\n  port: 9109','collection:\n  gpu:\n    enabled: "false"','network:\n  interfaces: eth0','!!python/object/apply:os.system [echo should-never-run]','token: abc']
        for source in invalid:
            with self.subTest(source=source),self.assertRaises(ValueError):self.read(source)

    def test_defaults_without_config(self):
        self.assertEqual(load_config().interval_seconds,5)
        self.assertEqual(load_config().port,9108)

    def test_relative_database_path_is_relative_to_config(self):
        config=self.read('history:\n  path: metrics/agent.sqlite')
        self.assertTrue(Path(config.path).is_absolute())
        self.assertTrue(config.path.endswith('/metrics/agent.sqlite'))

    def test_slow_collection_is_not_rejected_as_stale(self):
        import time
        metrics=demo_metrics(0)
        metrics['collection_interval']=120
        metrics['timestamp']=time.time()-80
        self.assertIs(validate_metrics(metrics),metrics)

    def test_short_retention_prunes_agent_history(self):
        import time
        with tempfile.TemporaryDirectory() as temp:
            history=History(Path(temp)/'history.sqlite',retention_days=1)
            metrics=demo_metrics(0);metrics['timestamp']=time.time()-2*86400
            history.sample('host',metrics)
            self.assertEqual(history.read('host',0),[])
