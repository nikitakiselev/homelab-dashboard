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
from . import create_collector


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--bind',default='0.0.0.0')
    parser.add_argument('--port',type=int,default=9108)
    parser.add_argument('--data',default='./data/agent.sqlite')
    args = parser.parse_args()
    token = os.getenv('HOMELAB_AGENT_TOKEN','')
    if not 24 <= len(token) <= 256 or not token.isascii() or any(c.isspace() for c in token):
        parser.error('HOMELAB_AGENT_TOKEN must be 24–256 ASCII characters without whitespace')
    if platform.system() not in ('Linux','Darwin'):
        parser.error('The collector supports Linux and macOS')
    collector = create_collector(History(args.data))
    collector.start()
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
