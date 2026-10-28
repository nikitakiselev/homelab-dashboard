# Temperature Display and History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display every existing GPU/disk temperature on server cards and persist honest temperature history for server charts.

**Architecture:** A separate dashboard temperature store records validated normal-poll observations using device measurement times. An authenticated endpoint returns per-device bucketed series independently of agent history synchronization. React components display readings and a Celsius line chart using the existing period selector.

**Tech Stack:** Python sqlite3/unittest; React/TypeScript/Recharts; Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-28-temperatures-design.md`

## Global Constraints

- No agent changes or additional hardware probes.
- Periods: 1, 7, 30, 90 days. Missing readings never become zero or interpolated continuity.
- Repeated disk cache uses its original SMART timestamp; unknown timestamps never enter history.
- Additive schema only; existing SQLite backups and previous dashboard images remain usable.
- Work in the current checkout under the repository's optional-branch workflow; preserve the existing untracked `work/` directory.

## Review Focus

- Repeated cached readings must not produce repeated measurements or refreshed dates.
- Multiple devices, duplicate GPU names and changed disk identity must not collapse into one line.
- Unknown timestamps/non-finite temperatures must not enter history; real zero/negative Celsius must survive.
- Sparse readings, missing collection intervals and hidden devices must not be bridged by chart lines.
- Host deletion, auth, dashboard restarts and retention must include the new tables.

### Task 1: Temperature persistence and API

**Files:** Create `homelab/server/temperatures.py`, `tests/test_temperatures.py`; modify `homelab/server/app.py`.

**Interfaces:** `Temperatures(path, retention_days)`, `sample(host, metrics)`, `read(host, days) -> {series, records}`, `delete(host)`. Series contain id/label/kind; records contain bucket and values keyed by series id.

- [x] Write tests for every Review Focus storage case, period aggregation, and sample-time deduplication.
- [x] Run `python3 -m unittest discover -s tests -p test_temperatures.py -v`; confirm new behavior fails.
- [x] Implement the store and integrate normal poll, deletion, demo data and authenticated `/api/temperatures/<host>?days=...`.
- [x] Add HTTP integration tests for authentication, supported periods, and independent history; run targeted suites.

### Task 2: Compact readings and historical chart

**Files:** Create `frontend/src/temperatures.ts`, `frontend/src/components/temperature-readings.tsx`, `frontend/src/components/temperature-history.tsx`, `tests/frontend/temperatures.test.mjs`; modify `frontend/src/main.tsx`, `frontend/src/components/server-page.tsx`.

**Interfaces:** Pure helpers derive current readings and chart rows with explicit gaps. Chart receives host, period, end, and existing authenticated request callback.

- [x] Write tests for all GPU/disk readings, cached/offline/unknown-time labels, zero/negative values, empty states, sparse buckets and selection.
- [x] Run `node --test tests/frontend/temperatures.test.mjs`; confirm failures before implementing.
- [x] Implement helpers and components; integrate cards and server overview, sharing selected period and keeping API polling independent from hardware collection.
- [x] Run frontend tests/build and inspect synthetic desktop/mobile layouts and sparse chart rendering.

### Task 3: Documentation, validation and release

**Files:** Modify `docs/metrics.md` and `docs/docker.md` where necessary.

- [x] Document dashboard-only history start, retention, lack of backfill, saved SMART sample timestamps, identity limitations and additive rollback compatibility.
- [x] Run frontend tests, Python suite, build, Go race suite, installer syntax, formatting and diff checks.
- [x] Review the complete diff for freshness, gaps, identity and auth regressions; resolve material findings.
- [ ] Commit only task files. Publish and deploy the dashboard following the existing release workflow, backup first, if verification succeeds; verify API version, container health and rendered UI.

## Execution record

- Task 1: complete; new store tests failed before implementation, full Python suite now 58/58.
- Task 2: complete; four frontend tests failed before implementation, full frontend suite 20/20; TypeScript/build passed. Desktop rendered three temperature series; mobile 390px had no overflow; legend hides an individual series.
- Ruling: use five-minute persisted weighted aggregates with last accepted source timestamp, rather than unbounded raw poll samples — preserves measured-time deduplication with bounded SQLite growth. Out-of-order older samples within a populated bucket are ignored; chronological background polling is the intended input.
- Debugging: integration tests caught a nested SQLite write transaction; temperature sampling now follows the committed metrics transaction while retaining the host lifecycle lock.
- Final review: independent reviewer found a host-deletion race. Deterministic concurrent regression failed with two orphan series; acquiring the lifecycle lock before deletion fixes it. Full Python suite now 59/59.
- Final: minor (deferred): expiry test currently checks rejection of expired input rather than advancing time to expire an already persisted row; reviewer separately verified pruning and orphan-metadata cleanup work.
- Container verification: real non-root/read-only image, backup, update and rollback smoke passed with temperatures. Published 0.3.2 also opened an augmented database without deleting temperature rows.
