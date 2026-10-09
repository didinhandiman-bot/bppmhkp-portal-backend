# API Endpoint Audit & Mapping

*Generated for backend integration/documentation*

## Base Configuration
- Base v1: `/api/v1` (mounted in `src/app.js` via `src/routes/index.js`)
- Direct mount: `/api/pasca-panen/haccp` also mounted at root level in `src/app.js` (same handlers)
- Health: `GET /api/health` (unauthenticated, direct in `app.js`)

## 1. AUTH Module

| Method | Endpoint | Controller/File & Function | Input (Query/Params/Body) | Output Fields (200/Response) | Notes |
|---|---|---|---|---|---|
| POST | `/api/v1/auth/login` | `src/controllers/authController.js::AuthController.login()` (instance exported) | **Body (JSON):** `username` (string, required), `password` (string, required). **Headers:** optional `x-forwarded-for` for IP. | **200:** `{ status: "success", message: "Login berhasil", data: { token: string, user: { ...decodedUser } } }<br>**400:** `{ status: "error", message: "Username dan password wajib diisi" }<br>**401:** `{ status: "error", message: string } (invalid creds)<br>**403:** `{ success: false, message: string } (valid creds but role not allowed) | Uses `authService.login()`. Role check rejects non-ROLES_IZIN [1,2] with 403. JWT secret has fallback. |
| GET | `/api/v1/auth/me` | `src/controllers/authController.js::AuthController.me()` | **Headers:** `Authorization: Bearer <token>` (via `verifyToken` middleware). No query/params/body. | **200:** `{ status: "success", data: req.user }` where `req.user` is decoded JWT payload (fields include userId/id, username, roleId/role_id, name, kdUnit, isNationalAccess, etc., set by middleware/service). | Protected by `verifyToken` (`src/middleware/authMiddleware.js`). Returns 401 if missing, 403 if invalid/expired. |

## 2. OPTIONS Module

| Method | Endpoint | Controller/File & Function | Input | Output (200) | Notes |
|---|---|---|---|---|---|
| GET | `/api/v1/options/upt` | `src/controllers/optionsController.js::getUptOptions()` (static/class) | Query: none | 200: { success:true, message:string, data: Array } | Cached via UptMasterService. |

## 3. DASHBOARD Module

| Method | Endpoint | Controller/File & Function | Input (Query/Params/Body) | Output Fields (200) | Notes |
|---|---|---|---|---|---|
| GET | `/api/v1/dashboard/overview` | `src/controllers/dashboardOverviewController.js::getOverview()` | **Query:** `startDate` (string, optional, YYYY-MM-DD), `endDate` (string, optional, YYYY-MM-DD), `uptId` (string/number, optional). Also reads from `kd_unit` via effectiveUpt fallback. **Headers:** Bearer token (uses `verifyToken` in routes). | **200:** `{ success: true, message: "Data overview berhasil dimuat", data: { summaryKpi: { ekspor: Object, pascaPanen: Object, primer: { totalSertifikat: number, totalPending: number, detail: { cpib:number, cbib:number, cppib:number, cpoib:number, cdoib:number, cpibKapal:number } }, totalSertifikasiNasional: number }, monthlyTrends: Array, uptDistribution: Array, recentActivities: Array } }` | Orchestrated by `DashboardOverviewService.getOverviewMetrics()` calling Ekspor/PascaPanen/Primer repositories. Errors logged. Protected by verifyToken. |


## 4. HACCP Module

Routes: `src/routes/haccpRoutes.js`. Also mounted at `/api/pasca-panen/haccp` directly (root) and `/api/v1/pasca-panen/haccp` (v1). Controller `src/controllers/haccpController.js`, Service `src/services/haccpService.js`, Repo `src/repositories/haccpRepository.js`. View: `report_haccp.vw07_sertifikasi`. Date: `tgl_terbit`.

| Method | Endpoint | Controller/File & Function | Input (Query/Params/Body) | Output Fields (200) | Notes |
|---|---|---|---|---|---|
| GET | `/api/v1/pasca-panen/haccp/kpi` (also `/api/pasca-panen/haccp/kpi`) | `HaccpController.kpi()` | **Query:** `startDate` (string, YYYY-MM-DD, optional), `endDate` (string, YYYY-MM-DD, optional), `upt` or `kd_unit` or `id_upt` (string/number, optional). | **200:** `{ success: true, message: "Data KPI HACCP berhasil dimuat", data: { totalSertifikat: number, aktif: number, tidakAktif: number, kadaluarsaBulanIni: number, kadaluarsa3Bulan: number, kadaluarsaTotal: number } }` | Repo filters by `(kd_unit = :upt OR id_upt = :upt)`, date range on `tgl_terbit`. |
| GET | `/api/v1/pasca-panen/haccp/charts` | `HaccpController.charts()` | Same query as kpi. | **200:** `{ success: true, message: "Data chart HACCP berhasil dimuat", data: { byUpt: Array<{ upt: string, total: number }>, byJenis: Array<{ jenis: string, total: number }>, byTahun: Array<{ tahun: string, total: number }> } }` | Aggregated from view. |
| GET | `/api/v1/pasca-panen/haccp/table` | `HaccpController.table()` | **Query:** same filters + pagination if any (uses repo/service logic). Common: `page`, `limit`, `search`. | **200:** `{ success: true, message: "Data tabel HACCP berhasil dimuat", data: Array<Object> (sertifikat rows), meta?: Object }` | Returns paginated/list data from view. |


## 5. PRIMER Module

Routes: `src/routes/primerRoutes.js`. Controller `src/controllers/primerController.js`, Service `src/services/primerService.js`, Repo `src/repositories/primerRepository.js`. Table: `tr_laporan_primer_export` (dbPrimer). Date columns: `tgl_izin` (used in aggregated queries), `tgl_tarik_data` guarded; kapal uses `tgl_terbit`. Kd_izin whitelist includes CPOIB/CDOIB/CPIBKapal.

| Method | Endpoint | Controller/File & Function | Input (Query/Params/Body) | Output Fields (200) | Notes |
|---|---|---|---|---|---|
| GET | `/api/v1/primer/overview` | `PrimerController.getOverview()` | **Query:** `kdIzin` (string, required), `startDate` (YYYY-MM-DD, optional), `endDate` (YYYY-MM-DD, optional), `uptId`/filters as applicable. | **200:** `{ success: true, message: "Data overview primer berhasil dimuat", data: { ringkasan: { totalSertifikat: number, totalEntitas: number, rataEntitasPerSertifikat: number|null, rataMinor: number|null, rataMayor: number|null, rataKritis: number|null, tglSyncTerakhir: string|null }, distribusiGrade?: Object, trenBulanan?: Array, topEntitas?: Array } }` | Uses `PrimerService.getOverviewMetrics()`, repo `getSummaryMetrics()`. Handles kdIzin='032000000033' (kapal) via service branching. |
| GET | `/api/v1/primer/certificates` | `PrimerController.getCertificates()` | **Query:** `kdIzin` (string, required), `startDate`/`endDate` (optional), `page` (number, default 1), `limit` (number, default 10), `search` (string, optional), `sortBy`/`sortOrder` optional. | **200:** `{ success: true, message: "Data sertifikat berhasil dimuat", data: Array<Object>, meta: { pagination: { page, limit, totalRows, totalPages, hasNextPage, hasPrevPage, firstRow, lastRow } } }` | Paginated via `PrimerRepository.findAllPaginated()`. For kapal (033), special mapping applied in service (fields like noSertifikat, namaKapal, namaPemilik, masaBerlaku, statusAktif, tglKadaluarsa). |
| GET | `/api/v1/primer/export` | `PrimerController.exportCertificates()` | **Query:** same as certificates (filters). | **200 (stream):** CSV/Excel-like response (content-disposition) or JSON depending on impl. Returns file download. | Streams CSV; uses csvCell helper. May fail if headers sent before error (see Express unbound note) — errors handled. |


## 6. SKP Module

Routes: `src/routes/skpRoutes.js`. Controller `src/controllers/skpController.js`, Service `src/services/skpService.js`, Repo `src/repositories/skpRepository.js`. Schema `report_skp`, table `tb_skp_paska`. Date field: `tanggal_terbit` (not tgl_terbit).

| Method | Endpoint | Controller/File & Function | Input (Query/Params/Body) | Output Fields (200) | Notes |
|---|---|---|---|---|---|
| GET | `/api/v1/skp/summary` | `SkpController.getSummary()` | **Query:** `startDate` (YYYY-MM-DD, optional), `endDate` (YYYY-MM-DD, optional), `uptId`/`kd_unit` optional (passed to service/repo). | **200:** `{ success: true, message: string, data: Object }` (summary KPIs as per service/repo logic) | Uses `UptMasterService` for UPT normalization; filters by `tanggal_terbit`. |
| GET | `/api/v1/skp/trends` | `SkpController.getTrends()` | Same filters as summary. | **200:** `{ success: true, message: string, data: Array<Object> }` | Monthly/yearly trends. |
| GET | `/api/v1/skp/distribution` | `SkpController.getDistribution()` | Same filters. | **200:** `{ success: true, message: string, data: { byUpt: Array, byJenis: Array, ... } }` | Distribution grouping (uses `skpGrouping.js` utils). |
| GET | `/api/v1/skp/list` | `SkpController.getList()` | **Query:** filters + `page`, `limit`, `search` optional. | **200:** `{ success: true, message: string, data: Array<Object>, meta?: Object }` | Paginated list from `tb_skp_paska`. |


## 7. SMKHP Module (Pascapanen/Exports)

Routes: `src/routes/smkhpRoutes.js`. Controller/Service/Repo named `Export*` (reference naming preserved) - files `smkhp*`. Tables/views per schema (`tr_report_ekspor` etc.). Date: `tanggal_smkhp` where applicable. Bucketing done in memory (`exportGrouping.js`).

| Method | Endpoint | Controller/File & Function | Input (Query/Params/Body) | Output Fields (200) | Notes |
|---|---|---|---|---|---|
| GET | `/api/v1/pascapanen/smkhp/kpi-summary` | `ExportController.getKpiSummary()` | **Query:** `startDate` (YYYY-MM-DD), `endDate` (YYYY-MM-DD), `uptId` optional. | **200:** `{ success: true, message: string, data: { totalVolume: number, totalNilaiRupiah: number, totalNilaiUSD: number, totalTransaksi: number, rataRataHarga: number, ... } }` | USD derived as `nilai_rupiah/kurs_usd` (guarded). Date filters use BETWEEN with boundary normalization. |
| GET | `/api/v1/pascapanen/smkhp/monthly-trends` | `ExportController.getMonthlyTrends()` | Same filters. | **200:** `{ success: true, message: string, data: Array<{ bulan: string, volume: number, nilaiRupiah: number, nilaiUSD: number, transaksi: number }> }` | Monthly aggregation by period. |
| GET | `/api/v1/pascapanen/smkhp/top-destinations` | `ExportController.getTopDestinations()` | Same filters + optional `limit`. | **200:** `{ success: true, message: string, data: Array<{ negara: string, volume: number, nilaiRupiah: number, nilaiUSD: number, share: number }> }` | Region bucketing (ASEAN/EU) applied in memory before ranking. |
| GET | `/api/v1/pascapanen/smkhp/commodity-analytics` | `ExportController.getCommodityAnalytics()` | Same filters. | **200:** `{ success: true, message: string, data: { topKomoditas: Array, byKelompok: Array, trenBulananKomoditas: Array } }` | Commodity grouping in memory. |
| GET | `/api/v1/pascapanen/smkhp/upts` | `ExportController.getUpts()` | Same filters. | **200:** `{ success: true, message: string, data: Array<{ upt: string, kodeUpt: string, volume: number, nilaiRupiah: number, nilaiUSD: number, transaksi: number }> }` | UPT normalization via `uptCode` utils; merged with master UPT labels. |
| GET | `/api/v1/pascapanen/smkhp/upt-breakdown` | `ExportController.getUptBreakdown()` | Same filters (may require `uptId` or `kodeUpt`). | **200:** `{ success: true, message: string, data: Object/Array }` | Per-UPT breakdown. |
| GET | `/api/v1/pascapanen/smkhp/top-products-by-destination` | `ExportController.getTopProductsByDestination()` | Same filters. | **200:** `{ success: true, message: string, data: Array }` | Cross-tabulated. |
| GET | `/api/v1/pascapanen/smkhp/top-destinations-by-product` | `ExportController.getTopDestinationsByProduct()` | Same filters. | **200:** `{ success: true, message: string, data: Array }` | Cross-tabulated. |
| GET | `/api/v1/pascapanen/smkhp/transactions` | `ExportController.getTransactions()` | **Query:** filters + pagination (`page`, `limit`, `search`). | **200:** `{ success: true, message: string, data: Array<Object>, meta?: Object }` | Transaction list. |


## 8. PASCA PANEN Aggregators (Repositories Used by Dashboard)

Referenced by DashboardOverviewService: `src/repositories/eksporRepository.js`, `src/repositories/pascaPanenRepository.js`, `src/repositories/primerRepository.js`. Key methods:

- `EksporRepository.getAggregatedSummary({startDate,endDate,uptId})` → returns summary object (fields: totalVolume, totalNilaiRupiah, totalNilaiUSD, totalTransaksi, rataRataHarga or similar; shape consumed as `ekspor` in dashboard)
- `PascaPanenRepository.getAggregatedSummary({startDate,endDate,uptId})` → combines SMKHP (tanggal_smkhp), SKP (tanggal_terbit), HACCP (tgl_terbit); returns `{ totalSertifikatTerbit, ... }`
- `PrimerRepository.getAggregatedSummary({startDate,endDate,uptId})` → returns `{ totalSertifikat, totalSertifikatTerbit, totalPending, detail: {...}, kpi: {...} }` with correct kd_izin mapping

Dashboard maps primer to flattened form with `totalSertifikat`, `totalPending`, `detail` (cpib,cbib,cppib,cpoib,cdoib,cpibKapal).


## 9. Generic Error Responses

Global error handler: `src/middleware/errorHandler.js`. Error class: `src/errors/AppError.js` (live).

- **400 Bad Request** (typical): `{ success: false, message: string }` (may include details in dev; handler sets `success:false`, appends `error` only when `NODE_ENV=development`)
- **401 Unauthorized** (verifyToken): `{ status: "error", message: string }` or as per middleware (middleware returns 401 with JSON). Some flows use envelope `{ status: error }`.
- **403 Forbidden** (role/permission): example auth returns `{ success: false, message: string }` on role rejection; otherwise `{ status: "error", message: string }`.
- **404 Not Found**: routed to error handler as appropriate; generic `{ success: false, message: string }` in prod-like handling.
- **500 Internal Server Error**: `{ success: false, message: string }` (+ stack in development).

**Envelope notes:** Project mixes envelopes intentionally (`{success,message,data,meta?}` used by smkhp/skp/primer in many cases; auth uses `{status,message,data}`; role-403 in login uses `{success:false,message}`). Frontend consumers expect these shapes per module.

## Appendix: Route Mounts Summary

- Health: `GET /api/health` → direct handler in `app.js`
- v1 aggregator: `app.use('/api/v1', v1Routes)` where routes/index mounts: auth, options, pascapanen/smkhp, skp, primer, pasca-panen/haccp, dashboard
- HACCP also directly mounted: `app.use('/api/pasca-panen/haccp', haccpRoutes)` (parallel to v1 path) — same controller logic
