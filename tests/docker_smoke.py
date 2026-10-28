"""Exercise real rootless dashboard images and a disposable named volume."""
import argparse
from http.client import HTTPException
import json
import subprocess
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
import uuid

TOKEN = 'synthetic-docker-smoke-token-not-a-real-secret'


def docker(*args):
    return subprocess.check_output(['docker', *args], text=True, timeout=60).strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', required=True)
    parser.add_argument('--next-image', required=True)
    args = parser.parse_args()
    name = 'homelab-dashboard-test-' + uuid.uuid4().hex[:12]
    volume = name + '-data'
    docker('volume', 'create', volume)
    def start(image, networks=''):
        docker('run', '-d', '--name', name, '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
               '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m', '-v', volume + ':/data',
               '-p', '127.0.0.1::8080', '-e', 'HOMELAB_DASHBOARD_TOKEN=' + TOKEN,
               '-e', 'HOMELAB_DASHBOARD_TRUSTED_NETWORKS=' + networks, image)
        port = json.loads(docker('inspect', name))[0]['NetworkSettings']['Ports']['8080/tcp'][0]['HostPort']
        base = 'http://127.0.0.1:' + port
        def get(path):
            with urlopen(Request(base + path, headers={'Authorization':'Bearer ' + TOKEN}), timeout=3) as response:
                return json.load(response)
        deadline = time.monotonic() + 30
        while True:
            try:
                info = get('/api/version')
                break
            except (URLError, HTTPError, HTTPException, ConnectionError):
                if time.monotonic() >= deadline: raise
                time.sleep(.1)
        docker('exec', name, 'python', '-m', 'homelab.server.healthcheck')
        assert docker('exec', name, 'id', '-u') == '10001'
        assert docker('exec', name, 'python', '-c', 'import shutil;assert not any(shutil.which(x) for x in ["node","npm","smartctl","homelab-agent"])') == ''
        try: urlopen(base + '/api/version', timeout=3)
        except HTTPError as error:
            assert error.code == 401
            error.close()
        else: raise AssertionError('Version API allowed unauthenticated access')
        return info, get
    def stop():
        started=time.monotonic()
        docker('stop', name)
        assert time.monotonic()-started < 8, 'Dashboard did not handle SIGTERM promptly'
        docker('rm', name)
    def saved():
        docker('exec', name, 'python', '-c', 'import sqlite3;db=sqlite3.connect("/data/dashboard.sqlite");assert db.execute("SELECT count(*) FROM history WHERE host=?",("fixture",)).fetchone()[0]==1;db.close()')
        temperatures = get('/api/temperatures/fixture?days=1')
        assert len(temperatures['series']) == 1
        assert list(temperatures['records'][0]['values'].values()) == [42]
        catalogue = get('/api/applications')
        assert len(catalogue['applications']) == 1
        app = catalogue['applications'][0]
        assert (app['name'], app['url'], app['external_access'], app['launchpad_position']) == (
            'Smoke application', 'https://app.example.test', 'unverified', 0)
    try:
        first, get = start(args.image)
        assert get('/api/hosts')['hosts'] == []
        docker('exec', name, 'python', '-c', 'from homelab.server.launchpad import Launchpad;Launchpad("/data/dashboard.sqlite").save_application({"name":"Smoke application","url":"https://app.example.test","external_url":"https://app.example.test"})')
        docker('exec', name, 'python', '-c', 'import sqlite3,time;db=sqlite3.connect("/data/dashboard.sqlite");db.execute("INSERT INTO history VALUES (?,?,?,?,?,?,?,?,?,?)",("fixture",int(time.time())//300*300,10,20,None,0,0,0,0,1));db.commit();db.close()')
        docker('exec', name, 'python', '-c', 'import time;from homelab.server.temperatures import Temperatures;Temperatures("/data/dashboard.sqlite").sample("fixture",{"timestamp":time.time(),"gpus":[{"name":"Smoke GPU","temperature":42}],"disks":[]})')
        snapshot = docker('exec', name, 'python', '-m', 'homelab.server.backup')
        docker('exec', name, 'python', '-c', 'import sqlite3,os,sys;db=sqlite3.connect(sys.argv[1]);assert db.execute("PRAGMA integrity_check").fetchone()[0]=="ok";assert db.execute("SELECT count(*) FROM history WHERE host=?",("fixture",)).fetchone()[0]==1;assert db.execute("SELECT name,launchpad_position FROM applications").fetchall()==[("Smoke application",0)];assert os.stat(sys.argv[1]).st_mode & 0o777==0o600;db.close()', snapshot)
        docker('exec', name, 'python', '-c', 'import sqlite3,sys;db=sqlite3.connect(sys.argv[1]);assert db.execute("SELECT value FROM temperature_samples WHERE host=?",("fixture",)).fetchall()==[(42.0,)];db.close()', snapshot)
        stop()
        second, get = start(args.next_image, '127.0.0.1/32')
        assert second['version'] != first['version']
        docker('exec', name, 'python', '-c', 'from urllib.request import urlopen;assert urlopen("http://127.0.0.1:8080/api/version",timeout=3).status==200')
        saved()
        stop()
        restored, get = start(args.image)
        assert restored == first
        saved()
        print('PASS: non-root/read-only image, authenticated API/health check, trusted-client access, consistent backup, image update and rollback with preserved history and application catalogue')
    finally:
        subprocess.run(['docker', 'rm', '-f', name], capture_output=True)
        subprocess.run(['docker', 'volume', 'rm', volume], capture_output=True, check=True)


if __name__ == '__main__':
    main()
