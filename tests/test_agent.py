import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from homelab.agent import Collector, disks, intel_gpu_sample
from homelab.bundle import agent_archive, FILES
from homelab.storage import History
from deploy.install_agent import environment
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
            with patch('homelab.agent.read',side_effect=fixture),patch.dict('os.environ',{'HOMELAB_INTERFACES':'eth0'}),patch('homelab.agent.time.monotonic',side_effect=[100,105,110]):
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
            with patch('homelab.agent.read',side_effect=fixture),patch.dict('os.environ',{'HOMELAB_INTERFACES':'missing0'}):
                collector.collect()
                self.assertIn('missing0',collector.latest['diagnostics']['network'])

    def test_smart_unknown_warning_and_failure(self):
        block={'blockdevices':[{'name':'nvme0n1','type':'disk','size':1000,'model':'Test','rota':False,'mountpoints':[]}]}
        cases=[({},'unknown'),({'smart_status':{'passed':True}},'healthy'),
               ({'smart_status':{'passed':True},'nvme_smart_health_information_log':{'critical_warning':1}},'warning'),
               ({'smart_status':{'passed':False},'nvme_smart_health_information_log':{'critical_warning':1}},'failed'),
               ({'smart_status':{'passed':True},'ata_smart_attributes':{'table':[{'id':197,'raw':{'value':1}}]}},'warning')]
        for smart, expected in cases:
            with self.subTest(expected=expected),patch('homelab.agent.shutil.which',return_value='/usr/sbin/smartctl'),patch('homelab.agent.command',side_effect=lambda args:json.dumps(block if args[0]=='lsblk' else smart)):
                self.assertEqual(disks()[0]['health'],expected)

    def test_intel_gpu_uses_busiest_engine_without_invented_vram(self):
        sample=[{'engines':{'Render/3D':{'busy':17.5},'Video':{'busy':62.0}}}]
        with patch('homelab.agent.shutil.which',return_value='/usr/bin/intel_gpu_top'),patch('homelab.agent.subprocess.Popen') as spawn:
            spawn.return_value.communicate.return_value=(json.dumps(sample),'')
            gpu=intel_gpu_sample(Path('/sys/class/drm/card1'))
        self.assertEqual(gpu['usage'],62.0)
        self.assertIsNone(gpu['memory_total'])
        self.assertTrue(gpu['shared_memory'])

    def test_intel_gpu_missing_counters_are_not_zero_load(self):
        with patch('homelab.agent.shutil.which',return_value='/usr/bin/intel_gpu_top'),patch('homelab.agent.subprocess.Popen') as spawn:
            spawn.return_value.communicate.return_value=('[]','PMU unavailable')
            with self.assertRaisesRegex(RuntimeError,'PMU unavailable'):
                intel_gpu_sample(Path('/sys/class/drm/card1'))

    def test_installer_keeps_existing_credentials(self):
        token='preserve-this-existing-test-token'
        first=environment(f'HOMELAB_AGENT_TOKEN={token}\nHOMELAB_INTERFACES=eth0\n',9109,None)
        self.assertIn('HOMELAB_AGENT_TOKEN='+token,first)
        self.assertIn('HOMELAB_INTERFACES=eth0',first)
        self.assertIn('HOMELAB_AGENT_PORT=9109',first)
        self.assertIn('HOMELAB_INTERFACES=eth1',environment(first,9109,'eth1'))
        with self.assertRaises(ValueError): environment('',9108,'eth0;bad')

    def test_archive_contains_only_agent_sources(self):
        with tarfile.open(fileobj=io.BytesIO(agent_archive()),mode='r:gz') as archive:
            self.assertEqual(set(archive.getnames()),{'homelab-agent/'+name for name in FILES})
            self.assertTrue(all(not member.name.startswith('/') and '..' not in member.name for member in archive.getmembers()))

if __name__=='__main__': unittest.main()
