"""Standalone and embedded metric collectors."""
import platform
from .linux import Collector


def create_collector(history,history_host=None):
    if platform.system()=='Darwin':
        from .macos import MacCollector
        return MacCollector(history,history_host)
    if platform.system()=='Linux':
        return Collector(history,history_host)
    raise ValueError('Metric collection supports Linux and macOS')
