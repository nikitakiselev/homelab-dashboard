"""Authenticated container health check; does not collect hardware."""
import json
import os
from urllib.request import Request, urlopen
from .version import release_info


def main():
    token = os.environ.get('HOMELAB_DASHBOARD_TOKEN', '')
    request = Request('http://127.0.0.1:8080/api/version', headers={'Authorization': 'Bearer ' + token})
    with urlopen(request, timeout=3) as response:
        running = json.load(response)
    if running != release_info():
        raise RuntimeError('Running dashboard build does not match image')


if __name__ == '__main__':
    main()
