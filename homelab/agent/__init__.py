"""Standalone and embedded metric collectors."""
import platform
from .linux import Collector


def create_collector(history,history_host=None,config=None):
    if platform.system()=='Darwin':
        from .macos import MacCollector
        collector=MacCollector(history,history_host)
    elif platform.system()=='Linux':
        collector=Collector(history,history_host)
    else:
        raise ValueError('Metric collection supports Linux and macOS')
    collector.configure(config)
    return collector
