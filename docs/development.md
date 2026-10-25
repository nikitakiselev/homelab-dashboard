# Разработка

Целевая платформа: Ubuntu 22.04+ и Debian 12+ с systemd. Для центрального сервиса нужны Python 3.10+, Node.js 22+ и npm; для агента — Go (версия указана в `agent/go.mod`).

```sh
python3 -m venv .venv
. .venv/bin/activate
python3 -m pip install -r requirements.txt
npm ci
npm run build
python3 -m homelab.server
```

Для frontend-разработки запустите backend и `npm run dev` в разных терминалах. Vite проксирует `/api` в `127.0.0.1:8080`. Базы разработки сохраняются в `data/`; файлы `*.sqlite*` исключены из Git. Произвольные JSON-файлы в этом каталоге не игнорируются: частные каталоги ссылок держите вне репозитория.

## Проверки

```sh
python3 -m unittest discover -s tests -v
npm run build
sh -n install.sh
cd agent
go test -race ./...
go build -o ../releases/homelab-agent ./cmd/homelab-agent
```

В Linux дополнительно запускается `python3 tests/linux_smoke.py`: реальный сбор CPU/памяти, HTTP-агент, синхронизация, восстановление истории и независимый перезапуск дашборда. Тест не требует доступа к домашним серверам. SMART и GPU отдельно проверяются на физическом оборудовании; отсутствие соответствующего устройства в CI не доказывает его поддержку.

Изменения UI форматируются через `npm run format`. Не включайте в коммиты env-файлы, базы метрик, сгенерированные архивы, `node_modules` и сведения о домашней инфраструктуре.

Проверки сетевой истории, распознавания приложений, поиска и подписей внешнего доступа: `node --experimental-strip-types --test tests/frontend/*.test.mjs` (Node.js 22.6+).

## Каталог приложений

Главная `/` — отдельный экран в стиле Launchpad: размытый фон, поиск по центру и
одна сетка без групп, заголовка, счётчика и панелей навигации. Добавление и
настройки скрыты в меню-бургере; «Настроить приложения» включает перемещение и
редактирование. Приложения открываются в новой вкладке. Встроенный первый ярлык
«Homelab» открывает `/overview` в текущей вкладке; оттуда доступны серверы и диски.
Он не хранится в частном каталоге, не удаляется и работает при любом адресе установки.
На главной браузер не опрашивает метрики серверов. При обновлении старого каталога
сохраняется последовательность иконок, которая раньше была видна в разделах.
Удаление ярлыка не влияет на сервис. Каталог хранится в центральной
SQLite и сохраняется между браузерами и пересозданием контейнера с тем же volume.

Глобус с вопросом обозначает найденный внешний адрес. Полный глобус появляется
после явного подтверждения владельцем в форме. Это настройка, а не мониторинг
доступности; проверки из интернета не выполняются. В форме можно сохранить
основной, локальный и внешний адреса, выбрав любой адрес для открытия по умолчанию.

Первоначальный импорт выполняется из частного JSON, например из
`/private/tmp/example-launchpad/catalog.json`. Используйте собственный путь вне
репозитория. Перед импортом создайте копию базы стандартной командой backup.

```sh
python3 - <<'PY'
from pathlib import Path
from homelab.server.backup import snapshot
print(snapshot(Path('data/dashboard.sqlite'), Path('data/backups')))
PY
python3 -m homelab.server.launchpad_import --data ./data/dashboard.sqlite --catalog /private/tmp/example-launchpad/catalog.json
```

По умолчанию backup читает `/data/dashboard.sqlite` в Docker. Для локальной базы
используйте `snapshot(Path('data/dashboard.sqlite'), Path('data/backups'))` из
`homelab.server.backup`, передав оба пути явно. Не импортируйте в чужой или
неподтверждённый volume. Команда импорта работает с указанной базой; пути по
умолчанию CLI и Docker различаются.

Минимальный формат файла (все адреса синтетические):

```json
{
  "applications": [
    {
      "id": "media-primary",
      "name": "Plex",
      "url": "https://plex.example",
      "local_url": "http://192.168.50.12:32400/web",
      "external_urls": ["https://plex.example"],
      "group": "Медиа",
      "icon": "plex",
      "include_by_default": true
    }
  ]
}
```

`id` служит стабильным ключом импорта; если он отсутствует, используется хеш URL.
Повторный импорт пропускает существующие ключи, не перезаписывает ручные изменения
и не удаляет записи. `include_by_default: false` исключает запись из импорта.
Все новые внешние адреса получают `unverified`, даже если входной файл содержит
подтверждение. Ошибка новой записи откатывает весь импорт. Секреты виджетов,
Docker environment и SSH-доступ не импортируются. URL должны использовать HTTP(S)
без встроенных логина/пароля и параметров с токенами или API-ключами.

Авторизованные API каталога:

| Метод и путь                         | Назначение                                        |
| ------------------------------------ | ------------------------------------------------- |
| `GET /api/applications`              | `{groups, applications}`                          |
| `POST /api/applications`             | Создать ярлык                                     |
| `PUT /api/applications/:id`          | Заменить редактируемые поля ярлыка                |
| `DELETE /api/applications/:id`       | Удалить ярлык                                     |
| `POST /api/application-groups`       | Создать группу `{name}`                           |
| `PUT /api/application-groups/:id`    | Переименовать группу `{name}`                     |
| `DELETE /api/application-groups/:id` | Удалить группу, сохранив ярлыки                   |
| `PUT /api/applications/order`        | Общий порядок `{scope: "all", ids}` по всей сетке |
| `PUT /api/application-groups/order`  | Полная перестановка `{ids}` групп                 |

Поля ярлыка: `name`, `url`, `local_url`, `external_url`, `external_access`
(`unknown`, `unverified`, `confirmed`), `icon`, `group_id` (ID или `null`).
Ответ включает `id`, `position` и `launchpad_position` — постоянный общий порядок.
Группы и перестановка `{group_id, ids}` поддерживаются API для совместимости со
старыми каталогами, но не отображаются на главной и не меняют её общий порядок.
Создание возвращает 201, изменение — 200;
некорректные данные — 400, неизвестный ID — 404. Действуют существующие Bearer token,
trusted networks и проверка origin. JSON-тело ограничено 64 КиБ. Каталог не зависит
от подключённых агентов и не выполняет сетевые запросы по сохранённым URL.

## Структура

```text
frontend/             React, Tailwind, shadcn/ui
agent/                Go: Linux-агент, CLI, HTTP API и история
homelab/server/       Центральный API, опрос, синхронизация, архив агента
homelab/shared/       SQLite, YAML и состав установочного пакета
install.sh            Bootstrap для центрального сервиса или --agent
deploy/               Установка, примеры YAML и systemd-units
tests/                Модульные и интеграционные проверки
docs/                 Пользовательская и техническая документация
```

Go-агент — отдельный модуль `agent/go.mod`. Сборка без CGo: `CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build ./cmd/homelab-agent` из `agent/`. Сборщики оборудования находятся только в Go-агенте; дашборд использует Python standard library и только опрашивает API зарегистрированных агентов. Для Linux smoke-теста сначала соберите бинарник в `releases/homelab-agent_linux_amd64` либо задайте `HOMELAB_AGENT_BINARY`. GitHub Actions собирает обе архитектуры по тегу `agent-vX.Y.Z`, публикуя бинарники и SHA256SUMS в Releases.

Интеграционная проверка bootstrap-установщика и границы её достоверности описаны в [installer-testing.md](installer-testing.md).

## Docker-релизы дашборда

Сборка и публикация GHCR выполняются по тегам `dashboard-vX.Y.Z`. Запуск и обновление — стандартным Docker Compose. Описание образа, версий, backup и миграции из systemd: [Docker deployment](docker.md). Для локальной проверки двух образов используйте `tests/docker_smoke.py --image FIRST --next-image SECOND`; образы должны сообщать разные версии. Тест создаёт и удаляет только свой контейнер и volume с уникальным именем.
