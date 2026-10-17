"""Native macOS collector: Mach CPU counters and read-only system utilities."""
import ctypes
import hashlib
import os
import platform
import plistlib
import re
import subprocess
import time
from .runtime import SamplingRuntime


def command(args):
    result=subprocess.run(args,capture_output=True,timeout=10,check=True)
    return result.stdout


def sysctl(name):
    return command(['sysctl','-n',name]).decode().strip()


def plist(args):
    return plistlib.loads(command(args))


def cpu_ticks():
    # HOST_CPU_LOAD_INFO and CPU_STATE_IDLE from the macOS Mach SDK headers.
    library=ctypes.CDLL('/usr/lib/libSystem.B.dylib')
    library.mach_host_self.restype=ctypes.c_uint32
    library.host_statistics.argtypes=[ctypes.c_uint32,ctypes.c_int,ctypes.POINTER(ctypes.c_int),ctypes.POINTER(ctypes.c_uint32)]
    library.host_statistics.restype=ctypes.c_int
    ticks=(ctypes.c_uint32*4)()
    count=ctypes.c_uint32(4)
    status=library.host_statistics(library.mach_host_self(),3,ctypes.cast(ticks,ctypes.POINTER(ctypes.c_int)),ctypes.byref(count))
    if status!=0:
        raise OSError(f'Mach CPU counters unavailable: {status}')
    return tuple(ticks)


def memory_stats(total):
    raw=command(['vm_stat']).decode()
    match=re.search(r'page size of (\d+) bytes',raw)
    if not match:
        raise ValueError('vm_stat: unknown page size')
    page_size=int(match[1])
    pages={key.strip().strip('"'):int(value) for key,value in re.findall(r'^(.+?):\s+(\d+)\.',raw,re.M)}
    used=min(total,sum(pages.get(key,0) for key in ('Pages active','Pages wired down','Pages occupied by compressor'))*page_size)
    return {'total':total,'used':used,'percent':round(used/total*100,1)}


def network_counters(raw):
    result={}
    for line in raw.splitlines():
        fields=line.split()
        if len(fields)<10 or not fields[2].startswith('<Link#'):
            continue
        name=fields[0].rstrip('*')
        counts=fields[-7:]
        try:
            result[name]=(int(counts[2]),int(counts[5]))
        except ValueError:
            continue
    return result


def disk_stats():
    physical=plist(['diskutil','list','-plist','physical']).get('WholeDisks',[])
    containers=plist(['diskutil','apfs','list','-plist']).get('Containers',[])
    result=[]
    for name in physical:
        info=plist(['diskutil','info','-plist',name])
        health={'Verified':'healthy','Failing':'failed'}.get(info.get('SMARTStatus'),'unknown')
        volumes=[]
        for container in containers:
            stores=container.get('PhysicalStores',[])
            # Attribute APFS usage to a drive only when the pool has one store.
            if len(stores)!=1:
                continue
            store=stores[0].get('DeviceIdentifier','')
            if re.fullmatch(re.escape(name)+r's\d+',store):
                total=int(container.get('CapacityCeiling',0))
                free=int(container.get('CapacityFree',0))
                volumes.append({'mount':'APFS '+container.get('ContainerReference',''), 'total':total,'used':max(0,total-free)})
        smart=info.get('SMARTDeviceSpecificKeysMayVaryNotGuaranteed',{})
        temperature=smart.get('TEMPERATURE')
        if isinstance(temperature,(int,float)) and temperature>200:
            temperature=round(temperature-273.15)
        result.append({'name':name,'model':info.get('MediaName',name),
            'type':'SSD' if info.get('SolidState') else 'HDD','total':int(info.get('TotalSize',0)),
            'used':sum(v['used'] for v in volumes),'mounted_total':sum(v['total'] for v in volumes),
            'volumes':volumes,'health':health,'temperature':temperature,'warning':None})
    return result


def gpu_stats():
    cards=plist(['ioreg','-a','-r','-c','IOAccelerator','-d','1'])
    result=[]
    for card in cards:
        stats=card.get('PerformanceStatistics',{})
        model=card.get('model','Apple GPU')
        if isinstance(model,bytes): model=model.rstrip(b'\0').decode(errors='replace')
        usage=stats.get('Device Utilization %')
        result.append({'name':model,'usage':usage if isinstance(usage,(int,float)) else None,
            'memory_used':None,'memory_total':None,'shared_memory':True,'temperature':None})
    return result


class MacCollector(SamplingRuntime):
    def __init__(self,history,history_host=None):
        super().__init__(history,history_host)
        self.cpu_model=sysctl('machdep.cpu.brand_string')
        self.total_memory=int(sysctl('hw.memsize'))
        self.cores=int(sysctl('hw.logicalcpu'))
        self.boot_time=int(re.search(r'sec\s*=\s*(\d+)',sysctl('kern.boottime'))[1])
        self.agent_id=hashlib.sha256((platform.node()+self.cpu_model).encode()).hexdigest()[:24]

    def read_disks(self):
        return disk_stats()

    def read_gpus(self):
        return gpu_stats()

    def collect(self):
        now=time.time()
        ticks=cpu_ticks()
        usage=None
        if self.previous_cpu is not None:
            delta=[(new-old)&0xffffffff for new,old in zip(ticks,self.previous_cpu)]
            usage=round(max(0,min(100,100*(1-delta[2]/sum(delta)))),1) if sum(delta) else 0
        self.previous_cpu=ticks
        counters=network_counters(command(['netstat','-ibn']).decode())
        configured=[name.strip() for name in os.getenv('HOMELAB_INTERFACES','').split(',') if name.strip()]
        selected=configured or [name for name in counters if re.fullmatch(r'en\d+',name)]
        missing=set(selected)-counters.keys()
        if missing: self.hardware_errors['network']='Не найдены интерфейсы: '+', '.join(sorted(missing))
        else: self.hardware_errors.pop('network',None)
        counters={name:counters[name] for name in selected if name in counters}
        monotonic_now=time.monotonic()
        elapsed=monotonic_now-self.previous_time if self.previous_time is not None else 0
        rx=tx=0
        if self.previous_net and elapsed:
            for name,(received,sent) in counters.items():
                if name in self.previous_net:
                    rx+=max(0,received-self.previous_net[name][0])
                    tx+=max(0,sent-self.previous_net[name][1])
        self.previous_net,self.previous_time=counters,monotonic_now
        metrics={'timestamp':now,'agent_id':self.agent_id,'hostname':platform.node(),
            'os':'macOS '+platform.mac_ver()[0],'platform':'macOS',
            'cpu':{'usage':usage,'cores':self.cores,'model':self.cpu_model},
            'memory':memory_stats(self.total_memory),'uptime':max(0,now-self.boot_time),
            'disks':self.disk_cache,'gpus':self.gpu_cache,'diagnostics':dict(self.hardware_errors),
            'network':{'rx':rx/elapsed if elapsed else 0,'tx':tx/elapsed if elapsed else 0,'interfaces':list(counters)}}
        self.latest=metrics
        if usage is not None:
            self.history.sample(self.history_host or self.agent_id,metrics,rx,tx)
        self.error=None
