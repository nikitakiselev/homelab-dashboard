#!/usr/bin/env python3
"""Install/update the bundled Linux agent; preserves credentials and history."""
import argparse
import os
import platform
import secrets
import shutil
import subprocess
import sys
import importlib.util
import json
import time
from urllib.request import Request, urlopen
from urllib.error import URLError
from pathlib import Path


sys.path.insert(0,str(Path(__file__).resolve().parent.parent))
from homelab.shared.packaging import AGENT_SOURCE_FILES


def install_sources(source,target):
    for filename in AGENT_SOURCE_FILES:
        origin=source/filename
        dest=target/filename
        dest.parent.mkdir(parents=True,exist_ok=True)
        if origin.resolve()!=dest.resolve():
            shutil.copy2(origin,dest)
    # The package replaces the old flat module. Keep legacy storage if an older
    # central server is co-installed and still imports it.
    (target/'homelab/agent.py').unlink(missing_ok=True)
    if not (target/'homelab/server.py').exists():
        (target/'homelab/storage.py').unlink(missing_ok=True)


def run(*args):
    subprocess.run(args, check=True)


def environment(existing, port, interfaces):
    values = {}
    for line in existing.splitlines():
        if line and not line.startswith('#') and '=' in line:
            key, value = line.split('=', 1)
            values[key] = value
    values.setdefault('HOMELAB_AGENT_TOKEN', secrets.token_urlsafe(32))
    token = values['HOMELAB_AGENT_TOKEN']
    if not 24 <= len(token) <= 256 or not token.isascii() or any(c.isspace() for c in token):
        raise ValueError('Existing HOMELAB_AGENT_TOKEN has an invalid length')
    if interfaces is not None:
        if any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789,._:-' for c in interfaces):
            raise ValueError('Invalid interface names')
        values['HOMELAB_INTERFACES'] = interfaces
    values['HOMELAB_AGENT_PORT'] = str(port)
    return ''.join(f'{key}={value}\n' for key, value in values.items())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=None)
    parser.add_argument('--interfaces', default=None, help='Example: enp3s0,enp4s0')
    parser.add_argument('--skip-packages', action='store_true', help='Do not install missing smartmontools/util-linux')
    parser.add_argument('--check', action='store_true', help='Only check requirements; do not change the machine')
    args = parser.parse_args()
    if platform.system() != 'Linux':
        parser.error('This installer runs on Linux only')
    if sys.version_info < (3, 10):
        parser.error('Python 3.10+ is required')
    if not shutil.which('systemctl'):
        parser.error('A systemd-based Linux host is required')
    source = Path(__file__).resolve().parent.parent
    if not (source/'homelab/agent/__main__.py').is_file():
        parser.error('Extract the entire agent archive before installation')
    if args.check:
        for binary in ('python3', 'lsblk', 'smartctl', 'systemctl'):
            print(f'{binary}: {shutil.which(binary) or "MISSING"}')
        return
    if os.geteuid() != 0:
        parser.error('Run with sudo python3 deploy/install_agent.py')
    if importlib.util.find_spec('yaml') is None:
        if args.skip_packages or not shutil.which('apt-get'):
            parser.error('Install PyYAML from requirements.txt or python3-yaml before using YAML configuration')
        run('apt-get','update')
        run('apt-get','install','-y','python3-yaml')
    import yaml
    from homelab.shared.config import load_config
    env_path = Path('/etc/homelab/agent.env')
    config_path = Path('/etc/homelab/agent.yaml')
    config = load_config(config_path) if config_path.exists() else None
    existing = env_path.read_text() if env_path.exists() else ''
    current = dict(line.split('=', 1) for line in existing.splitlines() if '=' in line and not line.startswith('#'))
    port = args.port if args.port is not None else config.port if config else int(current.get('HOMELAB_AGENT_PORT', 9108))
    if not 1 <= port <= 65535:
        parser.error('Port must be between 1 and 65535')
    # Validate configuration before modifying files or installing packages.
    content = environment(existing, port, args.interfaces)
    if args.interfaces is not None:
        content='\n'.join(line for line in content.splitlines() if not line.startswith('HOMELAB_INTERFACES='))+'\n'
    packages = {'lsblk':'util-linux','smartctl':'smartmontools'}
    if any((card/'device/vendor').read_text().strip()=='0x8086'
           for card in Path('/sys/class/drm').glob('card[0-9]*')
           if '-' not in card.name and (card/'device/vendor').exists()):
        packages['intel_gpu_top'] = 'intel-gpu-tools'
    missing = [name for name in packages if not shutil.which(name)]
    if missing and not args.skip_packages:
        if not shutil.which('apt-get'):
            parser.error('Install missing packages with your package manager: '+', '.join(packages[name] for name in missing))
        run('apt-get','update')
        run('apt-get','install','-y',*(packages[name] for name in missing))
    elif missing:
        print('Warning: missing utilities: '+', '.join(missing))
    target = Path('/opt/homelab-dashboard')
    target.mkdir(parents=True, exist_ok=True)
    install_sources(source,target)
    env_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Create private file atomically. An update keeps the token and interface settings.
    temporary = env_path.with_suffix('.tmp')
    descriptor = os.open(temporary, os.O_WRONLY|os.O_CREAT|os.O_TRUNC, 0o600)
    try:
        with os.fdopen(descriptor, 'w') as stream:
            stream.write(content)
        os.chmod(temporary,0o600)
        temporary.replace(env_path)
    finally:
        temporary.unlink(missing_ok=True)
    if not config_path.exists():
        config_path.write_text((source/'deploy/agent.example.yaml').read_text().replace('port: 9108','port: '+str(port)))
        os.chmod(config_path,0o640)
    if args.port is not None or args.interfaces is not None:
        value=yaml.safe_load(config_path.read_text()) or {}
        if args.port is not None:value.setdefault('server',{})['port']=port
        if args.interfaces is not None:value.setdefault('network',{})['interfaces']=[name for name in args.interfaces.split(',') if name]
        config_path.write_text(yaml.safe_dump(value,sort_keys=False))
    config=load_config(config_path)
    data_parent=Path(config.path).parent
    data_parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    unit = (source/'deploy/homelab-agent.service').read_text()
    if data_parent != Path('/var/lib/homelab-agent'):
        unit=unit.replace('ProtectSystem=strict','ProtectSystem=strict\nReadWritePaths='+str(data_parent))
    Path('/etc/systemd/system/homelab-agent.service').write_text(unit)
    run('systemctl','daemon-reload')
    run('systemctl','enable','homelab-agent')
    run('systemctl','restart','homelab-agent')
    run('systemctl','is-active','--quiet','homelab-agent')
    host='127.0.0.1' if config.bind=='0.0.0.0' else config.bind
    deadline=time.monotonic()+40
    while True:
        try:
            with urlopen(Request(f'http://{host}:{port}/v1/metrics',headers={'Authorization':'Bearer '+dict(line.split('=',1) for line in content.splitlines() if '=' in line)['HOMELAB_AGENT_TOKEN']}),timeout=3) as response:
                metrics=json.load(response)
            if 'agent_id' in metrics:break
        except (URLError,OSError,ValueError):pass
        if time.monotonic()>deadline:raise RuntimeError('Agent API health check failed; inspect journalctl -u homelab-agent')
        time.sleep(1)
    print(f'Agent installed, service active, API verified on port {port}.')
    print('Agent token: '+dict(line.split('=',1) for line in content.splitlines() if '=' in line)['HOMELAB_AGENT_TOKEN'])
    print('Config: /etc/homelab/agent.yaml')
    print('Credentials: /etc/homelab/agent.env (root only; existing token preserved).')
    print('History: /var/lib/homelab-agent/agent.sqlite (preserved on update).')
    print('Permit this port only from the dashboard IP in your existing firewall.')
    print('Logs: journalctl -u homelab-agent -n 50 --no-pager')

if __name__ == '__main__':
    main()
