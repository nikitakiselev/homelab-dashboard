"""Dashboard-local temperature observations; never initiates hardware collection."""

import hashlib
import math
import time

from homelab.shared.storage import History


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def observations(metrics):
    """Yield identity, display label, kind, Celsius, and original measurement time."""
    duplicates = {}
    for gpu in metrics.get('gpus', []):
        name = gpu.get('name') or 'GPU'
        occurrence = duplicates.get(name, 0) + 1
        duplicates[name] = occurrence
        yield (f'gpu:{name}:{occurrence}', f'GPU {occurrence} · {name}', 'gpu',
               gpu.get('temperature'), metrics.get('timestamp'))
    for disk in metrics.get('disks', []):
        name = disk.get('name') or 'Диск'
        identity = disk.get('serial') or f'{name}:{disk.get("model", "")}'
        yield (f'disk:{identity}', f'{name} · {disk.get("model") or "Диск"}', 'disk',
               disk.get('temperature'), disk.get('smart_updated_at'))


class Temperatures:
    def __init__(self, path, retention_days=90):
        self.history = History(path, retention_days)
        with self.history.connect() as db:
            db.execute('''CREATE TABLE IF NOT EXISTS temperature_sensors (
                host TEXT, sensor TEXT, label TEXT, kind TEXT,
                PRIMARY KEY(host,sensor))''')
            db.execute('''CREATE TABLE IF NOT EXISTS temperature_samples (
                host TEXT, sensor TEXT, bucket INTEGER, measured REAL, value REAL NOT NULL,
                samples INTEGER NOT NULL, PRIMARY KEY(host,sensor,bucket))''')
            db.execute('CREATE INDEX IF NOT EXISTS temperature_time ON temperature_samples(host,measured)')
            db.execute('CREATE INDEX IF NOT EXISTS temperature_expiry ON temperature_samples(measured)')

    def sample(self, host, metrics):
        now = time.time()
        cutoff = now - self.history.retention
        with self.history.connect() as db:
            for identity, label, kind, value, measured in observations(metrics):
                if not finite(value) or not finite(measured) or not cutoff <= measured <= now + 60:
                    continue
                sensor = hashlib.sha256(identity.encode()).hexdigest()[:24]
                db.execute('INSERT OR REPLACE INTO temperature_sensors VALUES (?,?,?,?)',
                           (host, sensor, label, kind))
                db.execute('''INSERT INTO temperature_samples VALUES (?,?,?,?,?,1)
                    ON CONFLICT(host,sensor,bucket) DO UPDATE SET
                    value=(value*samples+excluded.value)/(samples+1),
                    samples=samples+1, measured=excluded.measured
                    WHERE excluded.measured > measured''',
                           (host, sensor, int(measured) // 300 * 300, measured, value))
            db.execute('DELETE FROM temperature_samples WHERE measured < ?', (cutoff,))
            db.execute('''DELETE FROM temperature_sensors WHERE NOT EXISTS (
                SELECT 1 FROM temperature_samples p
                WHERE p.host=temperature_sensors.host AND p.sensor=temperature_sensors.sensor)''')

    def delete(self, host):
        with self.history.connect() as db:
            db.execute('DELETE FROM temperature_samples WHERE host=?', (host,))
            db.execute('DELETE FROM temperature_sensors WHERE host=?', (host,))

    def read(self, host, days):
        if days not in (1, 7, 30, 90):
            raise ValueError('Период: 1, 7, 30 или 90 дней')
        step = 300 if days == 1 else 21600
        since = time.time() - min(days * 86400, self.history.retention)
        with self.history.connect() as db:
            rows = db.execute('''SELECT sensor, CAST(bucket / ? AS INTEGER) * ? AS grouped_bucket,
                SUM(value*samples)/SUM(samples) AS value FROM temperature_samples
                WHERE host=? AND measured>=? GROUP BY sensor,grouped_bucket ORDER BY grouped_bucket,sensor''',
                              (step, step, host, since)).fetchall()
            ids = {row['sensor'] for row in rows}
            series = [dict(id=r['sensor'], label=r['label'], kind=r['kind']) for r in db.execute(
                'SELECT * FROM temperature_sensors WHERE host=? ORDER BY kind,label,sensor', (host,))
                      if r['sensor'] in ids]
        records = {}
        for row in rows:
            records.setdefault(row['grouped_bucket'], {})[row['sensor']] = row['value']
        return {'series': series, 'records': [dict(bucket=k, values=v) for k, v in records.items()]}
