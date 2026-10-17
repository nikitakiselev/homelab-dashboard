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

    def test_hdd_polling_is_passive_even_with_cached_active_state(self):
        for transport in ('sata','ata','usb','sas',None):
            for power in ('active','standby','unknown'):
                block={'blockdevices':[{'name':'sdb','type':'disk','size':1000,'model':'Test',
                       'serial':'DISK-1','tran':transport,'rota':True,'mountpoints':['/data']}]}
                old={'name':'sda','model':'Test','serial':'DISK-1','type':'HDD','total':1000,'used':600,
                     'volumes':[{'mount':'/cached','total':1000,'used':600}],'health':'warning',
                     'temperature':32,'warning':'Preserved warning','smart_updated_at':100,'usage_updated_at':100,
                     'power_state':power,'smart_state':'fresh'}
                with self.subTest(transport=transport,power=power), \
                     patch('homelab.server.collectors.linux.command',return_value=json.dumps(block)) as run, \
                     patch('homelab.server.collectors.linux.os.stat') as stat, \
                     patch('homelab.server.collectors.linux.shutil.disk_usage') as usage:
                    previous=[old]
                    for _ in range(65):
                        previous=disks(previous)
                        d=previous[0]
                        self.assertEqual(d['smart_state'],'passive')
                        self.assertEqual(d['power_state'],'unknown')
                        for key in ('smart_updated_at','usage_updated_at','health','warning','temperature','used','volumes'):
                            self.assertEqual(d[key],old[key])
                    self.assertEqual(run.call_count,65)
                    self.assertTrue(all(call.args[0][0]=='lsblk' for call in run.call_args_list))
                    stat.assert_not_called()
                    usage.assert_not_called()

    def test_new_or_replaced_hdd_has_no_fabricated_smart_or_usage(self):
        for serial in ('NEW',None):
            block={'blockdevices':[{'name':'sda','type':'disk','size':1000,'model':'Test',
                   'serial':serial,'tran':'sata','rota':True,'mountpoints':['/data']}]}
            old={'name':'sda','model':'Test','serial':'OLD','total':1000,'used':999}
            with patch('homelab.server.collectors.linux.command',return_value=json.dumps(block)) as run, \
                 patch('homelab.server.collectors.linux.os.stat') as stat:
                disk=disks([old])[0]
                self.assertEqual(disk['smart_state'],'passive')
                self.assertEqual(disk['health'],'unknown')
                self.assertNotIn('smart_updated_at',disk)
                self.assertEqual(disk['used'],0)
                self.assertEqual(run.call_count,1)
                stat.assert_not_called()

    def test_shared_storage_skips_filesystem_probes_even_beneath_nvme(self):
        for rotational in (True,None):
            block={'blockdevices':[
                {'name':'sda','type':'disk','size':1000,'model':'HDD','rota':rotational,'tran':'sata','mountpoints':['/shared']},
                {'name':'nvme0n1','type':'disk','size':2000,'model':'SSD','rota':False,'serial':'SSD-1','mountpoints':['/shared']}]}
            old={'name':'nvme0n1','model':'SSD','serial':'SSD-1','firmware':'','type':'NVMe','total':2000,
                 'used':100,'volumes':[{'mount':'/cached','total':2000,'used':100}],'usage_updated_at':100}
            def run(args):
                if args[0]=='lsblk': return json.dumps(block)
                self.assertEqual(args,['smartctl','-a','-j','-d','nvme','/dev/nvme0n1'])
                return json.dumps({'smart_status':{'passed':True}})
            with patch('homelab.server.collectors.linux.command',side_effect=run), \
                 patch('homelab.server.collectors.linux.shutil.which',return_value='smartctl'), \
                 patch('homelab.server.collectors.linux.os.stat') as stat, \
                 patch('homelab.server.collectors.linux.shutil.disk_usage') as usage:
                found=disks([old])
                self.assertEqual(found[1]['used'],100)
                self.assertEqual(found[1]['usage_updated_at'],100)
                self.assertEqual(found[1]['volumes'],old['volumes'])
                stat.assert_not_called()
                usage.assert_not_called()

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
