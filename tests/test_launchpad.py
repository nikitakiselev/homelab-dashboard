import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import ProxyHandler, Request, build_opener

from homelab.server.app import Dashboard, handler, trusted_networks
from homelab.server.backup import snapshot


class LaunchpadTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'dashboard.sqlite'
        self.dashboard = Dashboard(self.path)
        self.addCleanup(self.dashboard.close)

    @property
    def store(self):
        self.assertTrue(hasattr(self.dashboard, 'launchpad'), 'Catalogue storage is missing')
        return self.dashboard.launchpad

    def application(self, **values):
        return self.store.save_application({'name': 'Media', 'url': 'https://media.example', **values})

    def test_empty_catalogue_and_persistence_of_independent_instances(self):
        self.assertEqual(self.store.catalogue(), {'groups': [], 'applications': []})
        group = self.store.save_group({'name': 'Медиа'})
        first = self.application(group_id=group['id'], icon='plex')
        second = self.application(url='http://192.168.50.12:32400/web')
        reopened = Dashboard(self.path)
        self.addCleanup(reopened.close)
        data = reopened.launchpad.catalogue()
        self.assertEqual(data['groups'][0]['name'], 'Медиа')
        self.assertEqual([a['id'] for a in data['applications']], [first['id'], second['id']])
        self.assertEqual(data['applications'][0]['icon'], 'plex')
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)

    def test_url_validation_rejects_unsafe_and_malformed_addresses(self):
        for url in ['javascript:alert(1)', 'data:text/html,test', '//media.example',
                    'https://user:password@media.example', 'http://', 'https://x:99999',
                    'https://x:0', 'https://x:bad', 'http://[broken', 'https://x/\npath',
                    'https://x\\@evil.example', 'https://x/?api_key=private',
                    'https://x/?accessToken=private', 'https://x/?authToken=private',
                    'https://x/?APIToken=private', 'https://x/?clientSecret=private',
                    'https://x/#/login?accessToken=private',
                    'https://x/#access_token=private']:
            with self.subTest(url=url), self.assertRaises(ValueError):
                self.application(url=url)
        good = self.application(url='http://[fd12:3456::1]:8080/#/library')
        self.assertEqual(good['url'], 'http://[fd12:3456::1]:8080/#/library')
        self.assertEqual(self.store.catalogue()['applications'], [good])

    def test_invalid_fields_do_not_create_rows(self):
        for fields in [{'name': ''}, {'name': 'x' * 121}, {'name': False},
                       {'icon': '../../private'}, {'group_id': 'missing'}, {'group_id': False}, {'group_id': []},
                       {'external_access': 'healthy'}, {'local_url': 'file:///private'},
                       {'external_access': 'confirmed'}]:
            with self.subTest(fields=fields), self.assertRaises(ValueError):
                self.application(**fields)
        self.assertEqual(self.store.catalogue()['applications'], [])

    def test_external_confirmation_is_explicit_and_revoked_on_address_change(self):
        app = self.application(external_url='https://media.example')
        self.assertEqual(app['external_access'], 'unverified')
        app = self.store.save_application({**app, 'external_access': 'confirmed'}, app['id'])
        self.assertEqual(app['external_access'], 'confirmed')
        app = self.store.save_application({**app, 'name': 'Renamed'}, app['id'])
        self.assertEqual(app['external_access'], 'confirmed')
        app = self.store.save_application({**app, 'external_url': 'https://new.example'}, app['id'])
        self.assertEqual(app['external_access'], 'unverified')
        app = self.store.save_application({**app, 'external_url': '', 'external_access': 'unknown'}, app['id'])
        self.assertEqual(app['external_access'], 'unknown')

    def test_reorder_requires_a_complete_permutation_and_is_atomic(self):
        a = self.application(name='A')
        b = self.application(name='B')
        for ids in [[a['id']], [a['id'], a['id']], [a['id'], 'missing'], 'bad']:
            with self.subTest(ids=ids), self.assertRaises(ValueError):
                self.store.reorder('applications', ids)
            self.assertEqual([x['id'] for x in self.store.catalogue()['applications']], [a['id'], b['id']])
        self.store.reorder('applications', [b['id'], a['id']])
        self.assertEqual([x['name'] for x in self.store.catalogue()['applications']], ['B', 'A'])

    def test_group_rename_order_move_and_delete_preserve_applications(self):
        one = self.store.save_group({'name': 'One'})
        two = self.store.save_group({'name': 'Two'})
        ungrouped = self.application(name='Ungrouped')
        a = self.application(name='A', group_id=one['id'])
        b = self.application(name='B', group_id=two['id'])
        self.store.reorder('groups', [two['id'], one['id']])
        self.store.save_group({'name': 'Renamed'}, one['id'])
        self.assertEqual([g['name'] for g in self.store.catalogue()['groups']], ['Two', 'Renamed'])
        moved = self.store.save_application({**a, 'group_id': two['id']}, a['id'])
        self.assertGreater(moved['position'], b['position'])
        self.store.delete_group(two['id'])
        apps = self.store.catalogue()['applications']
        self.assertEqual(len(apps), 3)
        self.assertTrue(all(x['group_id'] is None for x in apps))
        self.assertEqual(apps[0]['id'], ungrouped['id'])
        self.assertEqual(len({x['position'] for x in apps}), 3)
        self.store.delete_application(a['id'])
        self.assertEqual(len(self.store.catalogue()['applications']), 2)

    def test_import_is_atomic_idempotent_and_preserves_manual_edits(self):
        records = [{'id': 'import-one', 'name': 'Plex', 'group': 'Медиа',
                    'url': 'https://plex.example', 'icon': 'plex.png',
                    'external_urls': ['https://plex.example'], 'external_access': 'confirmed'},
                   {'id': 'import-two', 'name': 'Optional', 'url': 'https://other.example',
                    'include_by_default': False}]
        invalid = {'id': 'bad', 'name': 'Bad', 'url': 'javascript:alert(1)', 'group': 'Bad'}
        with self.assertRaises(ValueError):
            self.store.import_applications([records[0], invalid])
        self.assertEqual(self.store.catalogue(), {'groups': [], 'applications': []})
        self.assertEqual(self.store.import_applications(records), {'added': 1, 'skipped': 0})
        app = self.store.catalogue()['applications'][0]
        self.assertEqual(app['icon'], 'plex')
        self.assertEqual(app['external_access'], 'unverified')
        self.store.save_application({**app, 'name': 'My media', 'url': 'https://changed.example'}, app['id'])
        self.assertEqual(self.store.import_applications(records), {'added': 0, 'skipped': 1})
        self.assertEqual(self.store.catalogue()['applications'][0]['name'], 'My media')
        self.assertEqual(len(self.store.catalogue()['groups']), 1)

    def test_import_rejects_camel_case_authorization_parameters(self):
        with self.assertRaises(ValueError):
            self.store.import_applications([
                {'id': 'safe', 'name': 'Safe', 'url': 'https://safe.example', 'group': 'Test'},
                {'id': 'secret', 'name': 'Secret', 'url': 'https://other.example/#/login?accessToken=synthetic-secret'},
            ])
        self.assertEqual(self.store.catalogue(), {'groups': [], 'applications': []})

    def test_backup_restores_catalogue_without_removing_existing_tables(self):
        with sqlite3.connect(self.path) as db:
            db.execute("INSERT INTO hosts(id,name,ip) VALUES ('saved','Server','192.168.50.12')")
        app = self.application()
        backup = snapshot(self.path, Path(self.temp.name) / 'backups')
        self.store.delete_application(app['id'])
        restored = Dashboard(backup)
        self.addCleanup(restored.close)
        self.assertEqual(restored.launchpad.catalogue()['applications'][0]['id'], app['id'])
        self.assertEqual(restored.hosts()[0]['id'], 'saved')

    def test_import_cli_uses_private_file_and_is_repeatable(self):
        self.store
        source = Path(self.temp.name) / 'catalog.json'
        source.write_text(json.dumps({'applications': [{'id': 'cli-1', 'name': 'Example', 'url': 'https://example.test'}]}))
        command = [sys.executable, '-m', 'homelab.server.launchpad_import', '--data', str(self.path), '--catalog', str(source)]
        first = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertEqual(json.loads(first.stdout), {'added': 1, 'skipped': 0})
        second = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(json.loads(second.stdout), {'added': 0, 'skipped': 1})


class LaunchpadHTTPTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        dashboard = Dashboard(Path(temp.name) / 'dashboard.sqlite')
        self.addCleanup(dashboard.close)
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), handler(dashboard, 'test-token', Path(temp.name)))
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.opener = build_opener(ProxyHandler({}))

    def request(self, path='/api/applications', method='GET', body=None, token=True, headers=None):
        headers = {'Content-Type': 'application/json', **(headers or {})}
        if token:
            headers['Authorization'] = 'Bearer test-token'
        data = json.dumps(body).encode() if body is not None else None
        req = Request(f'http://127.0.0.1:{self.server.server_port}' + path, method=method, data=data, headers=headers)
        try:
            response = self.opener.open(req, timeout=5)
        except HTTPError as error:
            response = error
        with response:
            raw = response.read()
            try: value = json.loads(raw)
            except ValueError: value = None
            return response.status, value

    def test_catalogue_crud_and_missing_resources(self):
        self.assertEqual(self.request(), (200, {'groups': [], 'applications': []}))
        status, group = self.request('/api/application-groups', 'POST', {'name': 'Media'})
        self.assertEqual(status, 201)
        status, app = self.request(method='POST', body={'name': 'Media', 'url': 'https://media.example', 'group_id': group['id']})
        self.assertEqual(status, 201)
        status, edited = self.request('/api/applications/' + app['id'], 'PUT', {**app, 'name': 'Edited'})
        self.assertEqual((status, edited['name']), (200, 'Edited'))
        self.assertEqual(self.request('/api/applications/order', 'PUT', {'ids': [app['id']], 'group_id': group['id']})[0], 200)
        self.assertEqual(self.request('/api/application-groups/order', 'PUT', {'ids': [group['id']]})[0], 200)
        self.assertEqual(self.request('/api/applications/' + app['id'], 'DELETE')[0], 200)
        self.assertEqual(self.request('/api/applications/missing', 'PUT', {'name': 'Missing', 'url': 'https://example.test'})[0], 404)
        self.assertEqual(self.request('/api/application-groups/' + group['id'], 'DELETE')[0], 200)

    def test_auth_origin_and_input_limits_cover_all_mutations(self):
        self.assertEqual(self.request(token=False)[0], 401)
        for method, path in [('POST', '/api/applications'), ('PUT', '/api/applications/missing'),
                             ('DELETE', '/api/applications/missing'), ('POST', '/api/application-groups')]:
            self.assertEqual(self.request(path, method, {}, token=False)[0], 401)
            self.assertEqual(self.request(path, method, {}, headers={'Origin': 'https://attacker.example'})[0], 403)
        for body in [[], {}, {'name': 'x' * 70000}, {'name': 'X', 'url': 'javascript:alert(1)'}]:
            self.assertEqual(self.request(method='POST', body=body)[0], 400)

    def test_api_rejects_authorization_parameters_without_persisting_them(self):
        for url in ['https://app.example?accessToken=synthetic',
                    'https://app.example/#/login?authToken=synthetic']:
            self.assertEqual(self.request(method='POST', body={'name': 'App', 'url': url})[0], 400)
        self.assertEqual(self.request()[1]['applications'], [])

    def test_api_rejects_partial_duplicate_and_invalid_orders_atomically(self):
        apps = [self.request(method='POST', body={'name': name, 'url': 'https://app.example'})[1] for name in ['A', 'B']]
        ids = [a['id'] for a in apps]
        for order in [[ids[0]], [ids[0], ids[0]], [ids[0], 'missing']]:
            self.assertEqual(self.request('/api/applications/order', 'PUT', {'ids': order})[0], 400)
            self.assertEqual([a['id'] for a in self.request()[1]['applications']], ids)

    def test_api_revokes_confirmation_after_external_url_changes(self):
        status, app = self.request(method='POST', body={'name': 'App', 'url': 'https://app.example',
                                                      'external_url': 'https://app.example', 'external_access': 'confirmed'})
        self.assertEqual(status, 201)
        self.assertEqual(app['external_access'], 'confirmed')
        status, changed = self.request('/api/applications/' + app['id'], 'PUT', {**app, 'external_url': 'https://new.example'})
        self.assertEqual(status, 200)
        self.assertEqual(changed['external_access'], 'unverified')


if __name__ == '__main__':
    unittest.main()
