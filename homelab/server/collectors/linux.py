"""Linux agent. Optional smartmontools and nvidia-smi enrich hardware data."""
import hashlib
import json
import os
import platform
import shutil
import signal
import subprocess
import time
from pathlib import Path
from .runtime import SamplingRuntime
from .diskstats import parse_diskstats, disk_deltas
from ... import __version__


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


def disk_smart_args(name, transport):
    # Standby checks can still disturb awake HDDs. Never send ATA/power commands.
    if name.startswith('nvme'):
        return ['smartctl', '-a', '-j', '-d', 'nvme', '/dev/'+name]
    return None


def apply_smart(disk, smart):
    status = smart.get('smartctl', {}).get('exit_status', 0)
    if status == 75:
        disk['power_state'] = 'sleep' if smart.get('power_mode', {}).get('name', '').upper() == 'SLEEP' else 'standby'
        disk['smart_state'] = 'sleeping'
        return
    if status == 76:
        disk['smart_state'] = 'unsupported'
        return
    if status & 3:
        return
    nvme = smart.get('nvme_smart_health_information_log', {})
    attributes = smart.get('ata_smart_attributes', {}).get('table', [])
    passed = smart.get('smart_status', {}).get('passed')
    temperature = smart.get('temperature', {}).get('current')
    hours = smart.get('power_on_time', {}).get('hours')
    if passed is None and temperature is None and hours is None and not attributes and not nvme:
        return
    disk.update(power_state='active', smart_state='fresh', smart_updated_at=time.time(),
                health='healthy' if passed is True else 'failed' if passed is False else 'unknown',
                temperature=temperature, warning=None, rotation_rate=smart.get('rotation_rate'),
                power_on_hours=hours, power_cycles=smart.get('power_cycle_count'),
                percentage_used=nvme.get('percentage_used'), available_spare=nvme.get('available_spare'),
                media_errors=nvme.get('media_errors'), reallocated_sectors=None,
                pending_sectors=None, uncorrectable_sectors=None)
    disk['serial'] = smart.get('serial_number') or disk['serial']
    disk['firmware'] = smart.get('firmware_version') or disk['firmware']
    def warn(message):
        if disk['health'] != 'failed': disk['health'] = 'warning'
        disk['warning'] = message
    if nvme.get('critical_warning', 0): warn('Предупреждение NVMe')
    if nvme.get('percentage_used', 0) >= 100: warn('Ресурс записи исчерпан')
    for attr in attributes:
        key = {5:'reallocated_sectors', 197:'pending_sectors', 198:'uncorrectable_sectors'}.get(attr.get('id'))
        if key:
            value = attr.get('raw', {}).get('value')
            disk[key] = value
            if value is not None and value > 0:
                warn('Проверьте повреждённые или переназначенные секторы')


def disks(previous=None):
    raw = command(['lsblk', '-J', '-b', '-o', 'NAME,TYPE,SIZE,MODEL,SERIAL,REV,ROTA,TRAN,MOUNTPOINTS'])
    try:
        devices = json.loads(raw)['blockdevices']
    except (ValueError, KeyError):
        return []
    # A filesystem discovered beneath an SSD may share an HDD-backed pool.
    passive_filesystems = any(d['type'] == 'disk' and not d['name'].startswith(('nvme','loop','ram','zram'))
                              and d.get('rota') not in (False,0,'0') for d in devices)
    result = []
    seen_fs = set()
    for d in devices:
        if d['type'] != 'disk' or d['name'].startswith(('loop', 'ram', 'zram')):
            continue
        disk = {'name':d['name'], 'model':(d.get('model') or d['name']).strip(),
                'serial':(d.get('serial') or '').strip(), 'firmware':(d.get('rev') or '').strip(),
                'interface':d.get('tran') or '',
                'type':'NVMe' if d['name'].startswith('nvme') else 'SSD' if d.get('rota') in (False, 0, '0') else 'HDD',
                'total':int(d.get('size') or 0), 'used':0, 'mounted_total':0, 'volumes':[],
                'health':'unknown', 'temperature':None, 'warning':None}
        for old in previous or []:
            if disk['serial'] and old.get('serial') == disk['serial'] and old['model'] == disk['model'] and old['total'] == disk['total']:
                disk = {**old, 'name':d['name'], 'interface':disk['interface']}
                break
        disk.update(power_state='unknown', smart_state='unavailable')
        args = disk_smart_args(disk['name'], disk['interface'])
        if args is None:
            disk['smart_state'] = 'passive'
        elif shutil.which('smartctl'):
            try:
                apply_smart(disk, json.loads(command(args)))
            except (ValueError, TypeError, AttributeError):
                pass
        # A cached awake state does not permit filesystem probes on an HDD.
        if disk['type'] == 'HDD' or passive_filesystems:
            result.append(disk)
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
                usage = shutil.disk_usage(mount)
                seen_fs.add(fs_id)
                volumes.append({'mount':mount, 'total':usage.total, 'used':usage.used})
            except OSError:
                pass
        disk.update(volumes=volumes, used=sum(v['used'] for v in volumes),
                    mounted_total=sum(v['total'] for v in volumes), usage_updated_at=time.time())
        result.append(disk)
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


class Collector(SamplingRuntime):
    def __init__(self, history, history_host=None):
        super().__init__(history,history_host)
        self.previous_disk = {}
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
        configured = [x.strip() for x in os.getenv('HOMELAB_INTERFACES',','.join(self.interfaces)).split(',') if x.strip()]
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
        disk_io = {}
        if self.disks_enabled:
            raw = read('/proc/diskstats')
            current = parse_diskstats(raw, lambda name: not name.startswith(('loop','ram','zram')) and Path('/sys/block',name).exists())
            disk_io = disk_deltas(current,self.previous_disk,elapsed)
            self.previous_disk = current
            if not raw:
                self.hardware_errors['disk_io'] = 'Не удалось прочитать /proc/diskstats'
            else:
                self.hardware_errors.pop('disk_io',None)
        self.previous_net,self.previous_time = counters,monotonic_now
        os_name = next((line.split('=',1)[1].strip('"') for line in read('/etc/os-release').splitlines()
                        if line.startswith('PRETTY_NAME=')), platform.system())
        metrics = {'disk_io':disk_io,'timestamp':now,'collection_interval':self.interval_seconds,'agent_id':self.agent_id,'agent_version':__version__,'hostname':platform.node(),
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
            self.history.sample(self.history_host or self.agent_id,metrics,rx_delta,tx_delta)
        self.error = None

    def read_disks(self):
        return disks(self.disk_cache)

    def read_gpus(self):
        return gpus()
