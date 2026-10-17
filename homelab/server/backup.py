"""Create a consistent SQLite snapshot in the mounted data volume."""
from contextlib import closing
from datetime import datetime, timezone
import os
from pathlib import Path
import sqlite3
import tempfile


def snapshot(source=Path('/data/dashboard.sqlite'), destination=Path('/data/backups')):
    destination.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, name = tempfile.mkstemp(prefix=datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S-'), suffix='.sqlite', dir=destination)
    os.close(fd)
    try:
        with closing(sqlite3.connect(source.resolve().as_uri() + '?mode=ro', uri=True)) as database, closing(sqlite3.connect(name)) as backup:
            database.backup(backup)
            if backup.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise RuntimeError('Backup failed integrity check')
    except Exception:
        Path(name).unlink(missing_ok=True)
        raise
    return Path(name)


if __name__ == '__main__':
    print(snapshot())
