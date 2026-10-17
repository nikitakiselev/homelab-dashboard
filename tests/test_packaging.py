import io
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from homelab.server.bundle import agent_archive

class PackageTests(unittest.TestCase):
    def test_archive_contains_go_agent_bootstrap_without_python_or_frontend(self):
        with tempfile.TemporaryDirectory() as temp:
            with tarfile.open(fileobj=io.BytesIO(agent_archive()),mode='r:gz') as bundle:
                bundle.extractall(temp,filter='data')
            extracted=Path(temp)/'homelab-agent'
            self.assertFalse((extracted/'homelab').exists())
            self.assertFalse((extracted/'frontend').exists())
            result=subprocess.run(['sh','-n',str(extracted/'deploy/install_agent.sh')],capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
