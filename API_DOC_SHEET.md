# Lembar Kerja Dokumentasi API (Per-Endpoint)

Basis URL: `/api/v1` (kecuali dinyatakan lain). Beberapa endpoint HACCP juga tersedia di `/api/pasca-panen/haccp/*` dengan handler yang sama.

## Modul: AUTH

### GET /api/v1/me
- File Controller: `src/controllers/authController.js::authController.me()`
- Sumber Data: hc.tb_user, tb_r_upt

1. Parameter Input:
| Nama Parameter | Lokasi | Tipe Data | Wajib/Opsional | Deskripsi |
|---|---|---|---|---|
| Authorization | Header | string | Wajib | Bearer <token> |

2. Contoh Response JSON (200 OK):
```json
{"status":"success","data":{"userId":1,"roleId":1,"username":"user","kdUnit":null,"isNationalAccess":true}}
```

3. Frontend TypeScript Type/Interface:
```typescript
export interface MeResponse {
  status: "success" | "error";
  data: Record<string, any>;
}
```

---

### POST /api/v1/login
- File Controller: `src/controllers/authController.js::authController.login()`
- Sumber Data: hc.tb_user, tb_r_upt

1. Parameter Input:
| Nama Parameter | Lokasi | Tipe Data | Wajib/Opsional | Deskripsi |
|---|---|---|---|---|
| username | Body (JSON) | string | Wajib | Username login |
| password | Body (JSON) | string | Wajib | Password login |
| x-forwarded-for | Header | string | Opsional | IP klien |

2. Contoh Response JSON (200 OK):
```json
{"status":"success","message":"Login berhasil","data":{"token":"jwt","user":{"userId":1,"roleId":1,"kdUnit":null,"isNationalAccess":true}}}
```

3. Frontend TypeScript Type/Interface:
```typescript
export interface LoginResponse {
  status: "success" | "error";
  message: string;
  data: { token: string; user: Record<string, any> };
}
```

---


## Modul: DASHBOARD

### GET /api/v1/overview
- File Controller: `src/controllers/dashboardOverviewController.js::getOverview()`
- Sumber Data: Agregasi lintas modul (Ekspor/SMKHP, Pasca Panen, Primer)

1. Parameter Input:
| Nama Parameter | Lokasi | Tipe Data | Wajib/Opsional | Deskripsi |
|---|---|---|---|---|
| startDate | Query | string (YYYY-MM-DD) | Opsional | Filter periode |
| endDate | Query | string (YYYY-MM-DD) | Opsional | Filter periode |
| uptId | Query | string/number | Opsional | Filter UPT |

2. Contoh Response JSON (200 OK):
```json
{"success":true,"message":"Data overview berhasil dimuat","data":{"summaryKpi":{"ekspor":{},"pascaPanen":{"totalSertifikatTerbit":0},"primer":{"totalSertifikat":0,"totalPending":0,"detail":{"cpib":0,"cbib":0,"cppib":0,"cpoib":0,"cdoib":0,"cpibKapal":0}},"totalSertifikasiNasional":0},"monthlyTrends":[],"uptDistribution":[],"recentActivities":[]}}
```

3. Frontend TypeScript Type/Interface:
```typescript
export interface PrimerDetail { cpib:number;cbib:number;cppib:number;cpoib:number;cdoib:number;cpibKapal:number; }
export interface PrimerKpi { totalSertifikat:number; totalPending:number; detail: PrimerDetail; }
export interface SummaryKpi { ekspor:any; pascaPanen:any; primer:PrimerKpi; totalSertifikasiNasional:number; }
export interface DashboardOverviewData { summaryKpi:SummaryKpi; monthlyTrends:any[]; uptDistribution:any[]; recentActivities:any[]; }
export interface DashboardOverviewResponse { success:boolean; message:string; data:DashboardOverviewData; }
```

---


## Modul: HACCP

### GET /api/v1/pasca-panen/haccp/charts *(juga /api/pasca-panen/haccp/charts)*
- File Controller: `src/controllers/haccpController.js::router.get()`
- Sumber Data: report_haccp.vw07_sertifikasi

1. Parameter Input:
| Nama Parameter | Lokasi | Tipe Data | Wajib/Opsional | Deskripsi |
|---|---|---|---|---|
| startDate | Query | string (YYYY-MM-DD) | Opsional | Filter tgl_terbit |
| endDate | Query | string (YYYY-MM-DD) | Opsional | Filter tgl_terbit |
| upt/kd_unit/id_upt | Query | string/number | Opsional | Filter UPT |

2. Contoh Response JSON (200 OK):
```json
{"success":true,"message":"Data chart HACCP berhasil dimuat","data":{"byUpt":[],"byJenis":[],"byTahun":[]}}
```

3. Frontend TypeScript Type/Interface:
```typescript
export interface ChartItem { upt?:string; jenis?:string; tahun?:string; total:number; [k:string]:any; }
export interface HaccpChartsData { byUpt:ChartItem[]; byJenis:ChartItem[]; byTahun:ChartItem[]; }
export interface HaccpChartsResponse { success:boolean; message:string; data:HaccpChartsData; }
```

---

### GET /api/v1/pasca-panen/haccp/kpi *(juga /api/pasca-panen/haccp/kpi)*
- File Controller: `src/controllers/haccpController.js::router.get()`
- Sumber Data: report_haccp.vw07_sertifikasi

1. Parameter Input:
| Nama Parameter | Lokasi | Tipe Data | Wajib/Opsional | Deskripsi |
|---|---|---|---|---|
| startDate | Query | string (YYYY-MM-DD) | Opsional | Filter tgl_terbit |
| endDate | Query | string (YYYY-MM-DD) | Opsional | Filter tgl_terbit |
| upt/kd_unit/id_upt | Query | string/number | Opsional | Filter UPT |

2. Contoh Response JSON (200 OK):
```json
{"success":true,"message":"Data KPI HACCP berhasil dimuat","data":{"totalSertifikat":0,"aktif":0,"tidakAktif":0,"kadaluarsaBulanIni":0,"kadaluarsa3Bulan":0,"kadaluarsaTotal":0}}
```

3. Frontend TypeScript Type/Interface:
```typescript
export interface HaccpKpiData { totalSertifikat:number; aktif:number; tidakAktif:number; kadaluarsaBulanIni:number; kadaluarsa3Bulan:number; kadaluarsaTotal:number; }
export interface HaccpKpiResponse { success:boolean; message:string; data:HaccpKpiData; }
```

---

### GET /api/v1/pasca-panen/haccp/table *(juga /api/pasca-panen/haccp/table)*
- File Controller: `src/controllers/haccpController.js::HaccpController.*()`
- Sumber Data: report_haccp.vw07_sertifikasi

1. Parameter Input:
| Nama Parameter | Lokasi | Tipe Data | Wajib/Opsional | Deskripsi |
|---|---|---|---|---|
| startDate | Query | string (YYYY-MM-DD) | Opsional | Filter tgl_terbit |
| endDate | Query | string (YYYY-MM-DD) | Opsional | Filter tgl_terbit |
| upt/kd_unit/id_upt | Query | string/number | Opsional | Filter UPT |
| page,limit,search | Query | number/string | Opsional | Pagination/pencarian |

2. Contoh Response JSON (200 OK):
```json
{"success":true,"message":"Data tabel HACCP berhasil dimuat","data":[],"meta":{"pagination":{"page":1,"limit":10,"totalRows":0,"totalPages":0}}}
```

3. Frontend TypeScript Type/Interface:
```typescript
export interface PaginationMeta { page:number; limit:number; totalRows:number; totalPages:number; hasNextPage?:boolean; hasPrevPage?:boolean; }
export interface HaccpTableResponse { success:boolean; message:string; data:any[]; meta?:{pagination:PaginationMeta}; }
```

---


## Modul: OPTIONS

### GET /api/v1/upt
- File Controller: `src/controllers/optionsController.js::OptionsController.getUptOptions()`
- Sumber Data: hc.tb_r_upt (cache)

1. Parameter Input:
| Nama Parameter | Lokasi | Tipe Data | Wajib/Opsional | Deskripsi |
|---|---|---|---|---|
| - | - | - | - | Tidak ada parameter |

2. Contoh Response JSON (200 OK):
```json
{"success":true,"message":"Data UPT berhasil dimuat","data":[{"value":"15.0","label":"UPT","kode":"15.0"}]}
```

3. Frontend TypeScript Type/Interface:
```typescript
export interface UptOption { value: string|number; label: string; kode?: string; [k:string]:any; }
export interface UptOptionsResponse { success: boolean; message: string; data: UptOption[]; }
```

---


## Modul: PRIMER

### GET /api/v1/certificates
- File Controller: `src/controllers/primerController.js::router.get()`
- Sumber Data: report_primer.tr_laporan_primer_export; report_kapal.tb_cbib_kapal (kdIzin='032000000033')

1. Parameter Input:
| Nama Parameter | Lokasi | Tipe Data | Wajib/Opsional | Deskripsi |
|---|---|---|---|---|
| kdIzin | Query | string | Wajib | Kode izin primer |
| startDate | Query | string (YYYY-MM-DD) | Opsional | Filter periode |
| endDate | Query | string (YYYY-MM-DD) | Opsional | Filter periode |
| page | Query | number | Opsional | Default 1 |
| limit | Query | number | Opsional | Default 10 |
| search | Query | string | Opsional | Pencarian |

2. Contoh Response JSON (200 OK):
```json
{"success":true,"message":"Data sertifikat berhasil dimuat","data":[],"meta":{"pagination":{"page":1,"limit":10,"totalRows":0,"totalPages":0,"hasNextPage":false,"hasPrevPage":false}}}
```

3. Frontend TypeScript Type/Interface:
```typescript
export interface PaginationMeta { page:number; limit:number; totalRows:number; totalPages:number; hasNextPage:boolean; hasPrevPage:boolean; firstRow?:number; lastRow?:number; }
export interface PrimerCertificatesResponse { success:boolean; message:string; data:any[]; meta:{pagination:PaginationMeta}; }
```

---

### GET /api/v1/export
- File Controller: `src/controllers/primerController.js::PrimerController.*()`
- Sumber Data: report_primer.tr_laporan_primer_export; report_kapal.tb_cbib_kapal (kdIzin='032000000033')

1. Parameter Input:
| Nama Parameter | Lokasi | Tipe Data | Wajib/Opsional | Deskripsi |
|---|---|---|---|---|
| kdIzin | Query | string | Wajib | Kode izin primer |
| startDate | Query | string (YYYY-MM-DD) | Opsional | Filter periode |
| endDate | Query | string (YYYY-MM-DD) | Opsional | Filter periode |

2. Contoh Response JSON (200 OK):
```json
// File stream (attachment)
```

3. Frontend TypeScript Type/Interface:
```typescript
// Blob download response
```

---

### GET /api/v1/overview
- File Controller: `src/controllers/primerController.js::PrimerController.*()`
- Sumber Data: report_primer.tr_laporan_primer_export; report_kapal.tb_cbib_kapal (kdIzin='032000000033')

1. Parameter Input:
| Nama Parameter | Lokasi | Tipe Data | Wajib/Opsional | Deskripsi |
|---|---|---|---|---|
| kdIzin | Query | string | Wajib | Kode izin primer |
| startDate | Query | string (YYYY-MM-DD) | Opsional | Filter periode |
| endDate | Query | string (YYYY-MM-DD) | Opsional | Filter periode |

2. Contoh Response JSON (200 OK):
```json
{"success":true,"message":"Data overview primer berhasil dimuat","data":{"ringkasan":{"totalSertifikat":0,"totalEntitas":0,"rataEntitasPerSertifikat":null,"rataMinor":null,"rataMayor":null,"rataKritis":null,"tglSyncTerakhir":null}}}
```

3. Frontend TypeScript Type/Interface:
```typescript
export interface PrimerOverviewRingkasan { totalSertifikat:number; totalEntitas:number; rataEntitasPerSertifikat:number|null; rataMinor:number|null; rataMayor:number|null; rataKritis:number|null; tglSyncTerakhir:string|null; }
export interface PrimerOverviewData { ringkasan:PrimerOverviewRingkasan; distribusiGrade?:any; trenBulanan?:any[]; topEntitas?:any[]; }
export interface PrimerOverviewResponse { success:boolean; message:string; data:PrimerOverviewData; }
```

---


## Modul: SKP

### GET /api/v1/distribution
- File Controller: `src/controllers/skpController.js::SkpController.*()`
- Sumber Data: report_skp.tb_skp_paska

1. Parameter Input:
| Nama Parameter | Lokasi | Tipe Data | Wajib/Opsional | Deskripsi |
|---|---|---|---|---|
| startDate | Query | string (YYYY-MM-DD) | Opsional | Filter tanggal_terbit |
| endDate | Query | string (YYYY-MM-DD) | Opsional | Filter tanggal_terbit |
| uptId/kd_unit | Query | string/number | Opsional | Filter UPT |

2. Contoh Response JSON (200 OK):
```json
{"success":true,"message":"Data distribution berhasil dimuat","data":{"byUpt":[],"byJenis":[]}}
```

3. Frontend TypeScript Type/Interface:
```typescript
export interface PaginationMeta { page:number; limit:number; totalRows:number; totalPages:number; hasNextPage?:boolean; hasPrevPage?:boolean; }
export interface BaseResponse<T=any> { success:boolean; message:string; data:T; meta?:{pagination?:PaginationMeta}; }
```

---

### GET /api/v1/list
- File Controller: `src/controllers/skpController.js::SkpController.*()`
- Sumber Data: report_skp.tb_skp_paska

1. Parameter Input:
| Nama Parameter | Lokasi | Tipe Data | Wajib/Opsional | Deskripsi |
|---|---|---|---|---|
| startDate | Query | string (YYYY-MM-DD) | Opsional | Filter tanggal_terbit |
| endDate | Query | string (YYYY-MM-DD) | Opsional | Filter tanggal_terbit |
| uptId/kd_unit | Query | string/number | Opsional | Filter UPT |
| page,limit,search | Query | number/string | Opsional | Pagination/pencarian |

2. Contoh Response JSON (200 OK):
```json
{"success":true,"message":"Data list berhasil dimuat","data":[],"meta":{"pagination":{"page":1,"limit":10,"totalRows":0,"totalPages":0}}}
```

3. Frontend TypeScript Type/Interface:
```typescript
export interface PaginationMeta { page:number; limit:number; totalRows:number; totalPages:number; hasNextPage?:boolean; hasPrevPage?:boolean; }
export interface BaseResponse<T=any> { success:boolean; message:string; data:T; meta?:{pagination?:PaginationMeta}; }
```

---

### GET /api/v1/summary
- File Controller: `src/controllers/skpController.js::router.get()`
- Sumber Data: report_skp.tb_skp_paska

1. Parameter Input:
| Nama Parameter | Lokasi | Tipe Data | Wajib/Opsional | Deskripsi |
|---|---|---|---|---|
| startDate | Query | string (YYYY-MM-DD) | Opsional | Filter tanggal_terbit |
| endDate | Query | string (YYYY-MM-DD) | Opsional | Filter tanggal_terbit |
| uptId/kd_unit | Query | string/number | Opsional | Filter UPT |

2. Contoh Response JSON (200 OK):
```json
{"success":true,"message":"Data summary berhasil dimuat","data":{}}
```

3. Frontend TypeScript Type/Interface:
```typescript
export interface PaginationMeta { page:number; limit:number; totalRows:number; totalPages:number; hasNextPage?:boolean; hasPrevPage?:boolean; }
export interface BaseResponse<T=any> { success:boolean; message:string; data:T; meta?:{pagination?:PaginationMeta}; }
```

---

### GET /api/v1/trends
- File Controller: `src/controllers/skpController.js::router.get()`
- Sumber Data: report_skp.tb_skp_paska

1. Parameter Input:
| Nama Parameter | Lokasi | Tipe Data | Wajib/Opsional | Deskripsi |
|---|---|---|---|---|
| startDate | Query | string (YYYY-MM-DD) | Opsional | Filter tanggal_terbit |
| endDate | Query | string (YYYY-MM-DD) | Opsional | Filter tanggal_terbit |
| uptId/kd_unit | Query | string/number | Opsional | Filter UPT |

2. Contoh Response JSON (200 OK):
```json
{"success":true,"message":"Data trends berhasil dimuat","data":[]}
```

3. Frontend TypeScript Type/Interface:
```typescript
export interface PaginationMeta { page:number; limit:number; totalRows:number; totalPages:number; hasNextPage?:boolean; hasPrevPage?:boolean; }
export interface BaseResponse<T=any> { success:boolean; message:string; data:T; meta?:{pagination?:PaginationMeta}; }
```

---


## Modul: SMKHP

### GET /api/v1/commodity-analytics
- File Controller: `src/controllers/smkhpController.js::ExportController.*()`
- Sumber Data: report_siapmutu.tr_report_ekspor (view/tabel terkait)

1. Parameter Input:
| Nama Parameter | Lokasi | Tipe Data | Wajib/Opsional | Deskripsi |
|---|---|---|---|---|
| startDate | Query | string (YYYY-MM-DD) | Opsional | Filter tanggal_smkhp |
| endDate | Query | string (YYYY-MM-DD) | Opsional | Filter tanggal_smkhp |
| uptId/kodeUpt | Query | string/number | Opsional | Filter UPT |

2. Contoh Response JSON (200 OK):
```json
{"success":true,"message":"Data berhasil dimuat","data":{"topKomoditas":[],"byKelompok":[],"trenBulananKomoditas":[]}}
```

3. Frontend TypeScript Type/Interface:
```typescript
export interface PaginationMeta { page:number; limit:number; totalRows:number; totalPages:number; hasNextPage?:boolean; hasPrevPage?:boolean; }
export interface BaseResponse<T=any> { success:boolean; message:string; data:T; meta?:{pagination?:PaginationMeta}; }
```

---

### GET /api/v1/kpi-summary
- File Controller: `src/controllers/smkhpController.js::router.get()`
- Sumber Data: report_siapmutu.tr_report_ekspor (view/tabel terkait)

1. Parameter Input:
| Nama Parameter | Lokasi | Tipe Data | Wajib/Opsional | Deskripsi |
|---|---|---|---|---|
| startDate | Query | string (YYYY-MM-DD) | Opsional | Filter tanggal_smkhp |
| endDate | Query | string (YYYY-MM-DD) | Opsional | Filter tanggal_smkhp |
| uptId/kodeUpt | Query | string/number | Opsional | Filter UPT |

2. Contoh Response JSON (200 OK):
```json
{"success":true,"message":"Data KPI berhasil dimuat","data":{"totalVolume":0,"totalNilaiRupiah":0,"totalNilaiUSD":0,"totalTransaksi":0,"rataRataHarga":0}}
```

3. Frontend TypeScript Type/Interface:
```typescript
export interface PaginationMeta { page:number; limit:number; totalRows:number; totalPages:number; hasNextPage?:boolean; hasPrevPage?:boolean; }
export interface BaseResponse<T=any> { success:boolean; message:string; data:T; meta?:{pagination?:PaginationMeta}; }
```

---

### GET /api/v1/monthly-trends
- File Controller: `src/controllers/smkhpController.js::router.get()`
- Sumber Data: report_siapmutu.tr_report_ekspor (view/tabel terkait)

1. Parameter Input:
| Nama Parameter | Lokasi | Tipe Data | Wajib/Opsional | Deskripsi |
|---|---|---|---|---|
| startDate | Query | string (YYYY-MM-DD) | Opsional | Filter tanggal_smkhp |
| endDate | Query | string (YYYY-MM-DD) | Opsional | Filter tanggal_smkhp |
| uptId/kodeUpt | Query | string/number | Opsional | Filter UPT |

2. Contoh Response JSON (200 OK):
```json
{"success":true,"message":"Data trends berhasil dimuat","data":[{"bulan":"2026-01","volume":0,"nilaiRupiah":0,"nilaiUSD":0,"transaksi":0}]}
```

3. Frontend TypeScript Type/Interface:
```typescript
export interface PaginationMeta { page:number; limit:number; totalRows:number; totalPages:number; hasNextPage?:boolean; hasPrevPage?:boolean; }
export interface BaseResponse<T=any> { success:boolean; message:string; data:T; meta?:{pagination?:PaginationMeta}; }
```

---

### GET /api/v1/top-destinations
- File Controller: `src/controllers/smkhpController.js::router.get()`
- Sumber Data: report_siapmutu.tr_report_ekspor (view/tabel terkait)

1. Parameter Input:
| Nama Parameter | Lokasi | Tipe Data | Wajib/Opsional | Deskripsi |
|---|---|---|---|---|
| startDate | Query | string (YYYY-MM-DD) | Opsional | Filter tanggal_smkhp |
| endDate | Query | string (YYYY-MM-DD) | Opsional | Filter tanggal_smkhp |
| uptId/kodeUpt | Query | string/number | Opsional | Filter UPT |
| limit | Query | number | Opsional | Batas jumlah |

2. Contoh Response JSON (200 OK):
```json
{"success":true,"message":"Data berhasil dimuat","data":[{"negara":"-","volume":0,"nilaiRupiah":0,"nilaiUSD":0,"share":0}]}
```

3. Frontend TypeScript Type/Interface:
```typescript
export interface PaginationMeta { page:number; limit:number; totalRows:number; totalPages:number; hasNextPage?:boolean; hasPrevPage?:boolean; }
export interface BaseResponse<T=any> { success:boolean; message:string; data:T; meta?:{pagination?:PaginationMeta}; }
```

---

### GET /api/v1/top-destinations-by-product
- File Controller: `src/controllers/smkhpController.js::ExportController.*()`
- Sumber Data: report_siapmutu.tr_report_ekspor (view/tabel terkait)

1. Parameter Input:
| Nama Parameter | Lokasi | Tipe Data | Wajib/Opsional | Deskripsi |
|---|---|---|---|---|
| startDate | Query | string (YYYY-MM-DD) | Opsional | Filter tanggal_smkhp |
| endDate | Query | string (YYYY-MM-DD) | Opsional | Filter tanggal_smkhp |
| uptId/kodeUpt | Query | string/number | Opsional | Filter UPT |
| limit | Query | number | Opsional | Batas jumlah |

2. Contoh Response JSON (200 OK):
```json
{"success":true,"message":"Data berhasil dimuat","data":[]}
```

3. Frontend TypeScript Type/Interface:
```typescript
export interface PaginationMeta { page:number; limit:number; totalRows:number; totalPages:number; hasNextPage?:boolean; hasPrevPage?:boolean; }
export interface BaseResponse<T=any> { success:boolean; message:string; data:T; meta?:{pagination?:PaginationMeta}; }
```

---

### GET /api/v1/top-products-by-destination
- File Controller: `src/controllers/smkhpController.js::ExportController.*()`
- Sumber Data: report_siapmutu.tr_report_ekspor (view/tabel terkait)

1. Parameter Input:
| Nama Parameter | Lokasi | Tipe Data | Wajib/Opsional | Deskripsi |
|---|---|---|---|---|
| startDate | Query | string (YYYY-MM-DD) | Opsional | Filter tanggal_smkhp |
| endDate | Query | string (YYYY-MM-DD) | Opsional | Filter tanggal_smkhp |
| uptId/kodeUpt | Query | string/number | Opsional | Filter UPT |

2. Contoh Response JSON (200 OK):
```json
{"success":true,"message":"Data berhasil dimuat","data":[]}
```

3. Frontend TypeScript Type/Interface:
```typescript
export interface PaginationMeta { page:number; limit:number; totalRows:number; totalPages:number; hasNextPage?:boolean; hasPrevPage?:boolean; }
export interface BaseResponse<T=any> { success:boolean; message:string; data:T; meta?:{pagination?:PaginationMeta}; }
```

---

### GET /api/v1/transactions
- File Controller: `src/controllers/smkhpController.js::ExportController.*()`
- Sumber Data: report_siapmutu.tr_report_ekspor (view/tabel terkait)

1. Parameter Input:
| Nama Parameter | Lokasi | Tipe Data | Wajib/Opsional | Deskripsi |
|---|---|---|---|---|
| startDate | Query | string (YYYY-MM-DD) | Opsional | Filter tanggal_smkhp |
| endDate | Query | string (YYYY-MM-DD) | Opsional | Filter tanggal_smkhp |
| uptId/kodeUpt | Query | string/number | Opsional | Filter UPT |
| page,limit,search | Query | number/string | Opsional | Pagination/pencarian |

2. Contoh Response JSON (200 OK):
```json
{"success":true,"message":"Data transaksi berhasil dimuat","data":[],"meta":{"pagination":{"page":1,"limit":10,"totalRows":0,"totalPages":0}}}
```

3. Frontend TypeScript Type/Interface:
```typescript
export interface PaginationMeta { page:number; limit:number; totalRows:number; totalPages:number; hasNextPage?:boolean; hasPrevPage?:boolean; }
export interface BaseResponse<T=any> { success:boolean; message:string; data:T; meta?:{pagination?:PaginationMeta}; }
```

---

### GET /api/v1/upt-breakdown
- File Controller: `src/controllers/smkhpController.js::ExportController.*()`
- Sumber Data: report_siapmutu.tr_report_ekspor (view/tabel terkait)

1. Parameter Input:
| Nama Parameter | Lokasi | Tipe Data | Wajib/Opsional | Deskripsi |
|---|---|---|---|---|
| startDate | Query | string (YYYY-MM-DD) | Opsional | Filter tanggal_smkhp |
| endDate | Query | string (YYYY-MM-DD) | Opsional | Filter tanggal_smkhp |
| uptId/kodeUpt | Query | string/number | Opsional | Filter UPT |

2. Contoh Response JSON (200 OK):
```json
{"success":true,"message":"Data berhasil dimuat","data":{}}
```

3. Frontend TypeScript Type/Interface:
```typescript
export interface PaginationMeta { page:number; limit:number; totalRows:number; totalPages:number; hasNextPage?:boolean; hasPrevPage?:boolean; }
export interface BaseResponse<T=any> { success:boolean; message:string; data:T; meta?:{pagination?:PaginationMeta}; }
```

---

### GET /api/v1/upts
- File Controller: `src/controllers/smkhpController.js::ExportController.*()`
- Sumber Data: report_siapmutu.tr_report_ekspor (view/tabel terkait)

1. Parameter Input:
| Nama Parameter | Lokasi | Tipe Data | Wajib/Opsional | Deskripsi |
|---|---|---|---|---|
| startDate | Query | string (YYYY-MM-DD) | Opsional | Filter tanggal_smkhp |
| endDate | Query | string (YYYY-MM-DD) | Opsional | Filter tanggal_smkhp |
| uptId/kodeUpt | Query | string/number | Opsional | Filter UPT |

2. Contoh Response JSON (200 OK):
```json
{"success":true,"message":"Data berhasil dimuat","data":[{"upt":"-","kodeUpt":"-","volume":0,"nilaiRupiah":0,"nilaiUSD":0,"transaksi":0}]}
```

3. Frontend TypeScript Type/Interface:
```typescript
export interface PaginationMeta { page:number; limit:number; totalRows:number; totalPages:number; hasNextPage?:boolean; hasPrevPage?:boolean; }
export interface BaseResponse<T=any> { success:boolean; message:string; data:T; meta?:{pagination?:PaginationMeta}; }
```

---

