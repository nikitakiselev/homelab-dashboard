# CPU temperature

User requested CPU temperature on existing cards/history and authorized host access/deployment; earlier delegated implementation choices. Implementation decisions below are the builder's, not individually user-selected.

## Intent and constraints

Read CPU temperature in the independent Linux Go agent during ordinary metric collection. Add optional `cpu.temperature` (Celsius or null) and `cpu.temperature_source` (description). Old agents remain compatible. No extra dependencies, kernel module changes, commands, SMART, storage probes, or dashboard hardware access. Missing/disappearing sensors yield null immediately.

## Approaches

- Read all hwmon temperatures: rejected because NVMe, Wi-Fi and motherboard zones are not CPU temperatures.
- Invoke lm-sensors: rejected because it introduces a package/command dependency without improving sysfs data.
- Selected by builder under delegated discretion: read recognized CPU hwmon drivers. Intel coretemp prefers Package id readings, falling back to maximum Core reading when package is absent. AMD k10temp/zenpower prefers Tdie, then Tctl (explicitly labelled control temperature). Multiple CPU devices use the maximum selected temperature. Unrecognized drivers are not guessed. No generic ACPI fallback.

Observed four physical Intel machines expose coretemp; one has only Core labels. VPS has no hwmon. CPU source tooltip must distinguish package from max-core fallback. One CPU summary reading/series keeps compact cards and existing chart useful; per-core charts are out of scope.

## Integration

Read only temp*_input/label/fault for recognized drivers; strict finite millidegree parsing and plausible bounds [-50,150] Celsius. A faulted, missing or malformed input is unavailable, never 0 by parse failure. Stable history identity `cpu`, with metrics timestamp; source changes do not split the CPU summary series. Existing dashboard-local retention, sampling, auth, period selection and gap semantics stay unchanged. Synthetic demo adds CPU temperature. History starts on agent update, no backfill.

## Deployment

Release agent and dashboard independently using existing workflows. Preserve agent configuration, token and history. Check each updated service/API and CPU source. Back up dashboard SQLite before image replacement. Do not install an agent in the dashboard container/LXC. Update VPS for protocol parity, but expect null. Verify actual sensors; mocked tests prove parsing only.
