"""Read-only block I/O counters. Sector units in diskstats are always 512 bytes."""


def parse_diskstats(raw, whole_device):
    result = {}
    for line in raw.splitlines():
        fields = line.split()
        if len(fields) < 14 or not whole_device(fields[2]):
            continue
        try:
            values = tuple(int(fields[i]) for i in (5, 9, 3, 7))
        except ValueError:
            continue
        if any(v < 0 for v in values):
            continue
        result[fields[2]] = (fields[0]+':'+fields[1], values)
    return result


def disk_deltas(current, previous, seconds):
    result = {}
    if seconds <= 0:
        return result
    for name, (identity, values) in current.items():
        old = previous.get(name)
        if not old or identity != old[0] or any(v < p for v, p in zip(values, old[1])):
            continue
        delta = [v-p for v, p in zip(values, old[1])]
        result[name] = dict(read_bytes=delta[0]*512, write_bytes=delta[1]*512,
                            read_ops=delta[2], write_ops=delta[3], seconds=seconds)
    return result
