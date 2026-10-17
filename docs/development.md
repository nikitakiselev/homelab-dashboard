# Разработка

Целевая платформа: Ubuntu 22.04+ и Debian 12+ с systemd. Для разработки нужны Python 3.10+, Node.js 22+ и npm.

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
python3 -m homelab.agent --config deploy/agent.example.yaml --check-config
```

В Linux дополнительно запускается `python3 tests/linux_smoke.py`: реальный сбор CPU/памяти, HTTP-агент, синхронизация, восстановление истории и встроенный сборщик. Тест не требует доступа к домашним серверам. SMART и GPU отдельно проверяются на физическом оборудовании; отсутствие соответствующего устройства в CI не доказывает его поддержку.

Изменения UI форматируются через `npm run format`. Не включайте в коммиты env-файлы, базы метрик, сгенерированные архивы, `node_modules` и сведения о домашней инфраструктуре.

## Структура

```text
frontend/             React, Tailwind, shadcn/ui
homelab/agent/        Сбор метрик Linux, расписание, HTTP API
homelab/server/       Центральный API, опрос, синхронизация, архив агента
homelab/shared/       SQLite, YAML и состав установочного пакета
install.sh            Bootstrap для центрального сервиса или --agent
deploy/               Установка, примеры YAML и systemd-units
tests/                Модульные и интеграционные проверки
docs/                 Пользовательская и техническая документация
```

`shared` не импортирует сервер или агент. Отдельный агент не импортирует центральный сервис; его архив проверяется отдельно от frontend.

Интеграционная проверка bootstrap-установщика и границы её достоверности описаны в [installer-testing.md](installer-testing.md).
