# AGENTS.md

Express 5 + Sequelize 6 API (ESM, `"type": "module"`) behind the BPPMHKP fish-export
dashboard. Reads five MySQL schemas and serves analytics + JWT auth.

No git repo, no linter, no test runner, no CI, no README. `package.json` has only
`start` and `dev`.

## Architecture: technical layering in root `src/`

Every component lives in a **layer folder** under `src/`, not inside a per-feature
`modules/` tree:

```
src/
├── controllers/     5 files   *Controller.js   HTTP in, envelope out
├── services/        7 files   *Service.js      business logic, validation, shaping
├── repositories/    6 files   *Repository.js   raw SQL + parameterised replacements
├── routes/          6 files   *Routes.js + index.js (the /api/v1 aggregator)
├── middleware/      3 files   verifyToken, allowRoles, errorHandler
├── config/          database.js — every Sequelize instance lives here
├── models/          Sequelize models + index.js
├── utils/           pure functions, no dependencies
└── errors/          AppError
```

Dependencies flow one way and never skip a layer:
`routes → controllers → services → repositories → config | models | utils`.

`src/routes/index.js` is the only aggregator; `src/app.js` mounts it once at
`/api/v1` and nothing else. There is no `src/modules/` and no `src/common/` — if you
find yourself importing from either, the path is wrong.

Because every layer is flat and sibling files share a layer, a layer file imports its
sibling with `./` and any cross-layer file with `../<layer>/`. There is no `../../../`
depth anywhere in `src/`; if you write one, you are importing into a layer that does
not exist.

### Adding a feature

Create the four files in the existing layer folders — do **not** create a new
subdirectory:

```
src/repositories/<name>Repository.js
src/services/<name>Service.js
src/controllers/<name>Controller.js
src/routes/<name>Routes.js
```

Then register the router in `src/routes/index.js`. Keep the layer discipline: no SQL
in controller or service, no `req`/`res` outside controllers, no business constants in
repository SQL.

## Commands

```bash
npm start          # node server.js  (port from .env: 5002)
npm run dev        # nodemon server.js, no nodemon config
```

There is no lint / typecheck / test command to run. The only verification available is
an import smoke test, which is also how you find broken wiring:

```bash
node --input-type=module -e "import('./src/app.js').then(()=>console.log('OK')).catch(e=>console.log(e.message))"
node --check server.js
```

All schemas (`192.168.9.151`) are reachable from the dev machine; credentials are in
`.env`.

`test-db.js` in the repo root is **broken and will stay broken**: it uses `require()` in
a `"type": "module"` package. To check connections, run the `testConnections()` import
snippet from `src/config/database.js` directly instead.

## Runtime verification without a terminal

There is no test runner, so verify by booting the app in-process and calling it. Do
**not** background `node server.js` in the tool shell — the held stdout pipe wedges the
session and the process dies with it. Use `setsid nohup node server.js > /tmp/log 2>&1
< /dev/null &` plus `disown`, then check the port with `ss -tlnp | grep 5002`.

For a throwaway test, write a script **inside the repo** (so `node_modules` resolves),
import `app.js`, `app.listen(0)`, `fetch` the endpoints, then `process.exit(0)`. Delete
the script afterwards. Always end with `process.exit()` — the Sequelize pools stay open
and the process hangs otherwise.

Use real data when checking behaviour: `tr_report_ekspor` only holds **2025 and 2026**.
Any `startDate`/`endDate` in 2024 (or `tahun=2024`) returns well-formed `200` responses
with empty arrays, which looks like a passing test but proves nothing.

When a change must not alter behaviour, snapshot the affected endpoints to JSON **before**
editing, then diff the responses after. Comparing status codes alone hides contract
drift.

### A stale process looks exactly like a routing bug

A `node server.js` started before a route file existed keeps serving the old code, so
every new endpoint answers `404` even though the mount is correct. If `/api/health` still
answers `200` while a whole module answers `404`, suspect the running process, not the
router. `npm run dev` (nodemon) avoids this.

## Database connections

`src/config/database.js` creates five independent Sequelize instances:

| Export | Schema | Contents |
|---|---|---|
| `dbMaster` | `hc` | `tb_user`, `tb_r_upt` |
| `dbReport` | `report_siapmutu` | `tr_report_ekspor` (SMKHP) |
| `dbReportSkp` | `report_skp` | `tr_skp_paska` |
| `dbPrimer` | `report_primer` | `tr_laporan_primer_export` |
| `dbMutu` | `mutu` | data master perizinan |

All point at the same host today but are treated as separate servers. **Never write a
cross-database JOIN.** `hc.tb_r_upt` is read into an in-memory `Map`, then merged with
transaction rows in the service layer (`UptMasterService.applyToRows`,
`getUptBreakdown`). Sequelize associations are deliberately absent — see the header
comment in `models/TbRUpt.js`.

Raw SQL in `hc` is schema-qualified (`FROM hc.tb_user`) even though `hc` is already the
default schema. SQL in `report_siapmutu`, `report_skp`, and `report_primer` is *not*
qualified, since those instances connect straight to their schema.

`DB_PRIMER_*` inherits credentials from `DB_MUTU_*` via fallback in code, so a
misconfigured env var does not break the connection. `dbMutu` logs a `⚠️` line at boot
when the app user lacks a GRANT — that is a server-side permission issue, not a config
bug, and it does not block boot.

## The SMKHP files are a re-layout of a reference project

Source of truth:
`/home/omdien/bppmhkp-dashbaord/bppmhkp-dashboard-be/src/` (note the typo `dashbaord`).
The reference nests files under `modules/pascapanen/smkhp/` and re-exports them with
`export*` filenames; this repo renamed the files to `smkhp*` and flattened them into the
layer folders. File bodies are otherwise byte-identical.

Consequence: every relative import inside a copied file is wrong for this layout. A blind
re-copy silently reintroduces these breaks:

- utils → `../utils/<file>.js` (not `../../../utils/`)
- models → `../models/index.js`
- sibling layer files → `./smkhp<Name>.js` (not `../services/<name>.js`)
- auth middleware → `../middleware/authMiddleware.js`, and the exported name is
  `verifyToken`. The reference `routes/` file calls a `verifyPublicToken` that **does not
  exist anywhere** in this repo — always check before copying a route file.

Run the import smoke test above after any copy from the reference project. Grep for
multi-line `import {` blocks specifically: a `sed` on single-line imports silently
misses them.

### The `sequelizeHc` vs `dbMaster` naming trap

The reference `models/index.js` exports `sequelizeHc`; this repo's exports it as
`dbMaster`. `uptMasterRepository.js` was copied with the reference's name and threw at
import time. It is fixed to use `dbMaster`, but watch for the same stale identifier
appearing in any newly copied file. Note this repo has no correctly-named handle for the
`hc` connection beyond `dbMaster` — `sequelize` and `sequelizeReport` both alias the
**report** connection.

## UPT code normalisation

`src/utils/uptCode.js` is the single source of truth. `kode_upt` in `tr_report_ekspor` is
inconsistent across sources: `01.00`, `01.0`, `15.0` all mean "Balai PPMHKP Jakarta" and
collapse to `15.0`. The rule must be applied **uniformly** in all three places — `WHERE`
filter, `GROUP BY`, and name lookup — or the same unit appears twice with an identical
label. Use the exported helpers (`normalizeUptCode`, `expandUptCodeFilter`,
`buildInClause`, `buildFullUptGroupByExpression`, `mergeUptGroups`) rather than
hand-rolling SQL; an agent will otherwise filter on `kd_upt=15.0` and silently drop the
`01.00` rows.

`98.0` / `99.0` are dummy units that *do* have `STS_AKTIF = 1`, so they must be excluded
explicitly via `TEST_UPT_CODES` / `isTestUptCode`.

`NM_UNIT` / `NM_PENDEK` in master contain embedded newlines and CRs — always run labels
through `sanitizeLabel` before returning them.

## The master-UPT cache

`src/services/uptMasterService.js` is the **only** master-UPT cache, backed by
`src/repositories/uptMasterRepository.js` (raw SQL against `hc.tb_r_upt`). TTL cache (default
6h, `UPT_MASTER_CACHE_TTL_MS` / `_HOURS`, clamped 1–12h; 5min after a failed read) with
single-flight dedup. The `smkhp`, `skp` and `/api/v1/options/upt` endpoints all read through
it, so UPT naming and code normalisation stay consistent across them.

`server.js` preloads it at boot via `UptMasterService.preload()`, so the cache is never cold
on the first request. Boot log line: `[UptMaster] N UPT aktif dimuat ke cache TTL`. Don't add
a second cache — an earlier `masterCacheService.js` + `masterRepository.js` pair did exactly
that (plain `Map`, no TTL, never read by a route) and was deleted; reintroducing it means
duplicate master reads and two places to keep `NM_UNIT` sanitisation in sync.

## SQL conventions

- Raw SQL only (deliberate — see `smkhpRepository.js` comments about a Sequelize
  division-operator bug). Every user value goes through `replacements`. **Never
  interpolate a value into a SQL string.** `buildInClause` exists to keep `IN (...)`
  lists parameterised.
- A `WHERE`-clause builder that returns `1 = 0` for a rejected input must return the
  whole `WHERE 1 = 0`, keyword included — returning a bare condition produces invalid SQL.
  `primerRepository.js` does this for `kd_izin` values outside the whitelist.
- Date filters use `BETWEEN :startDate AND :endDate` to hit the existing index. Where
  the column is a datetime the end boundary must be widened to `23:59:59`
  (`smkhpRepository.normalizeDateBoundary` does this); where it is a plain `DATE`
  (`tgl_izin`) the widening is harmless but unnecessary.
- USD is **derived**: `nilai_rupiah / kurs_usd` guarded by `kurs_usd > 0`. There is no
  `nilai_usd` column.
- `db.QueryTypes.SELECT` on a Sequelize *instance* is valid here (verified).
- Country / commodity bucketing (`ASEAN`, `Uni Eropa`, `Udang`, `Rumput Laut`) is done
  **in memory** in `src/utils/exportGrouping.js`, not in SQL. DB spelling is inconsistent
  (mixed case, hyphens). ASEAN/EU members must be collapsed into their region bucket
  *before* the Top-5 ranking, otherwise Malaysia and Singapore surface as separate
  markets.
- `report_primer.tr_laporan_primer_export` stores `total_hasil`, `total_minor`,
  `total_mayor`, `total_kritis` as **VARCHAR**, not numbers. `total_hasil` holds
  categorical labels (`Cukup`, `Baik`, `Sangat Baik`, `P1`/`P2`/`P3`, `LULUS`, `-`,
  `NULL`), so it is grouped, never summed. Averages need `CAST(... AS DECIMAL)` or MySQL
  stringifies and silently returns a wrong mean.

## Auth

`POST /api/v1/auth/login` → `{ token, user }`; `GET /api/v1/auth/me` → decoded JWT.
`verifyToken` reads `Authorization: Bearer <token>`, returns 401 when absent and 403 when
invalid/expired.

- Login itself rejects any role outside `ROLES_IZIN = [1, 2]` with **403**, before
  `updateLoginSession` runs. `skp` and `primer` additionally mount `allowRoles([1, 2])` as
  defense in depth for tokens minted before that rule.
- Roles `1, 6, 9` (or a user with no `KD_UNIT`) get `isNationalAccess: true` and
  `kdUnit: null` in the JWT payload. Per-UPT scoping is enforced downstream from these
  claims.
- The JWT carries both `roleId` and `role_id`; `allowRoles` reads `roleId` first and
  falls back. Keep both keys in sync when the payload changes.
- `JWT_SECRET` has a **hardcoded fallback** duplicated in `services/authService.js` and
  `middleware/authMiddleware.js` (`bppmhkp_secret_key_executive_2026`), matching `.env`.
  Keep the two in sync or remove the fallbacks — don't let them drift.
- `.env` holds live shared MySQL credentials. Don't echo it, log it, or paste it into
  output.

## Response envelopes are inconsistent (intentionally, for now)

- `src/utils/apiResponse.js` → `{ success, message, data, meta? }` (used by `smkhp`,
  `skp`, `primer`)
- `authController` → `{ status: 'success' | 'error', message, data }`

Don't unify these without checking the frontend consumer.

`src/middleware/errorHandler.js` **is** mounted last in `app.js`. It emits
`{ success: false, message }` and appends `error` (the stack) only when
`NODE_ENV=development`. `src/utils/appError.js` is dead code — nothing imports it; the
live class is `src/errors/appError.js`.

## Routes

Prefixes are declared once in `src/routes/index.js`, all under the single
`app.use('/api/v1', v1Routes)` in `app.js`:

- `/api/v1/auth` — `login`, `me`
- `/api/v1/options` — `upt`
- `/api/v1/pascapanen/smkhp` — `kpi-summary`, `monthly-trends`, `top-destinations`,
  `commodity-analytics`, `upts`, `upt-breakdown`, `top-products-by-destination`,
  `top-destinations-by-product`, `transactions`
- `/api/v1/skp` — `summary`, `trends`, `distribution`, `list`
- `/api/v1/primer` — `overview`, `certificates`, `export`

`GET /api/health` is mounted directly in `app.js`, outside `/api/v1` and unauthenticated.

The JSDoc above each route in `smkhpRoutes.js` still says `/api/v1/exports/...` — stale,
ignore it. Those comments point at `GET /api/v1/options/upt` for the UPT dropdown, backed
by `UptMasterService.getOptions()`.

### Express calls static handlers unbound

`router.get('/x', PrimerController.getOverview)` invokes the method with `this ===
undefined`. A private static helper called as `this.#helper()` therefore throws
`TypeError: Receiver must be class …` **after** headers are sent, and the client gets a
`200` with a truncated or empty body. Module-level helper functions have no such problem
— `primerController.js` uses a module-level `csvCell` for exactly this reason. Never use
`this` inside a static route handler.

When a streaming handler does fail mid-response, log the error before ending the socket.
Silently calling `res.end()` hides the bug as a zero-byte download.

## Conventions

- Comments and JSDoc are written in **Indonesian**, and are unusually thorough
  (explaining *why*, especially around the alias rules and the no-JOIN decision). Match
  that; add to it rather than deleting it.
- Services/controllers are classes of `static` methods, exported as a single instance.
  Private helpers use `#name`. Utils (`uptCode.js`, `exportGrouping.js`, `skpGrouping.js`)
  are plain pure exported functions — keep them dependency-free and pure so both the
  current and YoY period paths can share the same bucketing.
- Export style is mixed: `primer` and `skp` use `class X { static … }` with
  `export default X`; only `auth` uses
  `class X { … }` + `export default new X()`. Follow the neighbouring files in the layer
  rather than normalising everything at once.
- `smkhp` keeps its reference-project variable names (`ExportService`,
  `ExportRepository`, `ExportController`) even though the files are `smkhp*`. Renaming
  them touches four layers for no gain; leave them.
