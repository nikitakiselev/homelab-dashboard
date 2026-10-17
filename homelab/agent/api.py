"""Authenticated HTTP endpoints for the standalone agent."""
import argparse
import hmac
import json
import os
import platform
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
from ..shared.storage import History
from ..shared.config import load_config
from pathlib import Path
from . import create_collector
from .. import __version__


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--version',action='version',version='homelab-agent '+__version__)
    parser.add_argument('--bind',default=None)
    parser.add_argument('--port',type=int,default=None)
    parser.add_argument('--data',default=None)
    parser.add_argument('--config',type=Path)
    parser.add_argument('--check-config',action='store_true')
    args = parser.parse_args()
    config_path=args.config or (Path('/etc/homelab/agent.yaml') if Path('/etc/homelab/agent.yaml').exists() else None)
    try:config=load_config(config_path)
    except ValueError as error:parser.error(str(error))
    if args.check_config:
        print(json.dumps(config.to_dict(),ensure_ascii=False,indent=2));return
    args.bind=args.bind or config.bind
    args.port=args.port if args.port is not None else config.port
    args.data=args.data or config.path
    token = os.getenv('HOMELAB_AGENT_TOKEN','')
    if not 24 <= len(token) <= 256 or not token.isascii() or any(c.isspace() for c in token):
        parser.error('HOMELAB_AGENT_TOKEN must be 24–256 ASCII characters without whitespace')
    if platform.system() not in ('Linux','Darwin'):
        parser.error('The collector supports Linux and macOS')
    collector = create_collector(History(args.data,retention_days=config.retention_days),config=config)
    collector.start()
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if not hmac.compare_digest(self.headers.get('Authorization',''),'Bearer '+token):
                self.send_error(401); return
            parsed = urlparse(self.path)
            if collector.latest is None or time.time()-collector.latest['timestamp']>max(30,config.interval_seconds*3):
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
