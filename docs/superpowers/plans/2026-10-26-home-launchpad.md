# Home Launchpad Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Deliver and locally run a persistent home application launchpad populated from the privately collected catalogue.

**Architecture:** A focused SQLite-backed catalogue module exposes authenticated CRUD through the existing Python HTTP server. React renders the launchpad inside the current dashboard shell, independently of hardware polling. A private, idempotent import populates the local database without putting real infrastructure details in Git.

**Tech Stack:** Existing Python standard library, SQLite, React 19, TypeScript, Tailwind and lucide-react; no new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-10-26-home-launchpad-design.md`

## Global Constraints

- `/` becomes the home page; monitoring moves to `/overview`; preserve existing server/storage paths.
- No agent changes, automatic network probes, container management, Docker socket mounts, or SSH credentials in the product.
- Unknown values remain unknown. Discovered external links are `unverified`, never automatically `confirmed`.
- Additive SQLite changes only; persistence and backup use the existing dashboard database/volume.
- Do not commit real hostnames, addresses, credentials, private catalogues or generated databases.
- User approved autonomous execution on 2026-10-26; implement inline and send the local URL as soon as it is running.

## Review Focus

- A slow/unavailable metrics API must not block viewing or editing applications: browser check with failed host requests.
- Editing an external URL must revoke its previous confirmation: storage/API regression test.
- Reimporting after manual edits must preserve those edits and skip existing import keys: storage regression test.
- Invalid/repeated/partial reorder requests must not partially change ordering: storage/API regression test.
- HTTP(S) URLs with credentials, controls, invalid ports or script schemes must be rejected before storage: validation regression test.

---

### Task 1: Persistent catalogue, API and private import

**Files:**
- Create: `homelab/server/launchpad.py`, `homelab/server/launchpad_import.py`
- Modify: `homelab/server/app.py`
- Test: `tests/test_launchpad.py`

**Interfaces:**
- `Launchpad(path)` initializes `application_groups` and `applications` tables.
- `catalogue() -> {groups: list, applications: list}`; groups have `id,name,position`;
  applications have `id,name,url,local_url,external_url,external_access,icon,group_id,position`.
- `save_application(value, application_id=None) -> dict`, `delete_application(id)`;
  `save_group(value, group_id=None) -> dict`, `delete_group(id)`;
  `reorder(kind, ids, group_id=None)` validates a complete permutation in one transaction.
- `import_applications(records) -> {added:int, skipped:int}` accepts private draft records,
  imports only `include_by_default` records, preserves existing import keys and manual edits.
- HTTP: `GET /api/applications` returns the catalogue. `POST /api/applications` and
  `POST /api/application-groups` create; `PUT`/`DELETE` on the corresponding ID update/delete.
  `PUT /api/applications/order` accepts `{group_id,ids}`; group order accepts `{ids}`.
- CLI: `python3 -m homelab.server.launchpad_import --data DB --catalog FILE`.

- [x] Write behavioral tests for CRUD, URL validation, confirmation resets, group deletion
  preserving applications, independent instances, reorder rollback, idempotent/atomic import,
  persistence after reopen and backup restoration; HTTP tests cover auth/origin/body limits.
- [x] Run `python3 -m unittest discover -s tests -p 'test_launchpad.py' -v` and observe missing catalogue behavior.
- [x] Implement module and additive initialization, API dispatch and CLI. Validate all fields,
  only HTTP(S), no URL userinfo or sensitive authorization parameters, bounded text/body sizes.
  Move applications from deleted groups into the ungrouped section; append moves to new groups.
- [x] Run the targeted tests, then `python3 -m unittest discover -s tests -v`.
  Expected: all pass, existing host authentication and history remain intact.
- [x] Commit `feat(server): persist and manage the application catalogue`.

### Task 2: Launchpad interface and local application icons

**Files:**
- Create: `frontend/src/components/launchpad.tsx`, `frontend/src/components/application-editor.tsx`,
  `frontend/src/components/application-icon.tsx`, `frontend/src/components/launchpad-data.ts`,
  `frontend/public/app-icons/` with attribution and license, `tests/frontend/launchpad.test.mjs`
- Modify: `frontend/src/main.tsx`, `.github/workflows/checks.yml`

**Interfaces:**
- `Launchpad({request, hosts, hostsLoading, hostsError})` uses the authenticated request helper.
- `ApplicationEditor` edits both addresses, group, icon and explicit external confirmation.
- `recognizeApplication(name,url)` suggests a bundled icon/name without network calls;
  `externalAccessLabel(application)` supplies accessible, honest globe text.
- Consume Task 1 catalogue/application/group field names verbatim.

- [x] Write node behavioral tests for recognition avoiding port-only guesses and false brand
  matches, preserving user input, and external access labels.
- [x] Run `node --experimental-strip-types --test tests/frontend/launchpad.test.mjs`.
  Expected: missing helper behavior fails.
- [x] Implement responsive grouped icon grid, search and clear/empty/error states, primary
  links in new tabs, secondary addresses and actions in an accessible details dialog.
  Add application/group creation/edit/delete and keyboard-accessible ordering controls.
- [x] Bundle only required brand icons from selfh.st/icons with CC BY 4.0 attribution,
  original license and source manifest. Draw neutral blueprint with existing lucide primitives.
- [x] Integrate `/`, `/overview`, existing navigation and independent catalogue loading.
  Show a compact server-status widget; application UI remains usable when metrics fail.
- [x] Run frontend node tests and `npm run build`; expected all pass.
- [x] Commit `feat(frontend): add the home application launchpad`.

### Task 3: Populate, run locally, document and verify

**Files:**
- Modify: `README.md`, `README.ru.md`, `docs/architecture.md`, `docs/development.md`
- Runtime only: ignored `data/dashboard.sqlite`, private import JSON outside the repository.

**Interfaces:**
- Consume Task 1 CLI and Task 2 built UI; preserve existing registrations/history.

- [x] Snapshot the existing local database, import the 29 default private records, and rerun
  the importer to prove no duplication. Expected: first run adds 29, second skips 29.
- [x] Run the server on loopback with a free local port; immediately send its URL to the user.
- [x] Browser-check grouped icons, search, add/edit/delete, globe states, alternate links,
  ordering, persistence, mobile layout and monitoring routes. Use synthetic test records only
  for CRUD; do not navigate to real application links or probe the services.
- [x] Document home/catalogue behavior, API/import commands, external icon meaning,
  persistence and absence of ongoing discovery/probes.
- [x] Run `python3 -m unittest discover -s tests -v`, `npm run build`,
  `node --experimental-strip-types --test tests/frontend/*.test.mjs`, `sh -n install.sh`,
  and `go test -race ./...` from `agent/`. Expected: all pass.
- [x] Run whole-change fresh review, fix important findings with regression checks,
  inspect staged files for private data, and commit only task files.
- [x] Leave the local server running and report its URL, validation and material limitations.
