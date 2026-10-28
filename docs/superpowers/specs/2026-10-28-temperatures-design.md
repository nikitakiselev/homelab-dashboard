# Temperatures on server cards and in server history

## Intent and scope

Show all temperatures already supplied by agents (every GPU and disk) on compact server cards. Add a multi-series temperature history chart on the server overview. CPU collection is outside scope because current agents do not supply CPU temperatures. The user delegated layout and implementation choices.

## Approaches

1. Extend and redeploy agents to retain temperatures: supports offline backfill, but unnecessarily requires fleet updates for existing metrics.
2. Store temperature observations independently in the dashboard: works with deployed agents, but history starts at deployment and cannot recover periods when the dashboard was stopped. **Chosen implementation decision.**

## Behavior and constraints

- Cards show individually labeled GPU/disk readings in a wrapping compact block. Missing/non-finite readings are not fabricated; an empty block says no temperature data. Zero and negative temperatures are valid.
- GPU readings use the metrics timestamp. Disk readings use `smart_updated_at`; unknown measurement times remain explicitly unknown on cards and are not added to history. Disk readings are labeled saved measurements with their time; offline GPU readings are labeled saved as well.
- History contains actual measured timestamps, deduplicated per host/device/time. Disk cache is never resampled as a current observation. Devices are identified by serial when available, otherwise disk name/model; GPU name and duplicate occurrence distinguish currently exposed devices. Agent protocol lacks stable GPU identifiers, so identical GPU replacement cannot be detected.
- The chart uses Celsius, a line per device, clickable legend, and existing `HISTORY_PERIODS`/`PeriodSelector`: 1, 7, 30, 90 days. Five-minute buckets for one day, six-hour buckets otherwise; missing buckets break lines, sparse measurements remain visible as points. No extrapolation to now or invented historical readings.
- Dashboard-local retention follows its existing setting. Removing a host deletes its temperatures. Additive SQLite tables preserve older images' compatibility and backups.
- Reuse authenticated HTTP API. Collect only during normal agent polling, never on page visits. No extra device commands, SMART checks, disk wake-ups, or agent changes.

## UI and limitations

The proposed compact block sits below resource rings. A full-width temperature chart sits below the existing overview charts, sharing their selected period. Show loading/error/empty states and explain that temperature history begins when the dashboard observes measurements and that disk readings may be infrequent. History is not backfilled from old agents.
