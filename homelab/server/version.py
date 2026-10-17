"""Container build identity; source checkouts explicitly report development."""
import json
from pathlib import Path
import re

DATA_SCHEMA = 1


def release_info(root=None):
    path = (Path(root) if root is not None else Path(__file__).resolve().parents[2]) / 'RELEASE.json'
    if not path.exists():
        return {'version': 'development', 'commit': None, 'data_schema': DATA_SCHEMA}
    info = json.loads(path.read_text())
    if (not isinstance(info, dict) or not re.fullmatch(r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)', str(info.get('version', '')))
            or not re.fullmatch('[0-9a-f]{40}', str(info.get('commit', '')))
            or type(info.get('data_schema')) is not int or info['data_schema'] != DATA_SCHEMA):
        raise ValueError('Invalid dashboard build identity')
    return info
