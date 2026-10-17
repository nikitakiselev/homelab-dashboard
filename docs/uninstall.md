# Удаление

Ниже — удаление установленной программы и systemd-службы. Настройки, токены и история сохраняются для повторной установки. Команды выполняются на машине соответствующего компонента.

## Агент

```sh
sudo systemctl disable --now homelab-agent
sudo rm -f /etc/systemd/system/homelab-agent.service
sudo rm -f /usr/local/bin/homelab-agent /usr/local/bin/homelab-agent.previous /usr/local/bin/homelab-agent.next
sudo systemctl daemon-reload
```

После остановки дашборд покажет сервер недоступным. Если он больше не нужен, удалите его запись в дашборде: это удалит центральную копию истории, но не данные на машине агента.

### Полная очистка данных агента

Следующие команды необратимо удаляют токен, настройки и историю агента. Сначала выполните удаление службы выше и сохраните нужные данные.

```sh
sudo rm -f /etc/homelab/agent.env /etc/homelab/agent.yaml
sudo rm -rf /var/lib/homelab-agent
```

Если в YAML задан другой `history.path`, его SQLite-файл и связанные `-wal`/`-shm` находятся по указанному пути. Удаляйте их отдельно после остановки службы. Каталог `/etc/homelab` целиком не удаляется: в нём может находиться конфигурация центрального сервиса.

## Центральный сервис

```sh
sudo systemctl disable --now homelab-dashboard
sudo rm -f /etc/systemd/system/homelab-dashboard.service
sudo systemctl daemon-reload
sudo rm -f /opt/homelab-dashboard/current /opt/homelab-dashboard/current.next
sudo rm -rf /opt/homelab-dashboard/releases
```

Удаляются установленные версии центрального сервиса. Его SQLite и конфигурация остаются на диске. Отдельные агенты на других машинах продолжают собирать историю.

### Полная очистка данных центрального сервиса

Следующие команды необратимо удаляют настройки, токен входа, список подключённых серверов, их токены и центральную историю. Сначала выполните удаление службы выше и сохраните нужные данные.

```sh
sudo rm -f /etc/homelab/dashboard.env /etc/homelab/collector.yaml
sudo rm -rf /var/lib/homelab
```

Самостоятельный Go-агент на этой же машине, если установлен, использует собственные файлы и удаляется отдельно. Для прежних установок Python-агента могут оставаться файлы в `/opt/homelab-dashboard/homelab`; они не удаляются этими командами.

## Что остаётся

Системные пакеты (`smartmontools`, `util-linux`, `intel-gpu-tools`, Python и другие), системные журналы и служебные пользователи `homelab`/`homelab-build` не удаляются. Они могут использоваться другими программами; удаление пакетов выполняется отдельно через системный пакетный менеджер.

При сохранённых YAML, env и SQLite обычная команда установки восстановит соответствующую службу с прежними настройками и историей.
