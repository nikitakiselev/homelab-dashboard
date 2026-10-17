import io
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
from deploy.install_agent import install_sources
from homelab.server.bundle import agent_archive, ROOT


class PackageTests(unittest.TestCase):
    def test_agent_archive_runs_without_server_and_frontend(self):
        with tempfile.TemporaryDirectory() as temp:
            with tarfile.open(fileobj=io.BytesIO(agent_archive()),mode='r:gz') as bundle:
                bundle.extractall(temp,filter='data')
            extracted=Path(temp)/'homelab-agent'
            self.assertFalse((extracted/'homelab/server').exists())
            self.assertFalse((extracted/'frontend').exists())
            result=subprocess.run([sys.executable,'-m','homelab.agent','--help'],cwd=extracted,env={**os.environ,'PYTHONPATH':str(extracted)},capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertIn('--port',result.stdout)
            result=subprocess.run([sys.executable,'-c','import homelab.agent; import sys; assert "homelab.server" not in sys.modules'],cwd=extracted,env={**os.environ,'PYTHONPATH':str(extracted)},capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)

    def test_install_sources_upgrades_flat_agent_without_server(self):
        with tempfile.TemporaryDirectory() as temp:
            target=Path(temp)
            (target/'homelab').mkdir()
            (target/'homelab/agent.py').write_text('legacy agent')
            (target/'homelab/storage.py').write_text('legacy storage')
            install_sources(ROOT,target)
            self.assertTrue((target/'homelab/agent/api.py').is_file())
            self.assertTrue((target/'homelab/shared/storage.py').is_file())
            self.assertFalse((target/'homelab/agent.py').exists())
            self.assertFalse((target/'homelab/storage.py').exists())
            self.assertFalse((target/'homelab/server').exists())
