# CPU Temperature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add CPU temperature to Linux agents, compact cards and dashboard-local history, then deploy.
**Architecture:** Recognized CPU-only sysfs sensors produce one optional CPU summary reading; existing temperature pipeline handles its history.
**Tech Stack:** Go, Python/SQLite, React/TypeScript.
**Spec:** `docs/superpowers/specs/2026-10-28-cpu-temperature-design.md`

## Global Constraints

- No device commands, SMART changes, new dependencies, kernel changes or dashboard hardware collection.
- Old agent payloads remain supported; unavailable never becomes zero.
- Retain shared 1/7/30/90 day history periods and honest gaps.

## Review Focus

- hwmon renumbering must not change selected CPU reading or CPU history identity.
- NVMe/Wi-Fi/ACPI high temperatures must never be selected as CPU.
- Missing/malformed/faulted readings must return null, with no cached freshness claim.
- Package preference, core fallback, AMD die/control distinction, multiple packages must be deterministic.
- Old agents, zero, offline snapshots and valid measurement times must work through UI/history.

### Task 1: CPU collector and additive protocol

Files: new `agent/internal/agent/cpu_temperature.go`, `cpu_temperature_test.go`; modify `metrics.go`, `collector_linux.go`.
Interface: `readCPUTemperature(root string) (*float64, string)`, root is `/sys/class/hwmon`; CPU JSON optional source and nullable temperature.

- [x] Write fixture tests for Review Focus sensor cases, bounds and invalid numbers; run `go test ./internal/agent -run CPUTemperature` and observe failure.
- [x] Implement strict parser/selection, use named CPU fields in Collect, read on every ordinary metric collection.
- [x] Run collector tests and `go test -race ./...` (Linux fixture tests also run on macOS by keeping sysfs parser platform-neutral).

### Task 2: Dashboard/UI/history integration

Files: `homelab/server/temperatures.py`, demo in `app.py`, `frontend/src/lib.ts`, `temperatures.ts`, `components/temperature-history.tsx`, temperature test files, `docs/metrics.md`.
Interface: CPU observation identity `cpu`, label `CPU`, kind `cpu`, metrics timestamp; frontend adds optional CPU fields and first reading with source tooltip.

- [x] Write failing Python/frontend CPU tests for backward compatibility, zero, unavailable, saved offline readings and timestamp deduplication.
- [x] Implement observation, frontend types/readings and chart copy, synthetic demo CPU.
- [x] Run Python/frontend tests and build. Document sources, summary selection and limits.

### Task 3: Verify, review, release and deploy

- [x] Run full Python suite, serial frontend tests, build, Go race tests, installer syntax and diff/format checks.
- [x] Independent code review; resolve material findings.
- [x] Commit/push task files only, publish agent and dashboard releases with existing tag workflows.
- [x] Preserve configuration/history while updating four physical agents and VPS; verify services and actual metrics.
- [x] Back up dashboard, update image, verify health, cards, CPU series and persisted samples. Record limitations/results.

## Execution ledger

- Pre-flight: task 1 emits optional CPU temperature/source; task 2 consumes those exact names, ignores absent fields. No interface conflict.
- Task 1: complete; undefined collector RED, fixtures and macOS Go race suite GREEN. Linux Go race suite also GREEN in Go 1.27.3 container. First Linux invocation mounted only agent/, so existing example-config test could not find deploy/; corrected mount to repository root, no product fix needed.
- Task 2: complete; Python CPU series count RED (0 instead of 1), frontend CPU first reading RED (GPU instead); now 60 Python and 21 frontend tests GREEN, build GREEN. Existing nonblocking SQLite ResourceWarning and Vite >500 kB bundle warning remain.
- Native inline execution on a task branch in existing checkout; preexisting work/ untouched. Decisions remain documented in the spec.
- Container smoke GREEN: authenticated health, non-root, backup, recreation, update/rollback with retained history. Desktop demo CPU cards and four chart series verified; mobile width 390 has no overflow.
- Release numbering: agent-v0.3.5 already exists; new agent release will be 0.3.6, dashboard 0.3.4.
- Final review: fixed zenpower multi-socket labels (`cpu0 Tdie`/`cpu1 Tdie`) after checking upstream driver; two-device hotter-Tctl regression RED→GREEN, full Go race suite GREEN.
- Final: minor (deferred): Linux smoke does not specifically assert new CPU JSON fields; parser fixtures, protocol integration in Linux build, and actual deployed API readings cover this release, but a future smoke assertion would strengthen regression coverage.
- Released feature commit `0e75bc7` to main as agent 0.3.6 and dashboard 0.3.4. Agent release, dashboard multiarch image, full Checks (including Linux smoke and install/rollback) and Go security workflows passed.
- Deployment: all five existing agents updated with the pinned native upgrade command; services/API healthy. Config and credential hashes unchanged; consistent pre-update history backups and post-update SQLite integrity verified. Three Intel hosts report package readings, fourth reports maximum core; virtual host reports null, as expected. AMD verified by fixtures/upstream driver labels, not physical AMD hardware.
- Dashboard consistent backup verified before image update; published 0.3.4 healthy. Actual UI shows CPU on four of five cards, CPU history series verified; 42 persisted background CPU observations across four hosts at final database check. Mobile 390px cards have no overflow. No agent installed in dashboard service.
