import tempfile
import threading
import unittest
import os
import subprocess
import sys
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import ProxyHandler, Request, build_opener

from homelab.server.app import Dashboard, handler, trusted_client, trusted_networks

TOKEN = 'synthetic-dashboard-token-for-tests'


class DashboardAuthTests(unittest.TestCase):
    def test_invalid_environment_stops_before_database_creation(self):
        with tempfile.TemporaryDirectory() as tmp:
            database = Path(tmp) / 'dashboard.sqlite'
            result = subprocess.run(
                [sys.executable, '-m', 'homelab.server', '--data', str(database)],
                env={**os.environ, 'HOMELAB_DASHBOARD_TRUSTED_NETWORKS': 'invalid-network'},
                capture_output=True, text=True, timeout=5,
            )
            self.assertEqual(result.returncode, 2)
            self.assertIn('Invalid HOMELAB_DASHBOARD_TRUSTED_NETWORKS', result.stderr)
            self.assertFalse(database.exists())

    def test_network_configuration(self):
        self.assertEqual(trusted_networks('  '), ())
        networks = trusted_networks('192.168.50.0/24, fd12:3456:789a::/64, 10.20.30.40')
        for peer in ('192.168.50.12', '::ffff:192.168.50.12', 'fd12:3456:789a::2', '10.20.30.40'):
            self.assertTrue(trusted_client(peer, networks), peer)
        for peer in ('192.168.51.12', '10.20.30.41', '127.0.0.1', 'invalid', '2001:db8::1'):
            self.assertFalse(trusted_client(peer, networks), peer)
        for value in ('192.168.50.12/24', 'bad', 'localhost', '192.168.50.0/33', '10.0.0.0/8,'):
            with self.assertRaises(ValueError, msg=value):
                trusted_networks(value)

    def check_access(self, networks):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        dashboard = Dashboard(Path(tmp.name) / 'test.sqlite')
        self.addCleanup(dashboard.close)
        server = ThreadingHTTPServer(('127.0.0.1', 0), handler(dashboard, TOKEN, Path(tmp.name), trusted_networks(networks)))
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base = f'http://127.0.0.1:{server.server_port}'
        opener = build_opener(ProxyHandler({}))

        def request(path, method='GET', headers=None, body=None):
            req = Request(base + path, method=method, headers=headers or {}, data=body)
            try:
                with opener.open(req, timeout=5) as response:
                    return response.status
            except HTTPError as error:
                error.close()
                return error.code
        return request

    def test_trusted_home_network_needs_no_token(self):
        request = self.check_access('127.0.0.0/8')
        self.assertEqual(request('/api/hosts'), 200)
        self.assertEqual(request('/api/version'), 200)
        self.assertEqual(request('/api/hosts/nonexistent', 'DELETE'), 200)
        self.assertEqual(request('/api/hosts', 'POST', body=b'{}'), 400)
        self.assertEqual(request('/api/hosts/nonexistent', 'DELETE', {'Origin': 'https://attacker.example'}), 403)
        self.assertEqual(request('/api/hosts', headers={'Authorization': 'Bearer stale-token'}), 200)

    def test_other_networks_and_forged_headers_still_require_token(self):
        request = self.check_access('192.168.50.0/24')
        forged = {'X-Forwarded-For': '192.168.50.12', 'X-Real-IP': '192.168.50.12',
                  'Forwarded': 'for=192.168.50.12', 'Host': '192.168.50.12:8080'}
        self.assertEqual(request('/api/hosts', headers=forged), 401)
        self.assertEqual(request('/api/hosts/nonexistent', 'DELETE', forged), 401)
        self.assertEqual(request('/api/hosts', 'POST', forged, b'{}'), 401)
        self.assertEqual(request('/api/hosts', headers={'Authorization': 'Bearer ' + TOKEN}), 200)

    def test_default_still_requires_token_on_localhost(self):
        request = self.check_access('')
        self.assertEqual(request('/api/hosts'), 401)
        self.assertEqual(request('/api/hosts', headers={'Authorization': 'Bearer ' + TOKEN}), 200)


if __name__ == '__main__':
    unittest.main()
