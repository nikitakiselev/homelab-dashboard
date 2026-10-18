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

Для frontend-разработки запустите backend и `npm run dev` в разных терминалах. Vite проксирует `/api` в `127.0.0.1:8080`. Данные разработки сохраняются в `data/`; этот каталог исключён из Git.

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

Проверки объединения сетевой истории и выбора серверов в легенде: `node --experimental-strip-types --test tests/frontend/network-history.test.mjs` (Node.js 22.6+).

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
