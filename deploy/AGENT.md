# Linux agent

Агент написан на Go и распространяется готовым бинарником для Linux x86_64 и ARM64. Целевые системы — Ubuntu 22.04+ и Debian 12+ с systemd. Python и Go-компилятор на хосте не нужны.

```sh
curl -fsSL https://raw.githubusercontent.com/nikitakiselev/homelab-dashboard/main/install.sh | sudo sh -s -- --agent
```

Установщик скачивает бинарник из GitHub Releases, проверяет SHA-256, создаёт YAML и токен при первом запуске, устанавливает systemd-службу и проверяет API. Для SMART устанавливается smartmontools, для Intel GPU — intel-gpu-tools. Драйверы GPU и правила firewall установщик не меняет.

Для установки из архива дашборда:

```sh
tar -xzf homelab-agent.tar.gz
cd homelab-agent
sudo sh deploy/install_agent.sh
```

Архив содержит установщик и пример YAML; бинарник скачивается из GitHub Releases. Нужен исходящий HTTPS-доступ.

## CLI

```sh
homelab-agent version
sudo homelab-agent init
sudo homelab-agent status
sudo homelab-agent start
sudo homelab-agent restart
sudo homelab-agent stop
sudo homelab-agent logs --follow
sudo homelab-agent check-config
sudo homelab-agent doctor
sudo homelab-agent upgrade
```

`init` создаёт `/etc/homelab/agent.yaml` и `/etc/homelab/agent.env`, сохраняя существующие файлы. `status` проверяет systemd и авторизованный API на порту из YAML. `check-config` проверяет YAML без запуска. `doctor` показывает доступность системных утилит. Ручной запуск: `sudo homelab-agent run`.

`upgrade` скачивает последнюю опубликованную версию, проверяет SHA-256 и бинарник, затем заменяет файл и перезапускает службу. При ошибке API восстанавливаются предыдущие бинарник и systemd-unit. Конфигурация, токен и SQLite сохраняются. Для конкретной версии: `sudo homelab-agent upgrade --version agent-v0.2.0`. Параллельные установки блокируются.

## Конфигурация и подключение

Настройки: `/etc/homelab/agent.yaml`. Пример порта, отличающегося от стандартного:

```yaml
server:
  bind: 0.0.0.0
  port: 19108
```

После изменения выполните `sudo homelab-agent restart` и укажите тот же порт в дашборде. Занятый порт приводит к ошибке запуска, автоматического переключения порта нет.

После установки итоговый блок показывает hostname, IP-адреса, порт из YAML и токен для добавления в дашборд. При `upgrade` токен не выводится.

Токен хранится отдельно с правами 0600: `sudo cat /etc/homelab/agent.env`. В дашборде нажмите «Добавить сервер», укажите частный IP, порт и значение `HOMELAB_AGENT_TOKEN`. Firewall должен разрешать этот порт только от IP центрального сервиса.

По умолчанию CPU/память/сеть снимаются раз в 5 секунд, SMART — раз в минуту. GPU и SMART опрашиваются отдельно от основных метрик. YAML управляет интервалами, интерфейсами и сроком хранения. SQLite по умолчанию: `/var/lib/homelab-agent/agent.sqlite`; история хранится 90 дней. Агент продолжает сбор без центрального сервиса, после подключения история догружается.

При переходе с прежнего Python-агента сохраняются идентификатор машины, токен и формат SQLite. Существующий YAML не переписывается. Если YAML ещё нет, порт и интерфейсы переносятся из прежнего env-файла.

NVIDIA требует установленного драйвера с `nvidia-smi`. AMD использует счётчики sysfs. Intel i915 использует `intel_gpu_top`; отображается максимальная занятость движков. Недоступные показатели не подменяются нулём.

Версия показывается на карточке хоста и в подробностях; поле API — `agent_version`. Старые агенты без этого поля отображаются как «Неизвестна».

Транспорт HTTP предназначен для доверенной LAN/VPN. Не открывайте агент в интернет. Для отключения автозапуска: `sudo systemctl disable --now homelab-agent`; история остаётся на диске.

## Удаление

Удаление службы и бинарника с сохранением настроек, токена и истории:

```sh
sudo systemctl disable --now homelab-agent
sudo rm -f /etc/systemd/system/homelab-agent.service
sudo rm -f /usr/local/bin/homelab-agent /usr/local/bin/homelab-agent.previous /usr/local/bin/homelab-agent.next
sudo systemctl daemon-reload
```

Для полной очистки после остановки службы удалите `/etc/homelab/agent.env`, `/etc/homelab/agent.yaml` и `/var/lib/homelab-agent`. Это необратимо удалит токен, настройки и историю. При нестандартном `history.path` удалите данные по указанному пути отдельно. Файлы центрального сервиса и системные пакеты не удаляются.
