#!/usr/bin/env python3
"""Finalize a prebuilt server installation and verify its authenticated API."""
import argparse
import ipaddress
import json
import os
from pathlib import Path
import pwd
import secrets
import shutil
import subprocess
import tempfile
import time
from urllib.request import Request, urlopen
from urllib.error import URLError


def run(*args,check=True):
    return subprocess.run(args,check=check)


def environment(existing):
    values=dict(line.split('=',1) for line in existing.splitlines() if '=' in line and not line.lstrip().startswith('#'))
    values.setdefault('HOMELAB_DASHBOARD_TOKEN',secrets.token_urlsafe(32))
    token=values['HOMELAB_DASHBOARD_TOKEN']
    if not 24<=len(token)<=256 or not token.isascii() or any(c.isspace() for c in token):
        raise ValueError('Existing dashboard token is invalid; configuration was not changed')
    port=int(values.get('HOMELAB_DASHBOARD_PORT','8080'))
    if not 1<=port<=65535:raise ValueError('Dashboard port must be between 1 and 65535')
    values['HOMELAB_DASHBOARD_PORT']=str(port)
    return ''.join(f'{key}={value}\n' for key,value in values.items()),token,port


def wait_for_api(url,token,timeout=40):
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        try:
            with urlopen(Request(url,headers={'Authorization':'Bearer '+token}),timeout=3) as response:
                data=json.load(response)
            if isinstance(data.get('hosts'),list):return
        except (URLError,OSError,ValueError):
            pass
        time.sleep(1)
    raise RuntimeError('Service did not pass its API health check; inspect journalctl -u homelab-dashboard')


def copy_release(source,dist,releases):
    if not (dist/'index.html').is_file():raise ValueError('Built frontend index.html is missing')
    releases.mkdir(parents=True,exist_ok=True)
    release=Path(tempfile.mkdtemp(prefix=time.strftime('%Y%m%d-%H%M%S-'),dir=releases))
    for folder in ('homelab','deploy'):
        shutil.copytree(source/folder,release/folder,ignore=shutil.ignore_patterns('__pycache__','*.pyc','collectors'))
    shutil.copytree(dist,release/'dist')
    shutil.copy2(source/'README.md',release/'README.md')
    shutil.copy2(source/'requirements.txt',release/'requirements.txt')
    for directory,_,files in os.walk(release):
        os.chmod(directory,0o755)
        for filename in files:os.chmod(Path(directory)/filename,0o644)
    return release


def switch_release(link,destination):
    temporary=link.with_name(link.name+'.next')
    temporary.unlink(missing_ok=True)
    temporary.symlink_to(destination,target_is_directory=True)
    temporary.replace(link)


def activate_release(current,release,unit_path,unit,token,port,runner=run,health_check=wait_for_api):
    previous=current.resolve() if current.is_symlink() else None
    previous_unit=unit_path.read_text() if unit_path.exists() else None
    was_active=runner('systemctl','is-active','--quiet','homelab-dashboard',check=False).returncode==0
    if was_active:runner('systemctl','stop','homelab-dashboard')
    try:
        switch_release(current,release)
        unit_path.write_text(unit)
        runner('systemctl','daemon-reload')
        runner('systemctl','restart','homelab-dashboard')
        health_check(f'http://127.0.0.1:{port}/api/hosts',token)
        runner('systemctl','enable','homelab-dashboard')
    except Exception:
        runner('systemctl','stop','homelab-dashboard',check=False)
        if previous:switch_release(current,previous)
        else:current.unlink(missing_ok=True)
        if previous_unit is not None:unit_path.write_text(previous_unit)
        else:unit_path.unlink(missing_ok=True)
        runner('systemctl','daemon-reload')
        if was_active:runner('systemctl','restart','homelab-dashboard',check=False)
        raise


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,required=True)
    parser.add_argument('--dist',type=Path,required=True)
    args=parser.parse_args()
    if os.geteuid()!=0:parser.error('Root is required')
    source=args.source.resolve()
    config_dir=Path('/etc/homelab')
    env_path=config_dir/'dashboard.env'
    contents,token,port=environment(env_path.read_text() if env_path.exists() else '')
    try:user=pwd.getpwnam('homelab')
    except KeyError:
        run('useradd','--system','--home','/var/lib/homelab','--shell','/usr/sbin/nologin','homelab')
        user=pwd.getpwnam('homelab')
    config_dir.mkdir(parents=True,exist_ok=True,mode=0o750)
    os.chown(config_dir,0,user.pw_gid)
    os.chmod(config_dir,0o750)
    env_path.touch(mode=0o600,exist_ok=True)
    os.chmod(env_path,0o600)
    env_path.write_text(contents)
    data=Path('/var/lib/homelab')
    data.mkdir(parents=True,exist_ok=True,mode=0o700)
    os.chown(data,user.pw_uid,user.pw_gid)
    os.chmod(data,0o700)
    target=Path('/opt/homelab-dashboard')
    target.mkdir(parents=True,exist_ok=True)
    current=target/'current'
    if current.exists() and not current.is_symlink():
        raise RuntimeError('Managed current path must be a symlink; refusing to replace existing files')
    release=copy_release(source,args.dist.resolve(),target/'releases')
    unit_path=Path('/etc/systemd/system/homelab-dashboard.service')
    unit=(source/'deploy/homelab-dashboard.service').read_text()
    unit=unit.replace('WorkingDirectory=/opt/homelab-dashboard','WorkingDirectory=/opt/homelab-dashboard/current')
    unit=unit.replace('--bind 0.0.0.0','--bind 0.0.0.0 --port '+str(port))
    activate_release(current,release,unit_path,unit,token,port)
    print('\nDashboard installed and API health check passed.')
    print(f'Local URL: http://127.0.0.1:{port}')
    addresses=subprocess.run(['hostname','-I'],capture_output=True,text=True,check=False).stdout.split()
    for address in addresses:
        try:
            ip=ipaddress.ip_address(address)
            if ip.version==4 and not ip.is_loopback:print(f'LAN URL: http://{ip}:{port}')
        except ValueError:pass
    print('Login token: '+token)
    print('Keep this token private. It is also stored in /etc/homelab/dashboard.env.')
    print('Metrics: install homelab-agent separately on each monitored Linux host and add it in the dashboard.')
    print('Data: /var/lib/homelab/dashboard.sqlite')
    print('Restart: systemctl restart homelab-dashboard')

if __name__=='__main__':main()
