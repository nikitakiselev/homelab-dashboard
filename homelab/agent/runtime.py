"""Shared lifecycle for platform-specific metric collectors."""
import threading
import time


class SamplingRuntime:
    def __init__(self,history,history_host=None):
        self.history = history
        self.history_host = history_host
        self.stop_event = threading.Event()
        self.threads = []
        self.latest = None
        self.previous_cpu = None
        self.previous_net = None
        self.previous_time = None
        self.gpu_cache = []
        self.hardware_errors = {}
        self.disk_cache = []
        self.disk_time = 0
        self.error = None
        self.interval_seconds = 5
        self.disks_interval_seconds = 60
        self.gpu_interval_seconds = 5
        self.disks_enabled = True
        self.gpu_enabled = True
        self.interfaces = ()

    def configure(self,config):
        if config is None:return
        for name in ('interval_seconds','disks_interval_seconds','gpu_interval_seconds','disks_enabled','gpu_enabled','interfaces'):
            setattr(self,name,getattr(config,name))

    def hardware_loop(self, kind, interval):
        # SMART and GPU utilities may stall. They never block CPU/network sampling.
        while not self.stop_event.is_set():
            try:
                values = self.read_disks() if kind == 'disks' else self.read_gpus()
                if kind == 'disks':
                    self.disk_cache = values
                else:
                    self.gpu_cache = values
                self.hardware_errors.pop(kind, None)
            except Exception as error:
                if kind == 'disks': self.disk_cache = []
                else: self.gpu_cache = []
                self.hardware_errors[kind] = str(error)
            self.stop_event.wait(interval)

    def start(self):
        if self.threads:
            return
        for kind, interval, enabled in (("disks",self.disks_interval_seconds,self.disks_enabled),("gpus",self.gpu_interval_seconds,self.gpu_enabled)):
            if not enabled:continue
            self.threads.append(threading.Thread(target=self.hardware_loop,args=(kind,interval),daemon=True))
        self.threads.append(threading.Thread(target=self.run,daemon=True))
        for thread in self.threads:
            thread.start()

    def stop(self):
        self.stop_event.set()
        for thread in self.threads:
            thread.join(timeout=1)

    def run(self):
        while not self.stop_event.is_set():
            started = time.monotonic()
            try:
                self.collect()
            except Exception as e:
                self.error = str(e)
                print('Collection error:',type(e).__name__,str(e),flush=True)
            self.stop_event.wait(max(.1,self.interval_seconds-(time.monotonic()-started)))

