# Repository Guidelines

## Project Structure & Module Organization

- `frontend/src/`: React, TypeScript, Tailwind, and UI components in `components/ui/`. Vite uses `frontend/index.html` and outputs to `dist/`.
- `homelab/server/`: HTTP API, polling, synchronization, and collectors. `homelab/shared/` contains YAML configuration and SQLite storage.
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

## Passive HDD Monitoring

HDD sleep and head parking take priority over metric freshness. Never automatically send ATA/SATA SMART or power-state commands, even with `smartctl -n standby`: they may reset idle timers on awake drives. Use kernel/udev metadata and `/proc/diskstats`; do not infer sleep from idle counters. Skip filesystem usage probes on any Linux host with rotational or unknown storage to avoid shared-pool I/O. Preserve cached readings with timestamps and show unavailable values honestly. Keep history databases on SSD; do not claim physical sleep is verified by mocked tests.

## Historical Charts

All historical charts use the same periods: 1 day, 7 days, 30 days, and 90 days. Reuse `HISTORY_PERIODS` and `PeriodSelector` from `frontend/src/components/resource-history.tsx`. Missing measurements must remain unavailable, and gaps in collection must appear as breaks in charts.

## Testing Guidelines

Run `python3 -m unittest discover -s tests -v`, `npm run build`, `sh -n install.sh`, and, from `agent/`, `go test -race ./...`. Python tests use `test_*.py` and `test_*` methods; Go tests use `*_test.go`. No numeric coverage threshold is configured. Add behavioral checks for protocol, metrics, configuration, storage, and installer changes. For Linux integration checks, follow `docs/development.md` and `docs/installer-testing.md`.

## Commit & Pull Request Guidelines

Follow [Git workflow rules](docs/git-workflow.md). Use Conventional Commits and write all commit messages in English, for example `feat(agent): add sleep-aware disk monitoring`. The primary branch is `main`. While the project has one developer, direct commits and pushes to `main` are allowed; task branches and PRs are optional. When using branches, create them from `main` and target PRs to it. PRs should describe the problem, resulting behavior, validation, and material limitations; link relevant issues and include anonymized UI screenshots when useful. Update documentation when commands, YAML, APIs, or platform support change.

## Security & Configuration

Never commit tokens, private keys, SQLite databases, generated artifacts, or real hostnames and LAN addresses. Use synthetic examples. Report vulnerabilities according to `SECURITY.md`.
