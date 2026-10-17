import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from homelab.agent.macos import MacCollector, disk_stats, memory_stats, network_counters, gpu_stats
from homelab.shared.storage import History


class MacCollectorTests(unittest.TestCase):
    def test_link_counters_do_not_double_count_ip_address_rows(self):
        raw='''Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll
 en0 1500 <Link#1> aa:bb:cc:dd:ee:ff 12 0 1000 9 0 2000 0
 en0 1500 192.168.1 192.168.1.2 12 - 1000 9 - 2000 -
 utun0 1500 <Link#2> 1 0 300 2 0 400 0
'''
        self.assertEqual(network_counters(raw),{'en0':(1000,2000),'utun0':(300,400)})

    def test_memory_uses_reported_page_size(self):
        raw=b'Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages active: 2.\nPages wired down: 3.\nPages occupied by compressor: 1.\n'
        with patch('homelab.agent.macos.command',return_value=raw):
            memory=memory_stats(16384*10)
        self.assertEqual(memory['used'],16384*6)
        self.assertEqual(memory['percent'],60)

    def test_apfs_container_is_counted_once(self):
        def data(args):
            if args[1]=='list':return {'WholeDisks':['disk0']}
            if args[1]=='apfs':return {'Containers':[{'ContainerReference':'disk3','CapacityCeiling':1000,'CapacityFree':400,'PhysicalStores':[{'DeviceIdentifier':'disk0s2'}],'Volumes':[{'Name':'System'},{'Name':'Data'}]}]}
            return {'MediaName':'Test SSD','SolidState':True,'TotalSize':1100,'SMARTStatus':'Verified'}
        with patch('homelab.agent.macos.plist',side_effect=data):
            disk=disk_stats()[0]
        self.assertEqual(disk['used'],600)
        self.assertEqual(len(disk['volumes']),1)
        self.assertEqual(disk['health'],'healthy')

    def test_missing_gpu_counter_is_unknown(self):
        with patch('homelab.agent.macos.plist',return_value=[{'model':'Apple GPU'}]):
            self.assertIsNone(gpu_stats()[0]['usage'])

    def test_cpu_and_network_samples_are_persisted(self):
        values={'machdep.cpu.brand_string':'Apple test','hw.memsize':'1024','hw.logicalcpu':'4','kern.boottime':'{ sec = 100, usec = 0 }'}
        with tempfile.TemporaryDirectory() as temp,patch('homelab.agent.macos.sysctl',side_effect=lambda key:values[key]):
            collector=MacCollector(History(Path(temp)/'mac.sqlite'),history_host='local')
            with patch('homelab.agent.macos.cpu_ticks',side_effect=[(10,10,80,0),(30,20,150,0)]),patch('homelab.agent.macos.memory_stats',return_value={'total':1024,'used':512,'percent':50}),patch('homelab.agent.macos.command',side_effect=[b'en0 1500 <Link#1> aa 0 0 1000 0 0 2000 0',b'en0 1500 <Link#1> aa 0 0 1500 0 0 3000 0']),patch('homelab.agent.macos.time.monotonic',side_effect=[100,105]),patch.dict('os.environ',{'HOMELAB_INTERFACES':'en0'}):
                collector.collect()
                self.assertIsNone(collector.latest['cpu']['usage'])
                collector.collect()
            self.assertEqual(collector.latest['cpu']['usage'],30)
            self.assertEqual(collector.latest['network']['rx'],100)
            self.assertEqual(collector.history.read('local',0)[0]['rx_bytes'],500)
