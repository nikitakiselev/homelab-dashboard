"""Validated agent settings. YAML is loaded only when a config file is used."""
from dataclasses import asdict, dataclass
import math
from pathlib import Path


@dataclass(frozen=True)
class AgentConfig:
    bind: str = '0.0.0.0'
    port: int = 9108
    interval_seconds: float = 5
    disks_enabled: bool = True
    disks_interval_seconds: float = 60
    gpu_enabled: bool = True
    gpu_interval_seconds: float = 5
    interfaces: tuple = ()
    retention_days: int = 90
    path: str = './data/agent.sqlite'

    def to_dict(self):
        return asdict(self)


def mapping(value,allowed,name):
    if not isinstance(value,dict):
        raise ValueError(f'{name}: expected a mapping')
    unknown=set(value)-set(allowed)
    if unknown:
        raise ValueError(f'{name}: unknown keys: '+', '.join(map(str,unknown)))
    return value


def number(value,name,minimum,maximum,integer=False):
    if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or not minimum<=value<=maximum or (integer and not isinstance(value,int)):
        raise ValueError(f'{name}: expected {"integer" if integer else "number"} between {minimum} and {maximum}')
    return value


def enabled(value,name):
    if not isinstance(value,bool):
        raise ValueError(f'{name}: expected true or false')
    return value


def load_config(path=None):
    if path is None:
        return AgentConfig()
    try:
        import yaml
    except ImportError:
        raise ValueError('YAML config requires PyYAML: install requirements.txt') from None
    class UniqueLoader(yaml.SafeLoader):
        pass
    def unique_mapping(loader,node,deep=False):
        result={}
        for key_node,value_node in node.value:
            key=loader.construct_object(key_node,deep=deep)
            if not isinstance(key,str):
                raise ValueError('Configuration keys must be strings')
            if key in result:
                raise ValueError('Duplicate YAML key: '+key)
            result[key]=loader.construct_object(value_node,deep=deep)
        return result
    UniqueLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG,unique_mapping)
    try:
        file=Path(path)
        if file.stat().st_size>65536: raise ValueError('Config must be smaller than 64 KiB')
        value=yaml.load(file.read_text(),Loader=UniqueLoader)
    except (OSError,yaml.YAMLError) as error:
        raise ValueError(f'Cannot read config {path}: {error}') from None
    root=mapping({} if value is None else value,('server','collection','network','history'),'config')
    server=mapping(root.get('server',{}),('bind','port'),'server')
    collection=mapping(root.get('collection',{}),('interval_seconds','disks','gpu'),'collection')
    disks=mapping(collection.get('disks',{}),('enabled','interval_seconds'),'collection.disks')
    gpu=mapping(collection.get('gpu',{}),('enabled','interval_seconds'),'collection.gpu')
    network=mapping(root.get('network',{}),('interfaces',),'network')
    history=mapping(root.get('history',{}),('retention_days','path'),'history')
    bind=server.get('bind','0.0.0.0')
    if not isinstance(bind,str) or not bind.strip(): raise ValueError('server.bind: expected an address')
    interfaces=network.get('interfaces',[])
    if not isinstance(interfaces,list) or any(not isinstance(name,str) or not name or any(c.isspace() for c in name) for name in interfaces):
        raise ValueError('network.interfaces: expected a list of interface names')
    storage=history.get('path','./data/agent.sqlite')
    if not isinstance(storage,str) or not storage: raise ValueError('history.path: expected a file path')
    if not Path(storage).is_absolute():storage=str((file.parent/storage).resolve())
    return AgentConfig(bind=bind,port=number(server.get('port',9108),'server.port',1,65535,True),
        interval_seconds=number(collection.get('interval_seconds',5),'collection.interval_seconds',1,300),
        disks_enabled=enabled(disks.get('enabled',True),'collection.disks.enabled'),
        disks_interval_seconds=number(disks.get('interval_seconds',60),'collection.disks.interval_seconds',1,86400),
        gpu_enabled=enabled(gpu.get('enabled',True),'collection.gpu.enabled'),
        gpu_interval_seconds=number(gpu.get('interval_seconds',5),'collection.gpu.interval_seconds',1,86400),
        interfaces=tuple(interfaces),retention_days=number(history.get('retention_days',90),'history.retention_days',1,3650,True),path=storage)
