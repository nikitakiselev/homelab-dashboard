import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from homelab.server.collectors.linux import Collector, disks, intel_gpu_sample
from homelab.server.bundle import agent_archive, FILES
from homelab.shared.storage import History
import tarfile


class CollectorTests(unittest.TestCase):
    def test_linux_cpu_memory_and_network_counter_reset(self):
        with tempfile.TemporaryDirectory() as temp:
            history=History(Path(temp)/'agent.sqlite')
            cpu=[100,0,100,800,0,0,0,0]
            network=[1000,2000]
            def fixture(path,default=''):
                return {
                    '/etc/machine-id':'test-machine',
                    '/proc/stat':'cpu '+' '.join(map(str,cpu)),
                    '/proc/meminfo':'MemTotal: 1000 kB\nMemAvailable: 400 kB',
                    '/proc/net/dev':'header\nheader\n eth0: '+str(network[0])+' 0 0 0 0 0 0 0 '+str(network[1])+' 0 0 0 0 0 0 0',
                    '/proc/uptime':'12345 23456',
                    '/proc/cpuinfo':'model name: Test CPU',
                    '/etc/os-release':'PRETTY_NAME="Ubuntu fixture"',
                }.get(str(path),default)
            with patch('homelab.server.collectors.linux.read',side_effect=fixture),patch.dict('os.environ',{'HOMELAB_INTERFACES':'eth0'}),patch('homelab.server.collectors.linux.time.monotonic',side_effect=[100,105,110]):
                collector=Collector(history)
                collector.collect()
                self.assertIsNone(collector.latest['cpu']['usage'])
                self.assertEqual(collector.latest['memory']['percent'],60)
                cpu[:]=[150,0,100,850,0,0,0,0]
                network[:]=[1500,3000]
                collector.collect()
                self.assertEqual(collector.latest['cpu']['usage'],50)
                self.assertEqual(collector.latest['network']['rx'],100)
                self.assertEqual(collector.latest['network']['tx'],200)
                network[:]=[10,20]
                collector.collect()
                self.assertEqual(collector.latest['network']['rx'],0)
                self.assertEqual(history.read(collector.agent_id,0)[0]['rx_bytes'],500)

    def test_missing_interface_is_diagnostic(self):
        with tempfile.TemporaryDirectory() as temp:
            collector=Collector(History(Path(temp)/'agent.sqlite'))
            def fixture(path,default=''):
                return {'/proc/stat':'cpu 1 0 0 9 0 0 0 0','/proc/meminfo':'MemTotal: 1 kB\nMemAvailable: 1 kB','/proc/net/dev':'a\nb','/proc/uptime':'1 1'}.get(str(path),default)
            with patch('homelab.server.collectors.linux.read',side_effect=fixture),patch.dict('os.environ',{'HOMELAB_INTERFACES':'missing0'}):
                collector.collect()
                self.assertIn('missing0',collector.latest['diagnostics']['network'])

    def test_smart_unknown_warning_and_failure(self):
        block={'blockdevices':[{'name':'nvme0n1','type':'disk','size':1000,'model':'Test','rota':False,'mountpoints':[]}]}
        cases=[({},'unknown'),({'smart_status':{'passed':True}},'healthy'),
               ({'smart_status':{'passed':True},'nvme_smart_health_information_log':{'critical_warning':1}},'warning'),
               ({'smart_status':{'passed':False},'nvme_smart_health_information_log':{'critical_warning':1}},'failed'),
               ({'smart_status':{'passed':True},'ata_smart_attributes':{'table':[{'id':197,'raw':{'value':1}}]}},'warning')]
        for smart, expected in cases:
            with self.subTest(expected=expected),patch('homelab.server.collectors.linux.shutil.which',return_value='/usr/sbin/smartctl'),patch('homelab.server.collectors.linux.command',side_effect=lambda args:json.dumps(block if args[0]=='lsblk' else smart)):
                self.assertEqual(disks()[0]['health'],expected)

    def test_sleep_retains_sample_without_touching_filesystem_and_wakes_naturally(self):
        block = {'blockdevices':[{'name':'sdb','type':'disk','size':1000,'model':'Test',
                  'serial':'DISK-1','tran':'sata','rota':True,'mountpoints':['/data']}]}
        smart = {'smart_status':{'passed':True}, 'temperature':{'current':32},
                 'power_on_time':{'hours':1500}, 'power_cycle_count':12,
                 'ata_smart_attributes':{'table':[{'id':197,'raw':{'value':2}}]}}
        def run(args):
            if args[0] == 'lsblk': return json.dumps(block)
            self.assertEqual(args, ['smartctl','-a','-j','-d','ata','-n','standby,75,76','/dev/sdb'])
            return json.dumps(smart)
        with patch('homelab.server.collectors.linux.command',side_effect=run), patch('homelab.server.collectors.linux.shutil.which',return_value='smartctl'), patch('homelab.server.collectors.linux.os.stat') as stat, patch('homelab.server.collectors.linux.shutil.disk_usage') as usage:
            stat.return_value.st_dev = 42
            usage.return_value.total, usage.return_value.used = 1000, 600
            active = disks()
            self.assertEqual(active[0]['pending_sectors'], 2)
            self.assertEqual(active[0]['power_on_hours'], 1500)
            self.assertEqual(active[0]['smart_state'], 'fresh')
            for mode in ('STANDBY', 'SLEEP'):
                smart = {'smartctl':{'exit_status':75}, 'power_mode':{'name':mode}}
                stat.reset_mock(); usage.reset_mock()
                asleep = disks(active)
                stat.assert_not_called(); usage.assert_not_called()
                self.assertEqual(asleep[0]['smart_state'], 'sleeping')
                self.assertEqual(asleep[0]['power_state'], mode.lower())
                for key in ('smart_updated_at','usage_updated_at','health','warning','temperature','used','volumes'):
                    self.assertEqual(asleep[0][key], active[0][key])
                self.assertEqual(active[0]['smart_state'], 'fresh')
            smart = {'smart_status':{'passed':True},'temperature':{'current':35}}
            awake = disks(asleep)[0]
            self.assertEqual(awake['power_state'], 'active')
            self.assertEqual(awake['temperature'], 35)
            self.assertEqual(awake['health'], 'healthy')
            self.assertIsNone(awake['warning'])
            usage.assert_called_once_with('/data')

    def test_sleep_on_first_poll_and_errors_do_not_probe_hdd_filesystems(self):
        block = {'blockdevices':[{'name':'sda','type':'disk','size':1000,'model':'Test',
                  'serial':'NEW','tran':'sata','rota':True,'mountpoints':['/data']}]}
        old = {'name':'sda','model':'Test','serial':'OLD','total':1000,'used':999}
        for smart, expected in [({'smartctl':{'exit_status':75}},'sleeping'),
                                ({'smartctl':{'exit_status':76}},'unsupported'),
                                ({'smartctl':{'exit_status':2}},'unavailable'),
                                ({},'unavailable')]:
            with self.subTest(expected=expected), patch('homelab.server.collectors.linux.command',side_effect=lambda args:json.dumps(block if args[0]=='lsblk' else smart)), patch('homelab.server.collectors.linux.shutil.which',return_value='smartctl'), patch('homelab.server.collectors.linux.os.stat') as stat, patch('homelab.server.collectors.linux.shutil.disk_usage') as usage:
                disk = disks([old])[0]
                self.assertEqual(disk['smart_state'], expected)
                self.assertEqual(disk['health'], 'unknown')
                self.assertEqual(disk['used'], 0)
                self.assertNotIn('smart_updated_at', disk)
                stat.assert_not_called(); usage.assert_not_called()

    def test_unsafe_transports_skip_smart_and_hdd_filesystems(self):
        for transport in ('usb', 'sas', None):
            block = {'blockdevices':[{'name':'sda','type':'disk','size':1000,'model':'Test',
                      'tran':transport,'rota':True,'mountpoints':['/data']}]}
            with self.subTest(transport=transport), patch('homelab.server.collectors.linux.command',return_value=json.dumps(block)) as run, patch('homelab.server.collectors.linux.os.stat') as stat:
                disk = disks()[0]
                self.assertEqual(disk['smart_state'], 'skipped')
                self.assertEqual(run.call_count, 1)
                stat.assert_not_called()

    def test_nvme_details_and_zero_values(self):
        block = {'blockdevices':[{'name':'nvme0n1','type':'disk','size':1000,'rota':False}]}
        smart = {'smart_status':{'passed':True}, 'serial_number':'NVME-1', 'firmware_version':'1.2',
                 'power_on_time':{'hours':0}, 'power_cycle_count':0,
                 'nvme_smart_health_information_log':{'percentage_used':0,'available_spare':100,'media_errors':0}}
        with patch('homelab.server.collectors.linux.command',side_effect=lambda args:json.dumps(block if args[0]=='lsblk' else smart)), patch('homelab.server.collectors.linux.shutil.which',return_value='smartctl'):
            disk = disks()[0]
        self.assertEqual(disk['serial'], 'NVME-1')
        self.assertEqual(disk['firmware'], '1.2')
        for field in ('power_on_hours','power_cycles','percentage_used','media_errors'):
            self.assertEqual(disk[field], 0)
        self.assertIsNone(disk['pending_sectors'])

    def test_intel_gpu_uses_busiest_engine_without_invented_vram(self):
        sample=[{'engines':{'Render/3D':{'busy':17.5},'Video':{'busy':62.0}}}]
        with patch('homelab.server.collectors.linux.shutil.which',return_value='/usr/bin/intel_gpu_top'),patch('homelab.server.collectors.linux.subprocess.Popen') as spawn:
            spawn.return_value.communicate.return_value=(json.dumps(sample),'')
            gpu=intel_gpu_sample(Path('/sys/class/drm/card1'))
        self.assertEqual(gpu['usage'],62.0)
        self.assertIsNone(gpu['memory_total'])
        self.assertTrue(gpu['shared_memory'])

    def test_intel_gpu_missing_counters_are_not_zero_load(self):
        with patch('homelab.server.collectors.linux.shutil.which',return_value='/usr/bin/intel_gpu_top'),patch('homelab.server.collectors.linux.subprocess.Popen') as spawn:
            spawn.return_value.communicate.return_value=('[]','PMU unavailable')
            with self.assertRaisesRegex(RuntimeError,'PMU unavailable'):
                intel_gpu_sample(Path('/sys/class/drm/card1'))

    def test_archive_contains_only_agent_sources(self):
        with tarfile.open(fileobj=io.BytesIO(agent_archive()),mode='r:gz') as archive:
            self.assertEqual(set(archive.getnames()),{'homelab-agent/'+name for name in FILES})
            self.assertTrue(all(not member.name.startswith('/') and '..' not in member.name for member in archive.getmembers()))

if __name__=='__main__': unittest.main()
