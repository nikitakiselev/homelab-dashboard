from contextlib import contextmanager
import argparse
import hmac
import ipaddress
import json
import math
import mimetypes
import os
import platform
import sqlite3
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from urllib.request import Request, build_opener, HTTPRedirectHandler, ProxyHandler
from ..shared.storage import History, RETENTION
from .bundle import agent_archive
from .collectors import create_collector
from ..shared.config import load_config

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args):
        raise ValueError('Agent redirects are not allowed')


def address(value):
    ip = ipaddress.ip_address(value)
    if not ip.is_private or ip.is_multicast or ip.is_unspecified or ip.is_link_local or ip.is_reserved:
        raise ValueError('Укажите частный IP-адрес сервера в вашей сети')
    return f'[{ip}]' if ip.version==6 else str(ip)


def agent_get(ip,port,token,path):
    url = f'http://{address(ip)}:{int(port)}{path}'
    request = Request(url,headers={'Authorization':'Bearer '+token})
    with build_opener(NoRedirect,ProxyHandler({})).open(request,timeout=8) as response:
        raw = response.read(2_000_001)
        if len(raw)>2_000_000: raise ValueError('Agent response too large')
        return json.loads(raw)


def validate_metrics(m):
    if not isinstance(m,dict) or not isinstance(m.get('agent_id'),str):
        raise ValueError('Неверный ответ агента')
    for key in ('cpu','memory','network'):
        if not isinstance(m.get(key),dict): raise ValueError('Неполные метрики агента')
    for key in ('gpus','disks'):
        if not isinstance(m.get(key),list): raise ValueError('Неполные метрики агента')
    interval=float(m.get('collection_interval',5))
    if not 1<=interval<=300:raise ValueError('Неверный интервал сбора')
    if abs(time.time()-float(m['timestamp']))>max(60,interval*3):
        raise ValueError('Метрики устарели или часы сервера не синхронизированы')
    return m


def demo_metrics(index):
    now = time.time()
    specs = [('pve-atlas','Proxmox','Intel Core i5-12500',12,32,[(1000,'NVMe'),(4000,'HDD')]),
             ('ubuntu-studio','Linux','AMD Ryzen 7 5700G',16,64,[(2000,'NVMe'),(2000,'SSD')]),
             ('pve-mini','Proxmox','Intel N100',4,16,[(500,'SSD')]),
             ('storage-node','Linux','Intel Core i3-8100',4,16,[(4000,'HDD'),(4000,'HDD'),(1000,'SSD')])]
    name,kind,model,cores,ram,drives = specs[index]
    cpu = round([23,42,8,14][index]+math.sin(now/35+index)*4,1)
    disks = []
    for i,(gb,typ) in enumerate(drives):
        total=gb*10**9; used=total*[.42,.68,.27][i%3]
        disks.append({'name':f'nvme{i}n1' if typ=='NVMe' else f'sd{chr(97+i)}',
            'model': 'Samsung 980 PRO' if typ=='NVMe' else 'WD Red Plus' if typ=='HDD' else 'Samsung 870 EVO',
            'serial':f'DEMO-{index}-{i}', 'firmware':'1.0', 'interface':'nvme' if typ=='NVMe' else 'sata',
            'rotation_rate':5400 if typ=='HDD' else 0,
            'power_state':'standby' if index==0 and typ=='HDD' else 'active',
            'smart_state':'sleeping' if index==0 and typ=='HDD' else 'fresh',
            'smart_updated_at':now-3600 if index==0 and typ=='HDD' else now,
            'usage_updated_at':now-3600 if index==0 and typ=='HDD' else now,
            'power_on_hours':8400+i*120, 'power_cycles':125,
            'reallocated_sectors':8 if index==3 and i==1 else 0,
            'pending_sectors':0, 'uncorrectable_sectors':0,
            'percentage_used':7 if typ=='NVMe' else None,
            'available_spare':100 if typ=='NVMe' else None, 'media_errors':0 if typ=='NVMe' else None,
            'type':typ,'total':total,'used':used,'mounted_total':total,
            'volumes':[{'mount':'/' if i==0 else '/mnt/data','total':total,'used':used}],
            'health':'warning' if index==3 and i==1 else 'healthy','temperature':32+i*3,
            'warning':'Обнаружены переназначенные секторы' if index==3 and i==1 else None})
    return {'timestamp':now,'agent_id':f'demo-{index}','hostname':name,'platform':kind,
        'os':'Proxmox VE 8.4' if kind=='Proxmox' else 'Ubuntu 24.04 LTS',
        'cpu':{'usage':cpu,'cores':cores,'model':model},
        'memory':{'total':ram*1024**3,'used':ram*1024**3*[.38,.56,.22,.64][index],
                  'percent':[38,56,22,64][index]},'uptime':86400*(index+3)+3400,
        'network':{'rx':[2.4,12.6,.2,5.8][index]*10**6*(1+.12*math.sin(now/17)),
                   'tx':[.7,3.2,.1,18.3][index]*10**6,'interfaces':['enp3s0']},
        'disks':disks,'gpus':[{'name':'NVIDIA GeForce RTX 3060','usage':37+math.sin(now/40)*8,
                   'memory_used':4.2*1024**3,'memory_total':12*1024**3,'temperature':51}] if index==1 else []}

class Dashboard:
    def __init__(self,path,demo=False,monitor_self=False,collector_config=None):
        self.history = History(path,retention_days=collector_config.retention_days if collector_config else 90)
        self.path = str(path)
        os.chmod(self.path,0o600)
        self.demo = demo
        self.local_collector = None
        self.cache = {}
        self.errors = {}
        self.verified = set()
        self.lock = threading.Lock()
        self.poll_lock = threading.Lock()
        with self.db() as db:
            db.execute('''CREATE TABLE IF NOT EXISTS hosts (id TEXT PRIMARY KEY, name TEXT,
                ip TEXT UNIQUE, port INTEGER, token TEXT, agent_id TEXT, synced INTEGER DEFAULT 0)''')
            if 'metrics' not in {row['name'] for row in db.execute('PRAGMA table_info(hosts)')}:
                db.execute('ALTER TABLE hosts ADD COLUMN metrics TEXT')
            for row in db.execute('SELECT id,metrics FROM hosts WHERE metrics IS NOT NULL'):
                try:
                    self.cache[row['id']] = json.loads(row['metrics'])
                except ValueError:
                    pass

        if monitor_self:
            if platform.system() not in ('Linux','Darwin'):
                raise ValueError('Built-in collection supports Linux and macOS')
            self.local_collector = create_collector(self.history,history_host='local',config=collector_config)
            self.local_collector.start()

    def close(self):
        if self.local_collector:
            self.local_collector.stop()

    @contextmanager
    def db(self):
        db = sqlite3.connect(self.path,timeout=15)
        db.row_factory=sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def hosts(self):
        with self.db() as db:
            return [dict(r) for r in db.execute('SELECT * FROM hosts ORDER BY rowid')]

    def poll_host(self,h):
        try:
            m = validate_metrics(agent_get(h['ip'],h['port'],h['token'],'/v1/metrics'))
            if m['agent_id']!=h['agent_id']:
                raise ValueError('Агент на этом IP изменился. Удалите и добавьте сервер заново.')
            with self.lock:
                with self.db() as db:
                    if not db.execute('UPDATE hosts SET metrics=? WHERE id=?',(json.dumps(m),h['id'])).rowcount:
                        return
                self.cache[h['id']]=m
                self.verified.add(h['id'])
                self.errors.pop(h['id'],None)
        except Exception as e:
            with self.lock: self.errors[h['id']]=str(e)
            return
        # Sync in bounded pages, overlapping the current incomplete five-minute bucket.
        # If a dashboard was disconnected, retained history is recovered from the agent.
        cursor = h['synced']
        try:
            for _ in range(4):
                result = agent_get(h['ip'],h['port'],h['token'],f'/v1/history?since={cursor}')
                rows = result['records']
                self.history.mirror(h['id'],rows)
                if not rows: break
                last = int(rows[-1]['bucket'])
                with self.db() as db:
                    db.execute('UPDATE hosts SET synced=? WHERE id=?',(last,h['id']))
                if len(rows)<1000: break
                cursor=last+1
            with self.lock: self.errors.pop(h['id']+'-history',None)
        except Exception:
            with self.lock: self.errors[h['id']+'-history']='История пока не синхронизирована'

    def poll(self):
        if not self.poll_lock.acquire(blocking=False): return
        try:
            with ThreadPoolExecutor(max_workers=8) as pool:
                list(pool.map(self.poll_host,self.hosts()))
        finally: self.poll_lock.release()

    def run(self):
        while True:
            self.poll()
            time.sleep(10)

    def public_hosts(self):
        result=[]
        with self.lock:
            for h in self.hosts():
                m=self.cache.get(h['id'])
                online=h['id'] in self.verified and m is not None and time.time()-m['timestamp']<max(35,float(m.get('collection_interval',5))*3) and h['id'] not in self.errors
                result.append({'id':h['id'],'name':h['name'],'ip':h['ip'],'port':h['port'],
                    'online':online,'metrics':m,'error':self.errors.get(h['id']),
                    'history_error':self.errors.get(h['id']+'-history'),'demo':False})
        if self.local_collector:
            m = self.local_collector.latest
            result.insert(0,{'id':'local','name':m['hostname'] if m else platform.node(),
                'ip':'127.0.0.1','port':None,'local':True,'demo':False,'metrics':m,
                'online':m is not None and time.time()-m['timestamp']<max(35,float(m.get('collection_interval',5))*3),
                'error':self.local_collector.error,'history_error':None})
        if self.demo:
            result.extend({'id':f'demo-{i}','name':demo_metrics(i)['hostname'],'ip':f'192.168.1.{10+i*10}',
                'port':9108,'online':True,'metrics':demo_metrics(i),'demo':True} for i in range(4))
        return result

    def add(self,value):
        ip=str(ipaddress.ip_address(str(value.get('ip','')).strip()))
        address(ip)
        name=str(value.get('name','')).strip()[:80]
        port=int(value.get('port',9108))
        token=str(value.get('token',''))
        if not 1<=port<=65535: raise ValueError('Некорректный порт')
        if len(token)<24 or len(token)>256: raise ValueError('Токен агента: от 24 до 256 символов')
        m=validate_metrics(agent_get(ip,port,token,'/v1/metrics'))
        if self.local_collector and m['agent_id']==self.local_collector.agent_id:
            raise ValueError('Этот хост уже подключён встроенным сборщиком')
        hid=uuid.uuid4().hex
        try:
            with self.db() as db:
                db.execute('INSERT INTO hosts (id,name,ip,port,token,agent_id,metrics) VALUES (?,?,?,?,?,?,?)',
                    (hid,name or m['hostname'],ip,port,token,m['agent_id'],json.dumps(m)))
        except sqlite3.IntegrityError:
            raise ValueError('Этот IP уже добавлен')
        with self.lock:
            self.cache[hid]=m
            self.verified.add(hid)
        threading.Thread(target=self.poll,daemon=True).start()
        return {'id':hid}

    def delete(self,hid):
        if hid=='local':
            raise ValueError('Встроенный сборщик отключается параметром --no-self-monitor')
        with self.db() as db:
            db.execute('DELETE FROM hosts WHERE id=?',(hid,))
            db.execute('DELETE FROM history WHERE host=?',(hid,))
        with self.lock:
            self.cache.pop(hid,None); self.errors.pop(hid,None)
            self.errors.pop(hid+'-history',None)
            self.verified.discard(hid)

    def chart(self,hid,days):
        if hid in {f'demo-{i}' for i in range(4)} and self.demo:
            index=int(hid.split('-')[1]); m=demo_metrics(index)
            step=300 if days==1 else 21600
            now=int(time.time())//step*step
            return [{'bucket':t,'cpu':max(1,m['cpu']['usage']+math.sin(t/3700)*9),
                'memory':m['memory']['percent'],'gpu':None,
                'rx':m['network']['rx']*(.7+.3*math.sin(t/1700)) + m['network']['rx']*.6*max(0,math.sin(t/5000))**8,
                'tx':m['network']['tx']*(.8+.2*math.cos(t/2300)),
                'rx_bytes':m['network']['rx']*step,'tx_bytes':m['network']['tx']*step}
                for t in range(now-days*86400,now+1,step)]
        rows=self.history.read(hid,time.time()-days*86400)
        if days==1: return rows
        grouped={}
        for r in rows: grouped.setdefault(r['bucket']//21600*21600,[]).append(r)
        return [dict(bucket=k,**{metric:sum(r[metric]*r['samples'] for r in group)/sum(r['samples'] for r in group)
                      for metric in ('cpu','memory','rx','tx')},
                     rx_bytes=sum(r['rx_bytes'] for r in group),tx_bytes=sum(r['tx_bytes'] for r in group))
                for k,group in sorted(grouped.items())]


def handler(dashboard,token,dist):
    class Handler(BaseHTTPRequestHandler):
        def reply(self,status,value):
            body=json.dumps(value,ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header('Content-Type','application/json; charset=utf-8')
            self.send_header('Cache-Control','no-store')
            self.send_header('Content-Length',str(len(body)))
            self.end_headers(); self.wfile.write(body)

        def authorized(self):
            return not token or hmac.compare_digest(self.headers.get('Authorization',''),'Bearer '+token)

        def do_GET(self):
            parsed=urlparse(self.path)
            if parsed.path.startswith('/api/'):
                if not self.authorized(): self.reply(401,{'error':'Введите токен доступа к дашборду'}); return
                if parsed.path=='/api/agent/bundle':
                    body=agent_archive()
                    self.send_response(200)
                    self.send_header('Content-Type','application/gzip')
                    self.send_header('Content-Disposition','attachment; filename=homelab-agent.tar.gz')
                    self.send_header('Content-Length',str(len(body)))
                    self.send_header('Cache-Control','no-store')
                    self.end_headers(); self.wfile.write(body)
                    return
                if parsed.path=='/api/hosts':
                    self.reply(200,{'hosts':dashboard.public_hosts(),'demo':dashboard.demo,'timestamp':time.time()}); return
                if parsed.path.startswith('/api/history/'):
                    hid=parsed.path.rsplit('/',1)[-1]
                    try: days=int(parse_qs(parsed.query).get('days',['1'])[0])
                    except ValueError: days=1
                    if days not in (1,90): self.reply(400,{'error':'Период: 1 или 90 дней'}); return
                    self.reply(200,{'records':dashboard.chart(hid,days)}); return
                self.reply(404,{'error':'Не найдено'}); return
            target=(dist/parsed.path.lstrip('/')).resolve()
            if not target.is_relative_to(dist.resolve()): self.send_error(403); return
            if not target.is_file(): target=dist/'index.html'
            if not target.is_file(): self.send_error(503,'Build frontend: npm run build'); return
            body=target.read_bytes()
            self.send_response(200)
            self.send_header('Content-Type',mimetypes.guess_type(target)[0] or 'application/octet-stream')
            self.send_header('Content-Length',str(len(body)))
            self.send_header('X-Content-Type-Options','nosniff')
            self.send_header('Referrer-Policy','same-origin')
            self.end_headers(); self.wfile.write(body)

        def mutate(self,method):
            if not self.authorized(): self.reply(401,{'error':'Нет доступа'}); return
            origin=self.headers.get('Origin')
            if origin and urlparse(origin).hostname!=urlparse('http://'+self.headers.get('Host','')).hostname:
                self.reply(403,{'error':'Cross-origin request rejected'}); return
            try:
                if method=='POST' and self.path=='/api/hosts':
                    size=int(self.headers.get('Content-Length','0'))
                    if size>16384 or size<2: raise ValueError('Неверный размер запроса')
                    value=json.loads(self.rfile.read(size))
                    if not isinstance(value,dict): raise ValueError('Ожидается объект JSON')
                    self.reply(201,dashboard.add(value)); return
                if method=='DELETE' and self.path.startswith('/api/hosts/'):
                    dashboard.delete(self.path.rsplit('/',1)[-1]); self.reply(200,{'ok':True}); return
                self.reply(404,{'error':'Не найдено'})
            except (ValueError,KeyError,TypeError) as e:
                self.reply(400,{'error':str(e)})
            except Exception:
                self.reply(502,{'error':'Не удалось подключиться к агенту. Проверьте IP, порт, токен и доступность сервера.'})
        def do_POST(self): self.mutate('POST')
        def do_DELETE(self): self.mutate('DELETE')
        def log_message(self,*args): pass
    return Handler


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--bind',default='127.0.0.1')
    p.add_argument('--port',default=8080,type=int)
    p.add_argument('--data',default='./data/dashboard.sqlite')
    p.add_argument('--demo',action='store_true')
    p.add_argument('--no-self-monitor',action='store_true',help='Disable the built-in local collector')
    p.add_argument('--collector-config',type=Path)
    args=p.parse_args()
    config_path=args.collector_config or (Path('/etc/homelab/collector.yaml') if Path('/etc/homelab/collector.yaml').exists() else None)
    try:collector_config=load_config(config_path)
    except ValueError as error:p.error(str(error))
    token=os.getenv('HOMELAB_DASHBOARD_TOKEN','')
    if args.bind not in ('127.0.0.1','::1','localhost') and len(token)<24:
        p.error('For LAN access, set HOMELAB_DASHBOARD_TOKEN (24+ characters)')
    dashboard=Dashboard(args.data,args.demo,monitor_self=platform.system() in ('Linux','Darwin') and not args.no_self_monitor,collector_config=collector_config)
    threading.Thread(target=dashboard.run,daemon=True).start()
    dist=Path(__file__).resolve().parents[2]/'dist'
    print(f'Dashboard: http://{args.bind}:{args.port}',flush=True)
    try:
        ThreadingHTTPServer((args.bind,args.port),handler(dashboard,token,dist)).serve_forever()
    finally:
        dashboard.close()

if __name__=='__main__': main()
