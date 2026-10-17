from contextlib import closing
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

from homelab.server.backup import snapshot
from homelab.server.version import release_info


class ContainerSupportTests(unittest.TestCase):
    def test_online_backup_preserves_committed_data_and_private_permissions(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / 'live.sqlite'
            with closing(sqlite3.connect(source)) as db, db:
                db.execute('CREATE TABLE measurements(value INTEGER)')
                db.execute('INSERT INTO measurements VALUES (42)')
            with closing(sqlite3.connect(source)) as writer:
                backup = snapshot(source, root / 'backups')
                writer.execute('INSERT INTO measurements VALUES (43)')
                writer.commit()
            with closing(sqlite3.connect(backup)) as db:
                self.assertEqual(db.execute('SELECT * FROM measurements').fetchall(), [(42,)])
            self.assertEqual(backup.stat().st_mode & 0o777, 0o600)
            self.assertEqual((root / 'backups').stat().st_mode & 0o777, 0o700)

    def test_failed_backup_does_not_leave_an_empty_snapshot(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with self.assertRaises(sqlite3.OperationalError): snapshot(root / 'missing.sqlite', root / 'backups')
            self.assertEqual(list((root / 'backups').iterdir()), [])

    def test_build_identity_and_unknown_schema(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            self.assertEqual(release_info(root)['version'],'development')
            valid={'version':'0.1.0','commit':'a'*40,'data_schema':1}
            (root/'RELEASE.json').write_text(json.dumps(valid))
            self.assertEqual(release_info(root),valid)
            for field,value in [('data_schema',2),('commit','unknown'),('version','../invalid')]:
                (root/'RELEASE.json').write_text(json.dumps({**valid,field:value}))
                with self.assertRaisesRegex(ValueError,'identity'):release_info(root)
