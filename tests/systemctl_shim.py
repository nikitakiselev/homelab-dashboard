#!/usr/bin/python3
"""Container-only test shim: runs real service commands without systemd as PID 1."""
import json
import os
from pathlib import Path
import pwd
import shlex
import signal
import subprocess
import sys
import time

if not Path('/run/homelab-installer-test').exists():
    raise SystemExit('This shim is for the isolated installer test only')
args=[arg for arg in sys.argv[1:] if not arg.startswith('-')]
command=args[0]
name=args[-1].removesuffix('.service')
state=Path('/tmp/test-service-'+name+'.json')
def stop():
    if state.exists():
        try:os.killpg(json.loads(state.read_text())['pid'],signal.SIGTERM)
        except ProcessLookupError:pass
        pid=json.loads(state.read_text())['pid']
        for _ in range(100):
            stat=Path(f'/proc/{pid}/stat')
            if not stat.exists() or stat.read_text().split()[2]=='Z':break
            time.sleep(.05)
        state.unlink()
if command in ('daemon-reload','enable'):raise SystemExit(0)
if command=='is-active':
    if not state.exists():raise SystemExit(3)
    try:os.kill(json.loads(state.read_text())['pid'],0)
    except ProcessLookupError:raise SystemExit(3)
    if '--quiet' not in sys.argv:print('active')
    raise SystemExit(0)
if command=='stop':stop();raise SystemExit(0)
if command in ('restart','start'):
    stop()
    unit={}
    for line in Path('/etc/systemd/system/'+name+'.service').read_text().splitlines():
        if '=' in line:
            key,value=line.split('=',1);unit[key]=value
    env=dict(os.environ)
    for line in Path(shlex.split(unit['EnvironmentFile'])[0]).read_text().splitlines():
        if '=' in line:
            key,value=line.split('=',1);env[key]=value
    user=pwd.getpwnam(unit['User'])
    def drop_privileges():
        os.setgroups([]);os.setgid(user.pw_gid);os.setuid(user.pw_uid)
    # systemd creates StateDirectory before changing user.
    data=Path('/var/lib')/unit['StateDirectory'];data.mkdir(parents=True,exist_ok=True)
    os.chown(data,user.pw_uid,user.pw_gid)
    log=Path('/tmp/'+name+'.log').open('ab')
    process=subprocess.Popen(shlex.split(unit['ExecStart']),cwd=unit.get('WorkingDirectory','/'),env=env,stdout=log,stderr=log,start_new_session=True,preexec_fn=drop_privileges)
    state.write_text(json.dumps({'pid':process.pid}))
    raise SystemExit(0)
raise SystemExit('Unsupported shim command: '+command)
