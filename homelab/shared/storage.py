from contextlib import contextmanager
import sqlite3
import json
import time
from pathlib import Path

RETENTION = 90 * 86400

DISK_IO_FIELDS = ('read_bytes','write_bytes','read_ops','write_ops','seconds')

def merge_disk_io(records):
    result = {}
    for record in records:
        for name, values in record.items():
            total = result.setdefault(name,dict.fromkeys(DISK_IO_FIELDS,0))
            for key in DISK_IO_FIELDS:
                total[key] += values[key]
    return result

class History:
    def __init__(self, path, retention_days=90):
        self.retention = retention_days*86400
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.path = str(path)
        with self.connect() as db:
            db.execute('''CREATE TABLE IF NOT EXISTS history (
                host TEXT, bucket INTEGER, cpu REAL, memory REAL, gpu REAL,
                rx REAL, tx REAL, rx_bytes REAL, tx_bytes REAL, samples INTEGER,
                PRIMARY KEY(host,bucket))''')
            db.execute('''CREATE TABLE IF NOT EXISTS disk_history (
                host TEXT, bucket INTEGER, payload TEXT NOT NULL, PRIMARY KEY(host,bucket))''')

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
            if metrics.get('disk_io'):
                old = db.execute('SELECT payload FROM disk_history WHERE host=? AND bucket=?',(host,bucket)).fetchone()
                payload = merge_disk_io([json.loads(old['payload']) if old else {}, metrics['disk_io']])
                db.execute('INSERT OR REPLACE INTO disk_history VALUES (?,?,?)',(host,bucket,json.dumps(payload)))
            self.prune(db)

    def mirror(self, host, records):
        with self.connect() as db:
            for r in records:
                db.execute('INSERT OR REPLACE INTO history VALUES (?,?,?,?,?,?,?,?,?,?)',
                           (host, *(r[k] for k in ('bucket','cpu','memory','gpu','rx','tx','rx_bytes','tx_bytes','samples'))))
                if 'disk_io' in r:
                    db.execute('INSERT OR REPLACE INTO disk_history VALUES (?,?,?)',
                               (host,r['bucket'],json.dumps(r['disk_io'])))
            self.prune(db)

    def prune(self, db):
        cutoff = time.time()-self.retention
        for table in ('history','disk_history'):
            db.execute(f'DELETE FROM {table} WHERE bucket < ?', (cutoff,))

    def read(self, host, since, limit=30000):
        with self.connect() as db:
            result = []
            for r in db.execute(
                'SELECT h.*,d.payload FROM history h LEFT JOIN disk_history d ON d.host=h.host AND d.bucket=h.bucket '
                'WHERE h.host=? AND h.bucket>=? ORDER BY h.bucket LIMIT ?',
                (host, max(since, time.time()-self.retention), limit)):
                row = dict(r)
                payload = row.pop('payload')
                if payload is not None:
                    row['disk_io'] = json.loads(payload)
                result.append(row)
            return result
