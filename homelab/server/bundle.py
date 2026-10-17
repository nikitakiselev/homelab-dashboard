"""Build a self-contained agent archive without host data or secrets."""
import io
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FILES = ('deploy/install_agent.sh','deploy/AGENT.md','deploy/agent.example.yaml')


def agent_archive():
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode='w:gz') as archive:
        for name in FILES:
            data = (ROOT/name).read_bytes()
            info = tarfile.TarInfo('homelab-agent/'+name)
            info.size = len(data)
            info.mode = 0o644
            archive.addfile(info, io.BytesIO(data))
    return output.getvalue()
