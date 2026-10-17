"""Linux agent. Optional smartmontools and nvidia-smi enrich hardware data."""
import argparse
import hashlib
import hmac
import json
import os
import platform
import shutil
import signal
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from .storage import History


def read(path, default=''):
    try:
        return Path(path).read_text().strip()
    except OSError:
        return default


def command(args):
    try:
        p = subprocess.run(args, capture_output=True, text=True, timeout=10)
        return p.stdout
    except (OSError, subprocess.TimeoutExpired):
        return ''


def disks():
    raw = command(['lsblk', '-J', '-b', '-o', 'NAME,TYPE,SIZE,MODEL,ROTA,TRAN,MOUNTPOINTS'])
    try:
        devices = json.loads(raw)['blockdevices']
    except (ValueError, KeyError):
        return []
    result = []
    # Filesystem usage is assigned once; mounted filesystems may span multiple disks.
    seen_fs = set()
    for d in devices:
        if d['type'] != 'disk' or d['name'].startswith(('loop', 'ram', 'zram')):
            continue
        mounts = []
        def walk(node):
            mounts.extend(m for m in (node.get('mountpoints') or []) if m and m.startswith('/'))
            for child in node.get('children', []):
                walk(child)
        walk(d)
        volumes = []
        for mount in sorted(set(mounts)):
            try:
                fs_id = os.stat(mount).st_dev
                if fs_id in seen_fs:
                    continue
                seen_fs.add(fs_id)
                usage = shutil.disk_usage(mount)
                volumes.append({'mount':mount, 'total':usage.total, 'used':usage.used})
            except OSError:
                pass
        health, temperature, warning = 'unknown', None, None
        if shutil.which('smartctl'):
            try:
                smart = json.loads(command(['smartctl', '-a', '-j', '/dev/'+d['name']]))
                passed = smart.get('smart_status', {}).get('passed')
                health = 'healthy' if passed is True else 'failed' if passed is False else 'unknown'
                temperature = smart.get('temperature', {}).get('current')
                nvme = smart.get('nvme_smart_health_information_log', {})
                if nvme.get('critical_warning', 0):
                    health = 'warning' if health != 'failed' else health
                    warning = 'Предупреждение NVMe'
                if nvme.get('percentage_used', 0) >= 100:
                    health = 'warning' if health != 'failed' else health
                    warning = 'Ресурс записи исчерпан'
                for attr in smart.get('ata_smart_attributes', {}).get('table', []):
                    if attr.get('id') in (5,197,198) and attr.get('raw', {}).get('value',0)>0:
                        if health != 'failed': health = 'warning'
                        warning = 'Проверьте повреждённые или переназначенные секторы'
            except (ValueError, TypeError):
                pass
        result.append({'name':d['name'], 'model':(d.get('model') or d['name']).strip(),
            'type':'NVMe' if d['name'].startswith('nvme') else 'HDD' if d.get('rota') else 'SSD',
            'total':int(d.get('size') or 0), 'used':sum(v['used'] for v in volumes),
            'mounted_total':sum(v['total'] for v in volumes), 'volumes':volumes,
            'health':health, 'temperature':temperature, 'warning':warning})
    return result


def intel_gpu_sample(card):
    """Read bounded PMU samples; SIGINT allows intel_gpu_top to finish JSON."""
    if not shutil.which('intel_gpu_top'):
        raise RuntimeError('Intel GPU: установите intel-gpu-tools для получения загрузки')
    process = subprocess.Popen(['intel_gpu_top','-J','-s','500','-d',f'drm:/dev/dri/{card.name}','-o','-'],
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        output, error = process.communicate(timeout=1.3)
    except subprocess.TimeoutExpired:
        process.send_signal(signal.SIGINT)
        try:
            output, error = process.communicate(timeout=2)
        except subprocess.TimeoutExpired:
            process.kill()
            process.communicate()
            raise RuntimeError('Intel GPU: тайм-аут чтения счётчиков')
    # A killed tool may leave an unfinished array; use complete records only.
    decoder = json.JSONDecoder()
    remaining = output.strip().lstrip('[').lstrip()
    records = []
    while remaining and not remaining.startswith(']'):
        try:
            record, end = decoder.raw_decode(remaining)
            records.append(record)
            remaining = remaining[end:].lstrip().lstrip(',').lstrip()
        except ValueError:
            break
    if not records:
        raise RuntimeError('Intel GPU: '+(error.strip()[:180] or 'счётчики недоступны'))
    engines = {name:float(value['busy']) for name,value in records[-1].get('engines',{}).items()
               if isinstance(value,dict) and isinstance(value.get('busy'),(int,float))}
    if not engines:
        raise RuntimeError('Intel GPU: драйвер не предоставил загрузку движков')
    return {'name':'Intel GPU (i915)',
            'usage':max(0,min(100,max(engines.values()))),'memory_used':None,'memory_total':None,
            'temperature':None,'engines':engines,'shared_memory':True}


def gpus():
    result = []
    if shutil.which('nvidia-smi'):
        raw = command(['nvidia-smi','--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu',
                       '--format=csv,noheader,nounits'])
        for line in raw.splitlines():
            try:
                name, usage, used, total, temp = [x.strip() for x in line.split(',')]
                result.append({'name':name,'usage':float(usage),'memory_used':float(used)*1048576,
                               'memory_total':float(total)*1048576,'temperature':float(temp)})
            except ValueError:
                continue
    for card in Path('/sys/class/drm').glob('card[0-9]*'):
        if '-' in card.name: continue
        if read(card/'device/vendor') == '0x8086':
            result.append(intel_gpu_sample(card))
            continue
        busy = read(card/'device/gpu_busy_percent')
        if busy:
            result.append({'name':read(card/'device/product_name', 'AMD GPU'), 'usage':float(busy),
                           'memory_used':int(read(card/'device/mem_info_vram_used','0')),
                           'memory_total':int(read(card/'device/mem_info_vram_total','0')),
                           'temperature':None})
    return result


class Collector:
    def __init__(self, history):
        self.history = history
        self.latest = None
        self.previous_cpu = None
        self.previous_net = None
        self.previous_time = None
        self.gpu_cache = []
        self.hardware_errors = {}
        self.disk_cache = []
        self.disk_time = 0
        self.error = None
        self.agent_id = hashlib.sha256(read('/etc/machine-id',platform.node()).encode()).hexdigest()[:24]

    def collect(self):
        now = time.time()
        fields = [int(v) for v in read('/proc/stat').splitlines()[0].split()[1:9]]
        total, idle = sum(fields), fields[3]+fields[4]
        cpu = None
        if self.previous_cpu:
            dt = total-self.previous_cpu[0]
            cpu = max(0,min(100,100*(1-(idle-self.previous_cpu[1])/dt))) if dt else 0
        self.previous_cpu = total,idle
        mem = {}
        for line in read('/proc/meminfo').splitlines():
            k,v = line.split(':',1)
            mem[k] = int(v.strip().split()[0])*1024
        memory_total = mem.get('MemTotal',1)
        memory_used = memory_total-mem.get('MemAvailable',mem.get('MemFree',0))
        interfaces = []
        for line in read('/proc/net/dev').splitlines()[2:]:
            name, data = line.split(':',1)
            name = name.strip()
            if name == 'lo': continue
            values = data.split()
            interfaces.append({'name':name,'rx_bytes':int(values[0]),'tx_bytes':int(values[8]),
                               'physical':Path('/sys/class/net', name, 'device').exists()})
        configured = [x.strip() for x in os.getenv('HOMELAB_INTERFACES','').split(',') if x.strip()]
        selected = [n for n in interfaces if n['name'] in configured] if configured else [n for n in interfaces if n['physical']]
        if not selected and not configured:
            selected = [n for n in interfaces if not n['name'].startswith(('veth','docker','br-','virbr','tap','fw'))]
        absent = set(configured)-{n['name'] for n in interfaces}
        if absent:
            self.hardware_errors['network'] = 'Не найдены интерфейсы: '+', '.join(sorted(absent))
        else:
            self.hardware_errors.pop('network',None)
        counters = {n['name']:(n['rx_bytes'],n['tx_bytes']) for n in selected}
        monotonic_now = time.monotonic()
        elapsed = monotonic_now-self.previous_time if self.previous_time is not None else 0
        rx_delta = tx_delta = 0
        if self.previous_net and elapsed:
            for name,(rx,tx) in counters.items():
                if name in self.previous_net:
                    old_rx,old_tx = self.previous_net[name]
                    rx_delta += max(0,rx-old_rx)
                    tx_delta += max(0,tx-old_tx)
        self.previous_net,self.previous_time = counters,monotonic_now
        os_name = next((line.split('=',1)[1].strip('"') for line in read('/etc/os-release').splitlines()
                        if line.startswith('PRETTY_NAME=')), platform.system())
        metrics = {'timestamp':now,'agent_id':self.agent_id,'hostname':platform.node(),
            'os':os_name,'platform':'Proxmox' if Path('/etc/pve').exists() else 'Linux',
            'cpu':{'usage':round(cpu,1) if cpu is not None else None,'cores':os.cpu_count(),
                   'model':next((l.split(':',1)[1].strip() for l in read('/proc/cpuinfo').splitlines()
                                 if l.startswith('model name')),platform.machine())},
            'memory':{'total':memory_total,'used':memory_used,'percent':round(memory_used/memory_total*100,1)},
            'uptime':float(read('/proc/uptime','0').split()[0]), 'disks':self.disk_cache,'gpus':self.gpu_cache,
            'diagnostics':dict(self.hardware_errors),
            'network':{'rx':rx_delta/elapsed if elapsed else 0,'tx':tx_delta/elapsed if elapsed else 0,
                       'interfaces':[n['name'] for n in selected]}}
        self.latest = metrics
        if cpu is not None:
            self.history.sample(self.agent_id,metrics,rx_delta,tx_delta)
        self.error = None

    def hardware_loop(self, kind, interval):
        # SMART and GPU utilities may stall. They never block CPU/network sampling.
        while True:
            try:
                values = disks() if kind == 'disks' else gpus()
                if kind == 'disks':
                    self.disk_cache = values
                else:
                    self.gpu_cache = values
                self.hardware_errors.pop(kind, None)
            except Exception as error:
                if kind == 'disks': self.disk_cache = []
                else: self.gpu_cache = []
                self.hardware_errors[kind] = str(error)
            time.sleep(interval)

    def run(self):
        while True:
            started = time.monotonic()
            try:
                self.collect()
            except Exception as e:
                self.error = str(e)
                print('Collection error:',type(e).__name__,str(e),flush=True)
            time.sleep(max(1,5-(time.monotonic()-started)))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--bind',default='0.0.0.0')
    parser.add_argument('--port',type=int,default=9108)
    parser.add_argument('--data',default='./data/agent.sqlite')
    args = parser.parse_args()
    token = os.getenv('HOMELAB_AGENT_TOKEN','')
    if not 24 <= len(token) <= 256 or not token.isascii() or any(c.isspace() for c in token):
        parser.error('HOMELAB_AGENT_TOKEN must be 24–256 ASCII characters without whitespace')
    if platform.system()!='Linux':
        parser.error('The collector requires Linux /proc and /sys')
    collector = Collector(History(args.data))
    for kind, interval in (('disks',60),('gpus',5)):
        threading.Thread(target=collector.hardware_loop,args=(kind,interval),daemon=True).start()
    threading.Thread(target=collector.run,daemon=True).start()
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if not hmac.compare_digest(self.headers.get('Authorization',''),'Bearer '+token):
                self.send_error(401); return
            parsed = urlparse(self.path)
            if collector.latest is None or time.time()-collector.latest['timestamp']>30:
                self.send_error(503,'Metrics unavailable or stale'); return
            if parsed.path == '/v1/metrics':
                value = collector.latest
            elif parsed.path == '/v1/history':
                try:
                    since = int(parse_qs(parsed.query).get('since',['0'])[0])
                except ValueError:
                    self.send_error(400); return
                value = {'records':collector.history.read(collector.agent_id,since,1000)}
            else:
                self.send_error(404); return
            body = json.dumps(value).encode()
            self.send_response(200)
            self.send_header('Content-Type','application/json')
            self.send_header('Content-Length',str(len(body)))
            self.end_headers(); self.wfile.write(body)
        def log_message(self,*args): pass
    print(f'Agent listening on {args.bind}:{args.port}',flush=True)
    ThreadingHTTPServer((args.bind,args.port),Handler).serve_forever()

if __name__=='__main__': main()
