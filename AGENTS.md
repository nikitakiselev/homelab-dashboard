# Repository Guidelines

## Project Structure & Module Organization

- `frontend/src/`: React, TypeScript, Tailwind, and UI components in `components/ui/`. Vite uses `frontend/index.html` and outputs to `dist/`.
- `homelab/server/`: HTTP API, polling, synchronization, and collectors. `homelab/shared/` contains dashboard SQLite storage. Hardware collection and agent YAML configuration belong only to the independent Go agent.
- `agent/`: independent Go module for the Linux agent; CLI entry point in `cmd/homelab-agent/`, implementation and tests in `internal/agent/`.
- `tests/`: Python tests and installation smoke scripts. `deploy/` contains installers, systemd units, and example configuration; `docs/` contains detailed Russian documentation.
- `data/` and `releases/` hold ignored runtime data and generated binaries.

## Build, Test, and Development Commands

Use Python 3.10+, Node.js 22+, and the Go version in `agent/go.mod`.

- `python3 -m venv .venv && . .venv/bin/activate`: create a Python environment; install dependencies with `python3 -m pip install -r requirements.txt`.
- `npm ci`: install frontend dependencies from the lockfile.
- `npm run build`: type-check TypeScript and build the frontend.
- `python3 -m homelab.server`: run locally at `127.0.0.1:8080`.
- `npm run dev`: start Vite separately; `/api` proxies to the backend.
- `npm run format`: apply Prettier to frontend and configured project files.
- From `agent/`, `go build -o ../releases/homelab-agent ./cmd/homelab-agent`: build the agent.

## Coding Style & Naming Conventions

Use two-space indentation, double quotes, and semicolons in TypeScript; let Prettier format changes. Use PascalCase React component names and lowercase component filenames. Python uses four-space indentation and snake_case names; follow nearby code. Format Go with `gofmt`. TypeScript strict checking is enabled; no lint script is configured.

## Service Boundaries

The dashboard is an HTTP client of independent Linux agents. Never embed hardware collectors or start an agent implicitly from the dashboard or its installer. The host running the dashboard uses a separately installed agent and the same registration API as any other Linux host. macOS runs the dashboard only. Keep each service's configuration, token, database, installation, and lifecycle independent.

## Passive HDD Monitoring

HDD sleep and head parking take priority over metric freshness. Default to passive ATA monitoring. Automatic ATA SMART is permitted only with explicit opt-in and a serial allowlist, at most once per 24 hours per physical identity, during recently observed block I/O. Persist the attempt budget before any device command, including failures and standby skips. Use CHECK POWER MODE followed by an explicit ATA smartctl standby guard; fail closed on unknown state or unsupported transport. Never periodically poll power independently, auto-detect USB/SAS/RAID, or change APM/parking/sleep settings. CHECK POWER MODE is specified not to change the standby timer, but the complete SMART sequence still requires physical validation. Use kernel/udev metadata and `/proc/diskstats`; do not infer sleep from idle counters. Skip filesystem usage probes on any Linux host with rotational or unknown storage to avoid shared-pool I/O. Preserve cached readings with timestamps and show unavailable values honestly. Keep history databases on SSD; do not claim physical sleep is verified by mocked tests.

## Historical Charts

All historical charts use the same periods: 1 day, 7 days, 30 days, and 90 days. Reuse `HISTORY_PERIODS` and `PeriodSelector` from `frontend/src/components/resource-history.tsx`. Missing measurements must remain unavailable, and gaps in collection must appear as breaks in charts.

## Testing Guidelines

Run `python3 -m unittest discover -s tests -v`, `npm run build`, `sh -n install.sh`, and, from `agent/`, `go test -race ./...`. Python tests use `test_*.py` and `test_*` methods; Go tests use `*_test.go`. No numeric coverage threshold is configured. Add behavioral checks for protocol, metrics, configuration, storage, and installer changes. For Linux integration checks, follow `docs/development.md` and `docs/installer-testing.md`.

## Commit & Pull Request Guidelines

Follow [Git workflow rules](docs/git-workflow.md). Use Conventional Commits and write all commit messages in English, for example `feat(agent): add sleep-aware disk monitoring`. The primary branch is `main`. While the project has one developer, direct commits and pushes to `main` are allowed; task branches and PRs are optional. When using branches, create them from `main` and target PRs to it. PRs should describe the problem, resulting behavior, validation, and material limitations; link relevant issues and include anonymized UI screenshots when useful. Update documentation when commands, YAML, APIs, or platform support change.

## Dashboard Images

Deliver the dashboard as a non-root GHCR image and Docker Compose service, independently of Linux agents. Tag releases `dashboard-vX.Y.Z`, build Linux amd64/arm64 images, and publish GitHub notes with `--latest=false` for old agent compatibility. Keep SQLite in a persistent SSD-backed volume and credentials outside the image. Verify authenticated health checks, backup, container recreation and rollback with preserved data. Never mount the Docker socket or host devices into the dashboard. Docker Compose health checks do not imply automatic rollback; document rollback and database compatibility honestly.

## Security & Configuration

Never commit tokens, private keys, SQLite databases, generated artifacts, or real hostnames and LAN addresses. Use synthetic examples. Report vulnerabilities according to `SECURITY.md`.
