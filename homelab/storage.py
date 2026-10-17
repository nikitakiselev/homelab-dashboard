from contextlib import contextmanager
import sqlite3
import time
from pathlib import Path

RETENTION = 90 * 86400

class History:
    def __init__(self, path):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.path = str(path)
        with self.connect() as db:
            db.execute('''CREATE TABLE IF NOT EXISTS history (
                host TEXT, bucket INTEGER, cpu REAL, memory REAL, gpu REAL,
                rx REAL, tx REAL, rx_bytes REAL, tx_bytes REAL, samples INTEGER,
                PRIMARY KEY(host,bucket))''')

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def sample(self, host, metrics, rx_bytes=0, tx_bytes=0):
        bucket = int(metrics['timestamp']) // 300 * 300
        gpu = metrics['gpus'][0]['usage'] if metrics['gpus'] else None
        values = (host, bucket, metrics['cpu']['usage'], metrics['memory']['percent'], gpu,
                  metrics['network']['rx'], metrics['network']['tx'], rx_bytes, tx_bytes, 1)
        with self.connect() as db:
            db.execute('''INSERT INTO history VALUES (?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(host,bucket) DO UPDATE SET
                cpu=(cpu*samples+excluded.cpu)/(samples+1),
                memory=(memory*samples+excluded.memory)/(samples+1),
                gpu=COALESCE(excluded.gpu,gpu),
                rx=(rx*samples+excluded.rx)/(samples+1),
                tx=(tx*samples+excluded.tx)/(samples+1),
                rx_bytes=rx_bytes+excluded.rx_bytes, tx_bytes=tx_bytes+excluded.tx_bytes,
                samples=samples+1''', values)
            db.execute('DELETE FROM history WHERE bucket < ?', (time.time()-RETENTION,))

    def mirror(self, host, records):
        with self.connect() as db:
            for r in records:
                db.execute('INSERT OR REPLACE INTO history VALUES (?,?,?,?,?,?,?,?,?,?)',
                           (host, *(r[k] for k in ('bucket','cpu','memory','gpu','rx','tx','rx_bytes','tx_bytes','samples'))))
            db.execute('DELETE FROM history WHERE bucket < ?', (time.time()-RETENTION,))

    def read(self, host, since, limit=30000):
        with self.connect() as db:
            return [dict(r) for r in db.execute(
                'SELECT * FROM history WHERE host=? AND bucket>=? ORDER BY bucket LIMIT ?',
                (host, max(since, time.time()-RETENTION), limit))]
