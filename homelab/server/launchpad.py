"""Persistent bookmarks. Reading a catalogue never contacts its applications."""
from contextlib import contextmanager
import hashlib
import os
from pathlib import Path
import re
import sqlite3
import uuid
from urllib.parse import parse_qsl, urlsplit


APPLICATION_FIELDS = 'id,name,url,local_url,external_url,external_access,icon,group_id,position'
SENSITIVE_PARAMETER = re.compile(r'(?:^|[_-])(?:token|secret|password|passwd|api[_-]?key|authorization|auth|key)(?:$|[_-])', re.I)


class ApplicationNotFound(LookupError):
    pass


def text(value, label, limit, required=True):
    if not isinstance(value, str):
        raise ValueError(f'{label}: ожидается текст')
    value = value.strip()
    if (required and not value) or len(value) > limit or any(ord(c) < 32 for c in value):
        raise ValueError(f'{label}: укажите от {1 if required else 0} до {limit} символов')
    return value


def web_url(value, required=False):
    value = text(value, 'Адрес', 2048, required)
    if not value:
        return ''
    try:
        parsed = urlsplit(value)
        valid = (parsed.scheme in ('http', 'https') and parsed.hostname
                 and not parsed.username and not parsed.password
                 and (parsed.port is None or 1 <= parsed.port <= 65535))
    except ValueError:
        valid = False
    if not valid or '\\' in value or any(c.isspace() or ord(c) == 127 for c in value):
        raise ValueError('Укажите полный HTTP(S)-адрес без логина и пароля')
    parameters = parse_qsl(parsed.query) + parse_qsl(parsed.fragment.split('?', 1)[-1])
    if any(SENSITIVE_PARAMETER.search(key) for key, _ in parameters):
        raise ValueError('Используйте ссылку без токенов и параметров авторизации')
    return value


class Launchpad:
    def __init__(self, path):
        self.path = str(path)
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self.db(write=True) as db:
            db.execute('''CREATE TABLE IF NOT EXISTS application_groups (
                id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
                position INTEGER NOT NULL)''')
            db.execute('''CREATE TABLE IF NOT EXISTS applications (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL,
                local_url TEXT NOT NULL, external_url TEXT NOT NULL,
                external_access TEXT NOT NULL, icon TEXT NOT NULL,
                group_id TEXT REFERENCES application_groups(id), position INTEGER NOT NULL,
                import_key TEXT UNIQUE)''')
        os.chmod(self.path, 0o600)

    @contextmanager
    def db(self, write=False):
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        try:
            with db:
                db.execute('BEGIN IMMEDIATE' if write else 'BEGIN')
                yield db
        finally:
            db.close()

    def catalogue(self):
        with self.db() as db:
            return {
                'groups': [dict(r) for r in db.execute('SELECT * FROM application_groups ORDER BY position,rowid')],
                'applications': [dict(r) for r in db.execute(f'SELECT {APPLICATION_FIELDS} FROM applications ORDER BY position,rowid')],
            }

    @staticmethod
    def existing(db, table, identifier):
        row = db.execute(f'SELECT * FROM {table} WHERE id=?', (identifier,)).fetchone()
        if row is None:
            raise ApplicationNotFound('Запись не найдена')
        return dict(row)

    @staticmethod
    def next_position(db, table, group_id=None):
        where, args = (' WHERE group_id IS ?', (group_id,)) if table == 'applications' else ('', ())
        return db.execute(f'SELECT COALESCE(MAX(position),-1)+1 FROM {table}{where}', args).fetchone()[0]

    def save_group(self, value, group_id=None):
        name = text(value.get('name', ''), 'Название группы', 80)
        with self.db(write=True) as db:
            previous = self.existing(db, 'application_groups', group_id) if group_id else None
            identifier = group_id or uuid.uuid4().hex
            position = previous['position'] if previous else self.next_position(db, 'application_groups')
            try:
                if previous:
                    db.execute('UPDATE application_groups SET name=? WHERE id=?', (name, identifier))
                else:
                    db.execute('INSERT INTO application_groups VALUES (?,?,?)', (identifier, name, position))
            except sqlite3.IntegrityError as error:
                raise ValueError('Группа с таким названием уже существует') from error
            return {'id': identifier, 'name': name, 'position': position}

    def validate_application(self, db, value, previous=None):
        group_id = value.get('group_id')
        if group_id is not None:
            if not isinstance(group_id, str) or not db.execute('SELECT 1 FROM application_groups WHERE id=?', (group_id,)).fetchone():
                raise ValueError('Группа не найдена')
        icon = text(value.get('icon', 'blueprint'), 'Иконка', 60)
        if not re.fullmatch(r'[a-z0-9-]+', icon):
            raise ValueError('Выберите иконку из каталога')
        external = web_url(value.get('external_url', ''))
        access = value.get('external_access', 'unverified' if external else 'unknown')
        if access not in ('confirmed', 'unverified', 'unknown'):
            raise ValueError('Некорректное состояние внешнего доступа')
        if access == 'confirmed' and not external:
            raise ValueError('Для подтверждения укажите внешний адрес')
        if not external:
            access = 'unknown'
        elif access == 'unknown' or (previous and previous['external_url'] != external):
            access = 'unverified'
        return {
            'name': text(value.get('name', ''), 'Название', 120),
            'url': web_url(value.get('url', ''), required=True),
            'local_url': web_url(value.get('local_url', '')),
            'external_url': external, 'external_access': access,
            'icon': icon, 'group_id': group_id,
        }

    def _save_application(self, db, value, application_id=None, import_key=None):
        previous = self.existing(db, 'applications', application_id) if application_id else None
        fields = self.validate_application(db, value, previous)
        identifier = application_id or uuid.uuid4().hex
        position = (previous['position'] if previous and previous['group_id'] == fields['group_id']
                    else self.next_position(db, 'applications', fields['group_id']))
        result = {'id': identifier, **fields, 'position': position}
        if previous:
            db.execute('UPDATE applications SET ' + ','.join(f'{key}=?' for key in fields) + ',position=? WHERE id=?',
                       (*fields.values(), position, identifier))
        else:
            db.execute('INSERT INTO applications (' + ','.join(result) + ',import_key) VALUES ('
                       + ','.join('?' for _ in range(len(result) + 1)) + ')', (*result.values(), import_key))
        return result

    def save_application(self, value, application_id=None):
        with self.db(write=True) as db:
            return self._save_application(db, value, application_id)

    def delete_application(self, identifier):
        with self.db(write=True) as db:
            self.existing(db, 'applications', identifier)
            db.execute('DELETE FROM applications WHERE id=?', (identifier,))

    def delete_group(self, identifier):
        with self.db(write=True) as db:
            self.existing(db, 'application_groups', identifier)
            position = self.next_position(db, 'applications')
            rows = db.execute('SELECT id FROM applications WHERE group_id=? ORDER BY position,rowid', (identifier,)).fetchall()
            for index, row in enumerate(rows):
                db.execute('UPDATE applications SET group_id=NULL,position=? WHERE id=?', (position + index, row['id']))
            db.execute('DELETE FROM application_groups WHERE id=?', (identifier,))

    def reorder(self, kind, ids, group_id=None):
        if kind not in ('groups', 'applications') or not isinstance(ids, list) or not all(isinstance(x, str) for x in ids):
            raise ValueError('Ожидается полный список записей в новом порядке')
        if len(ids) > 1000 or len(set(ids)) != len(ids):
            raise ValueError('Список содержит повторения или слишком много записей')
        if group_id is not None and not isinstance(group_id, str):
            raise ValueError('Некорректная группа')
        table = 'application_groups' if kind == 'groups' else 'applications'
        with self.db(write=True) as db:
            where, args = (' WHERE group_id IS ?', (group_id,)) if kind == 'applications' else ('', ())
            existing = {r['id'] for r in db.execute(f'SELECT id FROM {table}{where}', args)}
            if set(ids) != existing:
                raise ValueError('Состав списка изменился. Обновите страницу и повторите')
            for position, identifier in enumerate(ids):
                db.execute(f'UPDATE {table} SET position=? WHERE id=?', (position, identifier))

    def import_applications(self, records):
        if not isinstance(records, list) or len(records) > 1000:
            raise ValueError('Каталог должен содержать не более 1000 приложений')
        added = skipped = 0
        with self.db(write=True) as db:
            for record in records:
                if not isinstance(record, dict):
                    raise ValueError('Некорректная запись каталога')
                if record.get('include_by_default', True) is False:
                    continue
                key = text(record.get('import_key') or record.get('id') or hashlib.sha256(str(record.get('url', '')).encode()).hexdigest(), 'Ключ импорта', 128)
                if db.execute('SELECT 1 FROM applications WHERE import_key=?', (key,)).fetchone():
                    skipped += 1
                    continue
                group_name = text(record.get('group') or '', 'Группа', 80, required=False)
                group_id = None
                if group_name:
                    group = db.execute('SELECT id FROM application_groups WHERE name=?', (group_name,)).fetchone()
                    group_id = group['id'] if group else uuid.uuid4().hex
                    if not group:
                        db.execute('INSERT INTO application_groups VALUES (?,?,?)', (group_id, group_name, self.next_position(db, 'application_groups')))
                icon = record.get('icon') or 'blueprint'
                if not isinstance(icon, str):
                    raise ValueError('Некорректная иконка')
                icon = re.sub(r'\.(png|webp|svg)$', '', icon)
                generic_icons = {'mdi-router-wireless': 'router', 'mdi-tape-measure': 'ruler',
                                 'mdi-share-variant': 'share', 'mdi-microphone': 'microphone',
                                 'mdi-pistol': 'gamepad', 'mdi-monitor-dashboard': 'dashboard',
                                 'mdi-television-play': 'television'}
                icon = generic_icons.get(icon, 'blueprint' if icon.startswith('mdi-') else icon)
                external_urls = record.get('external_urls', [])
                if not isinstance(external_urls, list):
                    raise ValueError('Некорректный список внешних адресов')
                external = record.get('external_url') or (external_urls[0] if external_urls else '')
                self._save_application(db, {
                    'name': record.get('name', ''), 'url': record.get('url', ''),
                    'local_url': record.get('local_url') or '', 'external_url': external,
                    'external_access': 'unverified' if external else 'unknown',
                    'group_id': group_id, 'icon': icon,
                }, import_key=key)
                added += 1
        return {'added': added, 'skipped': skipped}
