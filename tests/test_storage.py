from pathlib import Path
import tempfile
import unittest
from homelab.shared.storage import History
from homelab.server.app import validate_metrics, demo_metrics


class StoragePolicyTests(unittest.TestCase):
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
