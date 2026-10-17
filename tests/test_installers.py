from pathlib import Path
from types import SimpleNamespace
import subprocess
import sys
import tempfile
import unittest
from deploy.install_server import activate_release, environment
from homelab import __version__


class InstallerTests(unittest.TestCase):
    def test_existing_token_and_port_survive_update(self):
        token='existing-token-that-must-be-kept'
        contents,actual,port=environment('HOMELAB_DASHBOARD_TOKEN='+token+'\nHOMELAB_DASHBOARD_PORT=8123\n')
        self.assertEqual(actual,token)
        self.assertEqual(port,8123)
        self.assertIn(token,contents)

    def test_failed_health_check_restores_previous_release_and_unit(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);old=root/'old';new=root/'new';old.mkdir();new.mkdir()
            current=root/'current';current.symlink_to(old)
            unit=root/'dashboard.service';unit.write_text('old unit')
            calls=[]
            def run(*args,**kwargs):calls.append(args);return SimpleNamespace(returncode=0)
            def health(*args):raise RuntimeError('health failed')
            with self.assertRaisesRegex(RuntimeError,'health failed'):
                activate_release(current,new,unit,'new unit','test-token',8080,runner=run,health_check=health)
            self.assertEqual(current.resolve(),old.resolve())
            self.assertEqual(unit.read_text(),'old unit')
            self.assertEqual(calls[-1],('systemctl','restart','homelab-dashboard'))

    def test_success_activates_new_release(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);new=root/'new';new.mkdir();unit=root/'dashboard.service'
            activate_release(root/'current',new,unit,'unit','test-token',8080,runner=lambda *args,**kwargs:SimpleNamespace(returncode=1 if 'is-active' in args else 0),health_check=lambda *args:None)
            self.assertEqual((root/'current').resolve(),new.resolve())
            self.assertEqual(unit.read_text(),'unit')
